import "server-only";
import type { NextRequest } from "next/server";
import { getUser } from "@/lib/demo-data";
import { sessionFromRequest, type DemoSession } from "@/lib/session";
import type { DemoUser } from "@/lib/types";

export type RequestIdentity = {
  session: DemoSession;
  user: DemoUser;
};

/** Resolve identity exclusively from the signed, HTTP-only session cookie. */
export function authenticateRequest(request: NextRequest): RequestIdentity | null {
  const session = sessionFromRequest(request);
  if (!session) return null;
  const user = getUser(session.userId);
  return user ? { session, user } : null;
}
