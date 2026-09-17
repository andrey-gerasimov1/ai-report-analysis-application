import "server-only";

type RateBucket = { timestamps: number[] };

declare global {
  // eslint-disable-next-line no-var
  var __reportAnalysisRateBuckets: Map<string, RateBucket> | undefined;
}

const buckets = globalThis.__reportAnalysisRateBuckets ?? new Map<string, RateBucket>();
globalThis.__reportAnalysisRateBuckets = buckets;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function consumeRequestQuota(
  key: string,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): RateLimitResult {
  const limit = options.limit ?? 15;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now();
  const cutoff = now - windowMs;
  const recent = (buckets.get(key)?.timestamps ?? []).filter((timestamp) => timestamp > cutoff);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  buckets.set(key, { timestamps: recent });

  if (buckets.size > 1_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (!bucket.timestamps.some((timestamp) => timestamp > cutoff)) buckets.delete(bucketKey);
    }
  }

  const resetAt = (recent[0] ?? now) + windowMs;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - recent.length),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
  };
}

export function clearRateLimits() {
  buckets.clear();
}
