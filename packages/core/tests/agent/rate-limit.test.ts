import { describe, expect, test } from "vitest";
import { AgentRateLimiter, formatRateLimitRetryAfter } from "@aripabot/core/agent/rate-limit.ts";

describe("AgentRateLimiter", () => {
  test("limits requests per key inside the configured window", () => {
    let now = 1_000;
    const limiter = new AgentRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: () => now,
    });

    expect(limiter.check("guild:user").allowed).toBe(true);
    expect(limiter.check("guild:user").allowed).toBe(true);

    const limited = limiter.check("guild:user");
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterMs).toBe(60_000);

    expect(limiter.check("guild:other-user").allowed).toBe(true);

    now += 60_001;
    expect(limiter.check("guild:user").allowed).toBe(true);
  });

  test("sweeps stale keys even when a different key is checked", () => {
    let now = 1_000;
    const limiter = new AgentRateLimiter({
      limit: 2,
      windowMs: 60_000,
      cleanupIntervalMs: 60_000,
      now: () => now,
    });

    limiter.check("guild:stale-user");
    expect(limiter.getTrackedKeyCountForTests()).toBe(1);

    now += 60_001;
    limiter.check("guild:new-user");

    expect(limiter.getTrackedKeyCountForTests()).toBe(1);
  });

  test("formats retry-after values as seconds", () => {
    expect(formatRateLimitRetryAfter(1)).toBe("1 second");
    expect(formatRateLimitRetryAfter(1_001)).toBe("2 seconds");
  });
});
