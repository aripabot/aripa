export interface AgentConcurrencyLimiterOptions {
  maxGlobal: number;
  maxPerGuild: number;
}

export interface AgentConcurrencyLease {
  release: () => void;
}

export type AgentConcurrencyDenyReason = "global_limit" | "guild_limit";

export type AgentConcurrencyAcquireResult =
  | {
      allowed: true;
      lease: AgentConcurrencyLease;
    }
  | {
      allowed: false;
      reason: AgentConcurrencyDenyReason;
    };

export class AgentConcurrencyLimiter {
  readonly #maxGlobal: number;
  readonly #maxPerGuild: number;
  #globalActive = 0;
  readonly #activeByGuild = new Map<string, number>();

  constructor({ maxGlobal, maxPerGuild }: AgentConcurrencyLimiterOptions) {
    this.#maxGlobal = normalizeLimit(maxGlobal);
    this.#maxPerGuild = normalizeLimit(maxPerGuild);
  }

  tryAcquire(guildId: string): AgentConcurrencyAcquireResult {
    const guildActive = this.#activeByGuild.get(guildId) ?? 0;

    if (this.#globalActive >= this.#maxGlobal) {
      return {
        allowed: false,
        reason: "global_limit",
      };
    }

    if (guildActive >= this.#maxPerGuild) {
      return {
        allowed: false,
        reason: "guild_limit",
      };
    }

    this.#globalActive += 1;
    this.#activeByGuild.set(guildId, guildActive + 1);

    let released = false;
    return {
      allowed: true,
      lease: {
        release: () => {
          if (released) {
            return;
          }

          released = true;
          this.#release(guildId);
        },
      },
    };
  }

  #release(guildId: string): void {
    this.#globalActive = Math.max(0, this.#globalActive - 1);

    const guildActive = this.#activeByGuild.get(guildId) ?? 0;
    if (guildActive <= 1) {
      this.#activeByGuild.delete(guildId);
      return;
    }

    this.#activeByGuild.set(guildId, guildActive - 1);
  }
}

function normalizeLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}
