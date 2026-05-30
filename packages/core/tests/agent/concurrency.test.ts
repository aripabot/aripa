import { describe, expect, test } from "vitest";
import { AgentConcurrencyLimiter } from "@aripabot/core/agent/concurrency.ts";

describe("AgentConcurrencyLimiter", () => {
  test("enforces per-guild concurrency and releases leases", () => {
    const limiter = new AgentConcurrencyLimiter({
      maxGlobal: 4,
      maxPerGuild: 1,
    });

    const first = limiter.tryAcquire("guild-1");
    expect(first.allowed).toBe(true);
    expect(limiter.tryAcquire("guild-1")).toEqual({
      allowed: false,
      reason: "guild_limit",
    });

    if (first.allowed) {
      first.lease.release();
    }

    expect(limiter.tryAcquire("guild-1").allowed).toBe(true);
  });

  test("enforces global concurrency across guilds", () => {
    const limiter = new AgentConcurrencyLimiter({
      maxGlobal: 2,
      maxPerGuild: 2,
    });

    expect(limiter.tryAcquire("guild-1").allowed).toBe(true);
    expect(limiter.tryAcquire("guild-2").allowed).toBe(true);
    expect(limiter.tryAcquire("guild-3")).toEqual({
      allowed: false,
      reason: "global_limit",
    });
  });
});
