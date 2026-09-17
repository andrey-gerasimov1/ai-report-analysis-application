import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isUserId } from "@/lib/demo-data";
import type { UserId } from "@/lib/types";

export const SESSION_COOKIE_NAME = "report_analysis_demo_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const LOCAL_DEVELOPMENT_SECRET = "report-analysis-local-demo-session-secret-change-before-deployment-2026";
const SessionPayloadSchema = z.object({
  userId: z.string(),
  sessionId: z.string().uuid(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type DemoSession = {
  userId: UserId;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

type SessionCryptoOptions = {
  now?: number;
  secret?: string;
};

function sessionSecret(explicitSecret?: string): string {
  const configured = explicitSecret ?? process.env.SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }
  return LOCAL_DEVELOPMENT_SECRET;
}

function signatureFor(encodedPayload: string, secret?: string): Buffer {
  return createHmac("sha256", sessionSecret(secret)).update(encodedPayload).digest();
}

export function createSessionToken(
  userId: UserId,
  options: SessionCryptoOptions = {},
): string {
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1_000);
  const payload: DemoSession = {
    userId,
    sessionId: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signatureFor(encodedPayload, options.secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  options: SessionCryptoOptions = {},
): DemoSession | null {
  if (!token) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  try {
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = signatureFor(encodedPayload, options.secret);
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return null;

    const parsed = SessionPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    if (!parsed.success || !isUserId(parsed.data.userId)) return null;
    const now = Math.floor((options.now ?? Date.now()) / 1_000);
    if (parsed.data.expiresAt <= now || parsed.data.issuedAt > now + 60) return null;
    return { ...parsed.data, userId: parsed.data.userId };
  } catch {
    return null;
  }
}

export function sessionFromRequest(request: NextRequest): DemoSession | null {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
  priority: "high" as const,
};
