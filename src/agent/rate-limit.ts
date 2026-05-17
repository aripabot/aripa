export interface AgentRateLimiterOptions {
  limit: number;
  windowMs?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
}

export interface AgentRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

const DEFAULT_WINDOW_MS = 60_000;

export class AgentRateLimiter {
  private readonly requests = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly now: () => number;
  private lastCleanupAt = 0;

  constructor(options: AgentRateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("Agent rate limit must be a whole number greater than 0.");
    }

    this.limit = options.limit;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.cleanupIntervalMs = normalizeCleanupInterval(options.cleanupIntervalMs, this.windowMs);
    this.now = options.now ?? Date.now;
  }

  check(key: string): AgentRateLimitResult {
    const now = this.now();
    const cutoff = now - this.windowMs;
    this.sweepExpiredRequests(now, cutoff);
    const recentRequests = (this.requests.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recentRequests.length >= this.limit) {
      this.requests.set(key, recentRequests);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, this.windowMs - (now - recentRequests[0]!)),
      };
    }

    recentRequests.push(now);
    this.requests.set(key, recentRequests);

    return {
      allowed: true,
      remaining: this.limit - recentRequests.length,
      retryAfterMs: 0,
    };
  }

  getTrackedKeyCountForTests(): number {
    return this.requests.size;
  }

  private sweepExpiredRequests(now: number, cutoff: number): void {
    if (this.cleanupIntervalMs <= 0 || now - this.lastCleanupAt < this.cleanupIntervalMs) {
      return;
    }

    this.lastCleanupAt = now;

    for (const [key, timestamps] of this.requests) {
      const recentRequests = timestamps.filter((timestamp) => timestamp > cutoff);

      if (recentRequests.length === 0) {
        this.requests.delete(key);
        continue;
      }

      this.requests.set(key, recentRequests);
    }
  }
}

function normalizeCleanupInterval(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function formatRateLimitRetryAfter(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
