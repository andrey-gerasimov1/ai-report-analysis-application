import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/access-control";
import { getAuditEvents } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return NextResponse.json({ error: "A valid signed session is required." }, { status: 401 });
  }

  return NextResponse.json(
    { events: await getAuditEvents(identity.user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
