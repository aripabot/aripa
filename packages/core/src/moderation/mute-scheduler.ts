import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { Client, GuildMember } from "discord.js";
import type { LogLayer } from "loglayer";
import {
  ActiveMuteStore,
  getActiveMuteStore,
  type ActiveMuteRecord,
} from "@aripabot/core/moderation/active-mute-store.ts";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import { sendModLog } from "@aripabot/core/moderation/mod-log.ts";
import {
  buildModerationLogEmbed,
  getRoleMuteUnmuteReason,
} from "@aripabot/core/moderation/moderation-helpers.ts";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_RETRY_DELAY_MS = 30_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 15 * 60_000;
const DEFAULT_FAILURE_REPORT_INTERVAL_MS = 15 * 60_000;
const DEFAULT_RETRY_JITTER_RATIO = 0.2;

interface MuteFailureState {
  failures: number;
  lastReportedAtMs: number | null;
}

export class MuteScheduler {
  private readonly timers = new Map<string, Timer>();
  private readonly processing = new Set<string>();
  private readonly failureState = new Map<string, MuteFailureState>();
  private client: Client | null = null;
  private sweepTimer: Timer | null = null;

  constructor(
    private readonly store: ActiveMuteStore = getActiveMuteStore(),
    private readonly log: LogLayer,
    private readonly guildConfigStore: GuildConfigStore = getGuildConfigStore(),
    private readonly retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    private readonly sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
    private readonly failureReportIntervalMs = DEFAULT_FAILURE_REPORT_INTERVAL_MS,
    private readonly maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
    private readonly retryJitterRatio = DEFAULT_RETRY_JITTER_RATIO,
    private readonly random = Math.random,
  ) {}

  async start(client: Client): Promise<void> {
    this.client = client;
    this.clearTimers();
    this.stopSweep();
    this.startSweep();

    for (const record of this.store.listExpiring()) {
      try {
        await this.schedule(record);
      } catch (error) {
        this.log
          .withError(error)
          .withMetadata({ guildId: record.guildId, userId: record.userId })
          .warn("Failed to schedule active mute expiry during startup.");
      }
    }
  }

  stop(): void {
    this.clearTimers();
    this.stopSweep();
  }

  async schedule(record: ActiveMuteRecord): Promise<void> {
    const key = recordKey(record.guildId, record.userId);
    this.clearTimer(key);

    if (!record.expiresAt) {
      return;
    }

    const expiresAtMs = Date.parse(record.expiresAt);

    if (!Number.isFinite(expiresAtMs)) {
      this.log
        .withMetadata({
          guildId: record.guildId,
          userId: record.userId,
          expiresAt: record.expiresAt,
        })
        .warn("Active mute has an invalid expiry timestamp. Clearing it.");
      this.store.delete(record.guildId, record.userId);
      this.clearFailureState(record.guildId, record.userId);
      return;
    }

    const delay = expiresAtMs - Date.now();

    if (delay <= 0) {
      await this.processExpiry(record);
      return;
    }

    const timeoutDelay = Math.min(delay, MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => {
      void this.handleTimer(record.guildId, record.userId);
    }, timeoutDelay);

    this.timers.set(key, timer);
  }

  cancel(guildId: string, userId: string): void {
    this.clearTimer(recordKey(guildId, userId));
    this.store.delete(guildId, userId);
    this.clearFailureState(guildId, userId);
  }

  async processExpiry(record: ActiveMuteRecord): Promise<void> {
    if (!this.client) {
      return;
    }

    const key = recordKey(record.guildId, record.userId);

    if (this.processing.has(key)) {
      return;
    }

    this.processing.add(key);
    this.clearTimer(key);

    try {
      const guild = await this.client.guilds.fetch(record.guildId).catch((error: unknown) => {
        if (discordErrorCode(error) === RESTJSONErrorCodes.UnknownGuild) {
          this.log
            .withMetadata({ guildId: record.guildId, userId: record.userId })
            .info(
              "Guild is no longer available while processing mute expiry. Clearing active mute record.",
            );
          return null;
        }

        throw error;
      });

      if (!guild) {
        this.store.delete(record.guildId, record.userId);
        this.clearFailureState(record.guildId, record.userId);
        return;
      }

      const member = await guild.members
        .fetch({ user: record.userId, force: true })
        .catch((error: unknown) => {
          if (discordErrorCode(error) === RESTJSONErrorCodes.UnknownMember) {
            this.log
              .withMetadata({ guildId: record.guildId, userId: record.userId })
              .info("Muted member is no longer in the guild while processing mute expiry.");
            return null;
          }

          throw error;
        });

      if (!member) {
        this.store.delete(record.guildId, record.userId);
        this.clearFailureState(record.guildId, record.userId);
        return;
      }

      const role =
        guild.roles.cache.get(record.muteRoleId) ??
        (await guild.roles.fetch(record.muteRoleId).catch((error: unknown) => {
          if (discordErrorCode(error) === RESTJSONErrorCodes.UnknownRole) {
            return null;
          }

          throw error;
        }));

      if (!role) {
        this.log
          .withMetadata({
            guildId: record.guildId,
            userId: record.userId,
            roleId: record.muteRoleId,
          })
          .warn("Mute role is missing while processing mute expiry. Clearing active mute record.");
        this.store.delete(record.guildId, record.userId);
        this.clearFailureState(record.guildId, record.userId);
        return;
      }

      await this.removeRoleMute(member, role.id);
      this.store.delete(record.guildId, record.userId);
      this.clearFailureState(record.guildId, record.userId);
    } catch (error) {
      const failure = this.recordFailure(record);
      this.log
        .withError(error)
        .withMetadata({
          guildId: record.guildId,
          userId: record.userId,
          roleId: record.muteRoleId,
          failures: failure.failures,
          retryDelayMs: failure.retryDelayMs,
        })
        .warn("Failed to process active mute expiry. Scheduling retry.");

      if (failure.shouldReport) {
        await this.reportFailedUnmute(record, error, failure.retryDelayMs);
      }

      this.scheduleRetry(record, failure.retryDelayMs);
    } finally {
      this.processing.delete(key);
    }
  }

  private async handleTimer(guildId: string, userId: string): Promise<void> {
    try {
      const record = this.store.get(guildId, userId);

      if (!record) {
        this.clearTimer(recordKey(guildId, userId));
        return;
      }

      const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : NaN;

      if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()) {
        await this.schedule(record);
        return;
      }

      await this.processExpiry(record);
    } catch (error) {
      this.log
        .withError(error)
        .withMetadata({ guildId, userId })
        .warn("Failed while processing scheduled mute expiry.");
      const record = this.store.get(guildId, userId);

      if (record) {
        const failure = this.recordFailure(record);
        this.scheduleRetry(record, failure.retryDelayMs);
      }
    }
  }

  private async removeRoleMute(member: GuildMember, roleId: string): Promise<void> {
    try {
      await member.roles.remove(roleId, getRoleMuteUnmuteReason(null));
    } catch (error) {
      this.log
        .withError(error)
        .withMetadata({ guildId: member.guild.id, userId: member.id, roleId })
        .warn("Failed to remove expiring mute role.");
      throw error;
    }
  }

  private clearTimers(): void {
    for (const key of this.timers.keys()) {
      this.clearTimer(key);
    }
  }

  private startSweep(): void {
    if (this.sweepIntervalMs <= 0) {
      return;
    }

    this.sweepTimer = setInterval(() => {
      void this.sweepExpiredMutes();
    }, this.sweepIntervalMs);
  }

  private stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private async sweepExpiredMutes(): Promise<void> {
    for (const record of this.store.listExpiring()) {
      const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : NaN;

      if (!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now()) {
        continue;
      }

      await this.processExpiry(record);
    }
  }

  private scheduleRetry(record: ActiveMuteRecord, retryDelayMs: number): void {
    const key = recordKey(record.guildId, record.userId);
    this.clearTimer(key);

    const timer = setTimeout(
      () => {
        void this.handleTimer(record.guildId, record.userId);
      },
      Math.min(retryDelayMs, MAX_TIMER_DELAY_MS),
    );

    this.timers.set(key, timer);
  }

  private async reportFailedUnmute(
    record: ActiveMuteRecord,
    error: unknown,
    retryDelayMs: number,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    const errorMessage = extractErrorMessage(error);
    const embed = buildModerationLogEmbed({
      guildName: null,
      title: "Automatic Unmute Failed",
      details: [
        `User: <@${record.userId}> (\`${record.userId}\`)`,
        `Role: <@&${record.muteRoleId}> (\`${record.muteRoleId}\`)`,
        `Error: ${errorMessage}`,
        `Retrying In: ${Math.ceil(retryDelayMs / 1_000)} seconds`,
      ],
    });

    await sendModLog({
      client: this.client,
      guildId: record.guildId,
      log: this.log,
      store: this.guildConfigStore,
      embeds: [embed],
    }).catch((sendError: unknown) => {
      this.log
        .withError(sendError)
        .withMetadata({ guildId: record.guildId, userId: record.userId, roleId: record.muteRoleId })
        .warn("Failed to send mod-log entry for automatic unmute failure.");
    });
  }

  private recordFailure(record: ActiveMuteRecord): {
    failures: number;
    retryDelayMs: number;
    shouldReport: boolean;
  } {
    const key = recordKey(record.guildId, record.userId);
    const nowMs = Date.now();
    const state = this.failureState.get(key) ?? {
      failures: 0,
      lastReportedAtMs: null,
    };
    const failures = state.failures + 1;
    const retryDelayMs = this.calculateRetryDelayMs(failures);
    const shouldReport =
      state.lastReportedAtMs === null ||
      this.failureReportIntervalMs <= 0 ||
      nowMs - state.lastReportedAtMs >= this.failureReportIntervalMs;

    this.failureState.set(key, {
      failures,
      lastReportedAtMs: shouldReport ? nowMs : state.lastReportedAtMs,
    });

    return {
      failures,
      retryDelayMs,
      shouldReport,
    };
  }

  private calculateRetryDelayMs(failures: number): number {
    const exponent = Math.max(0, failures - 1);
    const baseDelay = Math.min(this.retryDelayMs * 2 ** exponent, this.maxRetryDelayMs);

    if (failures <= 1 || this.retryJitterRatio <= 0) {
      return Math.min(baseDelay, MAX_TIMER_DELAY_MS);
    }

    const jitterRange = baseDelay * this.retryJitterRatio;
    const jitter = (this.random() * 2 - 1) * jitterRange;

    return Math.min(Math.max(1, Math.round(baseDelay + jitter)), MAX_TIMER_DELAY_MS);
  }

  private clearFailureState(guildId: string, userId: string): void {
    this.failureState.delete(recordKey(guildId, userId));
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}

let defaultMuteScheduler: MuteScheduler | null = null;

export function getMuteScheduler(log: LogLayer): MuteScheduler {
  defaultMuteScheduler ??= new MuteScheduler(getActiveMuteStore(), log);
  return defaultMuteScheduler;
}

function recordKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function discordErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeDiscordError = error as { code?: unknown };
  return typeof maybeDiscordError.code === "number" ? maybeDiscordError.code : null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
