import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/session";

const SECRET = "test-session-secret-with-at-least-32-characters";

describe("signed demo sessions", () => {
  it("round-trips a valid identity without exposing it as trusted request input", () => {
    const token = createSessionToken("jordan", { secret: SECRET, now: 1_000_000 });
    expect(verifySessionToken(token, { secret: SECRET, now: 1_001_000 })).toMatchObject({
      userId: "jordan",
    });
  });

  it("rejects payload tampering and expired sessions", () => {
    const token = createSessionToken("jordan", { secret: SECRET, now: 1_000_000 });
    const [payload, signature] = token.split(".");
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

    expect(verifySessionToken(`${tamperedPayload}.${signature}`, {
      secret: SECRET,
      now: 1_001_000,
    })).toBeNull();
    expect(verifySessionToken(token, {
      secret: SECRET,
      now: 1_000_000 + 9 * 60 * 60 * 1_000,
    })).toBeNull();
  });
});
