import { type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/access-control";
import { getReportAccess } from "@/lib/permissions";
import { readReportFile } from "@/lib/report-registry";
import { prepareFocusedReportForViewing, prepareReportForViewing } from "@/lib/report-view";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return new Response("A valid signed session is required.", { status: 401, headers: SECURITY_HEADERS });
  }

  const { reportId } = await params;
  const access = await getReportAccess(identity.user.id, reportId);
  if (access.status === "not_found") {
    return new Response("Report not found.", { status: 404, headers: SECURITY_HEADERS });
  }
  if (access.status === "forbidden") {
    return new Response("This account is not licensed to view that report.", {
      status: 403,
      headers: SECURITY_HEADERS,
    });
  }

  const focusText = request.nextUrl.searchParams.get("focus")
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 120);
  const fallbackAnchor = request.nextUrl.searchParams.get("anchor")
    ?.trim()
    .slice(0, 180);
  const offsetParameter = request.nextUrl.searchParams.get("offset");
  const requestedOffset = offsetParameter === null ? Number.NaN : Number(offsetParameter);
  const focused = request.nextUrl.searchParams.get("scope") !== "full"
    && Number.isSafeInteger(requestedOffset)
    && requestedOffset >= 0;
  const report = access.report;
  const content = await readReportFile(report);
  const rendered = focused
    ? prepareFocusedReportForViewing(
        report,
        content,
        requestedOffset,
        { focusText, fallbackAnchor },
      )
    : prepareReportForViewing(report, content, { focusText, fallbackAnchor });
  return new Response(rendered, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "X-Report-Analysis-View-Scope": focused ? "focused" : "full",
    },
  });
}
