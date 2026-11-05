/**
 * In-memory sliding window, to stop a stuck loop or an eager demo audience
 * burning through API credit. It is per server instance, so it is a safety net
 * rather than a billing control. Pass `now` in tests.
 */
export type RateLimiter = {
  check(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
};

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 1000;

  return {
    check(key, now = Date.now()) {
      const windowStart = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > windowStart);

      if (recent.length >= options.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + options.windowMs - now) / 1000),
          ),
        };
      }

      if (!hits.has(key) && hits.size >= maxKeys) {
        const firstKey = hits.keys().next().value;
        if (firstKey !== undefined) hits.delete(firstKey);
      }
      recent.push(now);
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
