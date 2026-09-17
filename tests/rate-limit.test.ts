import { beforeEach, describe, expect, it } from "vitest";
import { clearRateLimits, consumeRequestQuota } from "@/lib/rate-limit";

describe("assistant request limiting", () => {
  beforeEach(clearRateLimits);

  it("limits each signed session independently within the configured window", () => {
    expect(consumeRequestQuota("session-a", { limit: 2, now: 1_000 }).allowed).toBe(true);
    expect(consumeRequestQuota("session-a", { limit: 2, now: 1_001 }).allowed).toBe(true);
    expect(consumeRequestQuota("session-a", { limit: 2, now: 1_002 })).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(consumeRequestQuota("session-b", { limit: 2, now: 1_002 }).allowed).toBe(true);
  });
});
