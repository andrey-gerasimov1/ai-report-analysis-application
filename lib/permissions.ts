import "server-only";
import { getUser, isUserId } from "@/lib/demo-data";
import { hasEffectiveReportAccess, listPurchasedReportIds } from "@/lib/demo-purchases";
import { listReports } from "@/lib/report-registry";
import type { AuthorizedReport, ReportDefinition, ReportId, UserId } from "@/lib/types";

export class AuthorizationError extends Error {
  constructor(message = "Unknown demo user") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function grantReport(report: ReportDefinition): AuthorizedReport {
  return report as AuthorizedReport;
}

export async function getAuthorizedReports(userId: string): Promise<AuthorizedReport[]> {
  const user = getUser(userId);
  if (!user || !isUserId(userId)) throw new AuthorizationError();

  const [reports, purchasedReportIds] = await Promise.all([
    listReports(),
    listPurchasedReportIds(userId),
  ]);
  return reports
    .filter((report) => hasEffectiveReportAccess(report, userId, purchasedReportIds))
    .map(grantReport);
}

export function canAccessReport(
  userId: string,
  report: ReportDefinition,
  purchasedReportIds: ReadonlySet<ReportId> = new Set(),
): boolean {
  return isUserId(userId) && hasEffectiveReportAccess(report, userId, purchasedReportIds);
}

export async function getReportAccess(
  userId: UserId,
  reportId: string,
): Promise<
  | { status: "allowed"; report: AuthorizedReport }
  | { status: "forbidden"; report: ReportDefinition }
  | { status: "not_found" }
> {
  const [reports, purchasedReportIds] = await Promise.all([
    listReports(),
    listPurchasedReportIds(userId),
  ]);
  const report = reports.find((item) => item.id === reportId);
  if (!report) return { status: "not_found" };
  return hasEffectiveReportAccess(report, userId, purchasedReportIds)
    ? { status: "allowed", report: grantReport(report) }
    : { status: "forbidden", report };
}

export function getRequestedReports(reports: ReportDefinition[], question: string): ReportDefinition[] {
  const normalized = question.toLowerCase();
  return reports.filter((report) => {
    const routingSignals = [report.id, report.code, report.title, report.shortTitle, ...report.keywords];
    return routingSignals.some((signal) => normalized.includes(signal.toLowerCase()));
  });
}

export function getPermissionDecisionForReports(
  userId: UserId,
  reports: ReportDefinition[],
  requestedReportIds: string[],
  purchasedReportIds: ReadonlySet<ReportId> = new Set(),
) {
  if (!getUser(userId)) throw new AuthorizationError();
  const authorized = reports
    .filter((report) => hasEffectiveReportAccess(report, userId, purchasedReportIds))
    .map(grantReport);
  const selectedIds = new Set(requestedReportIds);
  const requested = reports.filter((report) => selectedIds.has(report.id));
  const requestedIds = new Set(requested.map((report) => report.id));
  const authorizedIds = new Set(authorized.map((report) => report.id));

  const blocked = requested.filter((report) => !authorizedIds.has(report.id));
  const searchable = requested.length
    ? authorized.filter((report) => requestedIds.has(report.id))
    : authorized;

  return { authorized, requested, blocked, searchable };
}

export async function getPermissionDecision(userId: string, question: string) {
  if (!getUser(userId) || !isUserId(userId)) throw new AuthorizationError();
  const [reports, purchasedReportIds] = await Promise.all([
    listReports(),
    listPurchasedReportIds(userId),
  ]);
  return getPermissionDecisionForReports(
    userId,
    reports,
    getRequestedReports(reports, question).map((report) => report.id),
    purchasedReportIds,
  );
}
