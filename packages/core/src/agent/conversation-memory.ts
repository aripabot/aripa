import type { LogLayer } from "loglayer";
import {
  formatContextMessage,
  type ContextMessageLike,
  type ConversationMemorySummarizer,
} from "@aripabot/core/agent/tools/request-context.ts";

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_CHANNELS = 500;
const DEFAULT_MAX_VERBATIM_CHARS = 6_000;
const DEFAULT_KEEP_RECENT_TURNS = 6;
const DEFAULT_MAX_SUMMARY_CHARS = 1_500;
const DEFAULT_HARD_CAP_CHARS = 24_000;
const SKIPPED_MESSAGES_CONTENT = "[some intervening channel messages were skipped]";

export interface ConversationMemoryStoreOptions {
  idleTtlMs?: number;
  maxChannels?: number;
  maxVerbatimChars?: number;
  keepRecentTurns?: number;
  maxSummaryChars?: number;
  hardCapChars?: number;
  now?: () => number;
}

export interface RawMemoryTurn extends ContextMessageLike {
  createdTimestamp: number;
}

export interface ConversationMemoryContext {
  summary: string | null;
  formattedTurns: string[];
  lastSeenMessageId: string | null;
  messageIds: Set<string>;
}

interface ConversationMemoryEntry {
  channelId: string;
  summary: string | null;
  turns: RawMemoryTurn[];
  lastSeenMessageId: string | null;
  lastActivityAt: number;
  compacting: boolean;
}

export class ConversationMemoryStore {
  private readonly entries = new Map<string, ConversationMemoryEntry>();
  private readonly idleTtlMs: number;
  private readonly maxChannels: number;
  private readonly maxVerbatimChars: number;
  private readonly keepRecentTurns: number;
  private readonly maxSummaryChars: number;
  private readonly hardCapChars: number;
  private readonly now: () => number;

  constructor(options: ConversationMemoryStoreOptions = {}) {
    this.idleTtlMs = positiveIntegerOr(options.idleTtlMs, DEFAULT_IDLE_TTL_MS);
    this.maxChannels = positiveIntegerOr(options.maxChannels, DEFAULT_MAX_CHANNELS);
    this.maxVerbatimChars = positiveIntegerOr(options.maxVerbatimChars, DEFAULT_MAX_VERBATIM_CHARS);
    this.keepRecentTurns = nonNegativeIntegerOr(options.keepRecentTurns, DEFAULT_KEEP_RECENT_TURNS);
    this.maxSummaryChars = positiveIntegerOr(options.maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS);
    this.hardCapChars = positiveIntegerOr(options.hardCapChars, DEFAULT_HARD_CAP_CHARS);
    this.now = options.now ?? Date.now;
  }

  getContext(
    channelId: string,
    options: { invokerId: string; assistantUserId?: string },
  ): ConversationMemoryContext | null {
    const now = this.now();
    this.sweep(now);
    const entry = this.entries.get(channelId);

    if (!entry) {
      return null;
    }

    this.touch(entry, now);

    return {
      summary: entry.summary,
      formattedTurns: entry.turns.map((turn) => formatMemoryTurn(turn, options)),
      lastSeenMessageId: entry.lastSeenMessageId,
      messageIds: new Set(entry.turns.map((turn) => turn.id)),
    };
  }

  recordTurn(channelId: string, turns: readonly RawMemoryTurn[]): void {
    const now = this.now();
    this.sweep(now);
    const entry = this.getOrCreateEntry(channelId, now);

    for (const turn of turns) {
      entry.turns.push(turn);
      entry.lastSeenMessageId = turn.id;
    }

    this.touch(entry, now);
    this.evictLru();
  }

  recordSkippedMessages(channelId: string, afterMessageId: string): RawMemoryTurn {
    const now = this.now();
    this.sweep(now);
    const entry = this.getOrCreateEntry(channelId, now);
    const turn: RawMemoryTurn = {
      id: `skipped-after-${afterMessageId}`,
      content: SKIPPED_MESSAGES_CONTENT,
      createdTimestamp: now,
      author: {
        id: "system",
        bot: true,
        username: "system",
      },
    };
    entry.turns.push(turn);
    this.touch(entry, now);
    this.evictLru();
    return turn;
  }

  needsCompaction(channelId: string): boolean {
    const entry = this.entries.get(channelId);
    return entry ? totalTurnChars(entry.turns) > this.maxVerbatimChars : false;
  }

  isCompacting(channelId: string): boolean {
    return this.entries.get(channelId)?.compacting ?? false;
  }

  async compact(
    channelId: string,
    summarize: ConversationMemorySummarizer,
    options: {
      invokerId: string;
      assistantUserId?: string;
      log: LogLayer;
      abortSignal?: AbortSignal;
      logPrivacy?: boolean;
    },
  ): Promise<void> {
    const entry = this.entries.get(channelId);

    if (!entry || entry.compacting || entry.turns.length <= this.keepRecentTurns) {
      return;
    }

    entry.compacting = true;
    const summarizedTurns = entry.turns.slice(0, -this.keepRecentTurns);
    const summarizedIds = new Set(summarizedTurns.map((turn) => turn.id));
    const formattedTurns = summarizedTurns.map((turn) => formatMemoryTurn(turn, options));

    try {
      const summary = await summarize(formattedTurns, {
        abortSignal: options.abortSignal,
        previousSummary: entry.summary,
      });
      const currentEntry = this.entries.get(channelId);

      if (!currentEntry) {
        return;
      }

      currentEntry.summary = truncateSummary(summary, this.maxSummaryChars);
      currentEntry.turns = currentEntry.turns.filter((turn) => !summarizedIds.has(turn.id));
    } catch (error) {
      options.log
        .withError(error)
        .withMetadata({
          channelId,
          summarizedTurnCount: summarizedTurns.length,
          formattedTurnCount: formattedTurns.length,
          ...(options.logPrivacy ? { contentRedacted: true } : {}),
        })
        .warn("Failed to compact conversation memory.");
      this.trimToHardCap(entry);
    } finally {
      const currentEntry = this.entries.get(channelId);
      if (currentEntry) {
        currentEntry.compacting = false;
      }
    }
  }

  sweep(now = this.now()): void {
    const cutoff = now - this.idleTtlMs;

    for (const [channelId, entry] of this.entries) {
      if (entry.lastActivityAt <= cutoff) {
        this.entries.delete(channelId);
      }
    }
  }

  getTrackedChannelCountForTests(): number {
    return this.entries.size;
  }

  private getOrCreateEntry(channelId: string, now: number): ConversationMemoryEntry {
    const existing = this.entries.get(channelId);

    if (existing) {
      return existing;
    }

    const entry: ConversationMemoryEntry = {
      channelId,
      summary: null,
      turns: [],
      lastSeenMessageId: null,
      lastActivityAt: now,
      compacting: false,
    };
    this.entries.set(channelId, entry);
    return entry;
  }

  private touch(entry: ConversationMemoryEntry, now: number): void {
    entry.lastActivityAt = now;
    this.entries.delete(entry.channelId);
    this.entries.set(entry.channelId, entry);
  }

  private evictLru(): void {
    while (this.entries.size > this.maxChannels) {
      const oldestChannelId = this.entries.keys().next().value;

      if (!oldestChannelId) {
        return;
      }

      this.entries.delete(oldestChannelId);
    }
  }

  private trimToHardCap(entry: ConversationMemoryEntry): void {
    while (
      entry.turns.length > this.keepRecentTurns &&
      totalTurnChars(entry.turns) > this.hardCapChars
    ) {
      entry.turns.shift();
    }
  }
}

export function createRawMemoryTurn(message: ContextMessageLike): RawMemoryTurn {
  return {
    id: message.id,
    content: message.content,
    createdTimestamp: message.createdTimestamp ?? Date.now(),
    author: {
      id: message.author.id,
      bot: message.author.bot,
      username: message.author.username,
      tag: message.author.tag,
    },
  };
}

function formatMemoryTurn(
  turn: RawMemoryTurn,
  options: { invokerId: string; assistantUserId?: string },
): string {
  return formatContextMessage(turn, options);
}

function totalTurnChars(turns: readonly RawMemoryTurn[]): number {
  return turns.reduce((total, turn) => total + turn.content.length, 0);
}

function truncateSummary(summary: string, maxLength: number): string {
  const trimmed = summary.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed;
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}
