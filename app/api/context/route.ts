import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/access-control";
import { USERS } from "@/lib/demo-data";
import { hasEffectiveReportAccess, listPurchasedReportIds } from "@/lib/demo-purchases";
import { getAuditEvents } from "@/lib/audit";
import { listQuarantinedReportFiles, listReports } from "@/lib/report-registry";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return NextResponse.json({ error: "A valid signed session is required." }, { status: 401 });
  }
  const userId = identity.user.id;

  const [registryReports, quarantinedFiles, auditEvents, purchasedByUser] = await Promise.all([
    listReports(),
    listQuarantinedReportFiles(),
    getAuditEvents(userId),
    Promise.all(USERS.map(async (profile) => [
      profile.id,
      await listPurchasedReportIds(profile.id),
    ] as const)),
  ]);
  const purchaseLookup = new Map(purchasedByUser);
  const users = USERS.map((profile) => ({
    ...profile,
    reportIds: registryReports
      .filter((report) => hasEffectiveReportAccess(
        report,
        profile.id,
        purchaseLookup.get(profile.id) ?? new Set(),
      ))
      .map((report) => report.id),
  }));
  const user = users.find((profile) => profile.id === userId)!;
  const purchasedReportIds = purchaseLookup.get(userId) ?? new Set();
  const reports = registryReports.map((definition) => {
    const accessible = hasEffectiveReportAccess(definition, userId, purchasedReportIds);
    const { keywords: _keywords, allowedUsers: _allowedUsers, version: _version, ...report } = definition;
    return {
      ...report,
      accessible,
      accessLabel: accessible ? "Licensed" : "Not licensed",
    };
  });

  return NextResponse.json({
    user,
    users,
    reports,
    sessionType: "signed-demo",
    aiMode: process.env.OPENAI_API_KEY ? "live" : "demo",
    auditCount: auditEvents.length,
    reportDirectory: "data/reports",
    quarantinedCount: quarantinedFiles.length,
    supportedFormats: ["HTML", "Markdown", "Text"],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
