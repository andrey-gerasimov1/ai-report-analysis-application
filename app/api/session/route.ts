import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/demo-data";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SessionRequestSchema = z.object({
  userId: z.enum(["alex", "jordan", "taylor"]),
}).strict();

export async function POST(request: NextRequest) {
  const parsed = SessionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid simulated identity." }, { status: 400 });
  }

  const user = getUser(parsed.data.userId)!;
  const response = NextResponse.json({
    user: { id: user.id, name: user.name, organization: user.organization },
    sessionType: "signed-demo",
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    createSessionToken(user.id),
    SESSION_COOKIE_OPTIONS,
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ signedOut: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
