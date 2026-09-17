import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/access-control";
import {
  hasEffectiveReportAccess,
  listPurchasedReportIds,
  recordDemoPurchase,
} from "@/lib/demo-purchases";
import { listReports } from "@/lib/report-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PurchaseRequestSchema = z.object({
  reportIds: z.array(z.string().min(1)).min(1).max(10),
}).strict();

export async function POST(request: NextRequest) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return NextResponse.json({ error: "A valid signed session is required." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 8 * 1_024) {
    return NextResponse.json({ error: "Purchase request is too large." }, { status: 413 });
  }

  const parsed = PurchaseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose at least one valid report." }, { status: 400 });
  }

  const requestedIds = [...new Set(parsed.data.reportIds)];
  const reports = await listReports();
  const reportLookup = new Map(reports.map((report) => [report.id, report]));
  const requestedReports = requestedIds.map((reportId) => reportLookup.get(reportId));
  if (requestedReports.some((report) => !report)) {
    return NextResponse.json({ error: "One or more selected reports are unavailable." }, { status: 400 });
  }

  const userId = identity.user.id;
  const purchasedReportIds = await listPurchasedReportIds(userId);
  const purchasableReports = requestedReports
    .filter((report) => report !== undefined)
    .filter((report) => !hasEffectiveReportAccess(report, userId, purchasedReportIds));

  const purchase = await recordDemoPurchase({
    userId,
    items: purchasableReports.map((report) => ({
      reportId: report.id,
      unitPriceCents: report.priceCents,
    })),
  });
  const effectivePurchasedIds = await listPurchasedReportIds(userId);
  const allRequestedReportsAccessible = requestedReports.every((report) => (
    report !== undefined && hasEffectiveReportAccess(report, userId, effectivePurchasedIds)
  ));

  return NextResponse.json({
    purchaseId: purchase?.id ?? null,
    purchasedAt: purchase?.createdAt ?? null,
    currency: "USD",
    totalCents: purchase?.totalCents ?? 0,
    purchasedReportIds: purchase?.items.map((item) => item.reportId) ?? [],
    allRequestedReportsAccessible,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
