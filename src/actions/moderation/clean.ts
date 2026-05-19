import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { resolveCount, resolveUserReference } from "@/commands/command-resolvers.ts";
import { getGuildConfigStore, type GuildConfigStore } from "@/config/guild-config-store.ts";
import {
  deleteMessagesIndividually,
  type DeleteMessagesResult,
  formatUserLabel,
  parseTrailingDryRunFlag,
  replyUsage,
  sendModerationLog,
} from "@/moderation/moderation-helpers.ts";

const cleanAction = {
  name: "clean",
  requiredUserPermissions: ["ManageMessages"],
  description: "Delete recent messages from a user across the server.",
  usage: "user <target> <count 1-100>",
  async execute(context) {
    return cleanMessages(context);
  },
} satisfies Action;

export default cleanAction;

const MAX_HISTORY_SCAN_BATCHES = 10;
const CHANNEL_SCAN_CONCURRENCY = 8;
const SCANNING_ACKNOWLEDGEMENT = "Scanning for messages. This may take some time.";

export async function cleanMessages(
  context: ActionContext,
  dependencies: { guildConfigStore?: GuildConfigStore } = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guildId) {
    return context.reply("Clean can only be used from inside a server.");
  }

  const parsedInvocation = parseTrailingDryRunFlag(context.args);

  if (parsedInvocation.args[0]?.toLowerCase() !== "user") {
    return replyUsage(context, "user <target> <count 1-100>");
  }

  const rawTarget = parsedInvocation.args[1];
  const rawCount = parsedInvocation.args[2];

  if (!rawTarget || !rawCount) {
    return replyUsage(context, "user <target> <count 1-100>");
  }

  const resolvedTarget = resolveUserReference(rawTarget);

  if (!resolvedTarget.ok) {
    return context.reply(resolvedTarget.error.message);
  }

  const resolvedCount = resolveCount(rawCount, { min: 1, max: 100, label: "message count" });

  if (!resolvedCount.ok) {
    return context.reply(resolvedCount.error.message);
  }

  const matchingMessages = await collectGuildMessagesForUser(context, resolvedTarget.value.id, {
    maxMessages: resolvedCount.value,
  });

  if (matchingMessages.length === 0) {
    return context.reply(
      `I could not find any recent messages from ${formatUserLabel(resolvedTarget.value.id)} in this server.`,
    );
  }

  const deletionResult = parsedInvocation.dryRun
    ? { deleted: matchingMessages.length, failed: 0 }
    : await deleteCollectedGuildMessages(matchingMessages);

  await sendModerationLog({
    context,
    title: "Clean User",
    store: dependencies.guildConfigStore ?? getGuildConfigStore(),
    dryRun: parsedInvocation.dryRun,
    details: [
      `User: ${formatUserLabel(resolvedTarget.value.id)}`,
      `Moderator: ${formatUserLabel(context.message.author.id)}`,
      "Scope: server",
      `Deleted: ${deletionResult.deleted} message${deletionResult.deleted === 1 ? "" : "s"}`,
      `Failed: ${deletionResult.failed} message${deletionResult.failed === 1 ? "" : "s"}`,
    ],
  });

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      channelId: context.message.channelId,
      userId: resolvedTarget.value.id,
      moderatorId: context.message.author.id,
      deletedCount: deletionResult.deleted,
      failedCount: deletionResult.failed,
      dryRun: parsedInvocation.dryRun,
    })
    .info(parsedInvocation.dryRun ? "Dry-run cleaned user messages." : "Cleaned user messages.");

  const failureSuffix =
    deletionResult.failed > 0
      ? ` ${deletionResult.failed} message${deletionResult.failed === 1 ? "" : "s"} could not be deleted.`
      : "";

  return context.reply(
    `${parsedInvocation.dryRun ? "Dry run: would delete" : "Deleted"} ${deletionResult.deleted} message${deletionResult.deleted === 1 ? "" : "s"} from ${formatUserLabel(resolvedTarget.value.id)}.${failureSuffix}`,
  );
}

interface FetchableMessage {
  id: string;
  author: { id: string };
  createdTimestamp?: number;
  delete: () => Promise<unknown>;
}

interface FetchableMessageManager {
  fetch: (options: { limit: number; before?: string }) => Promise<Map<string, FetchableMessage>>;
}

interface FetchableChannel {
  id: string;
  isTextBased?: () => boolean;
  messages?: FetchableMessageManager;
  permissionsFor?: (memberOrUser: unknown) => { has: (permission: string) => boolean } | null;
  bulkDelete?: (
    messages: readonly FetchableMessage[],
    filterOld?: boolean,
  ) => Promise<{ size?: number } | void>;
}

interface CollectedGuildMessage {
  message: FetchableMessage;
  channel: FetchableChannel & { messages: FetchableMessageManager };
}

interface FetchableChannelCollection {
  values: () => IterableIterator<FetchableChannel | null>;
}

interface FetchableGuildChannels {
  cache?: FetchableChannelCollection;
  fetch?: () => Promise<FetchableChannelCollection | null>;
}

const DISCORD_EPOCH_MS = 1_420_070_400_000n;

export async function collectGuildMessagesForUser(
  context: ActionContext,
  userId: string,
  options: { maxMessages?: number; sinceTimestampMs?: number } = {},
): Promise<CollectedGuildMessage[]> {
  if (!context.isAgent) {
    await context.reply(SCANNING_ACKNOWLEDGEMENT);
  }

  const channels = await getFetchableGuildChannels(context);
  const botMember = (context.message.guild as { members?: { me?: unknown } } | null)?.members?.me;
  const cleanableChannels = channels.filter(
    (channel): channel is FetchableChannel & { messages: FetchableMessageManager } =>
      Boolean(channel) && isCleanableTextChannel(channel, botMember),
  );
  const messageGroups = await mapWithConcurrency(
    cleanableChannels,
    CHANNEL_SCAN_CONCURRENCY,
    async (channel) =>
      collectMessagesForUser(channel, userId, {
        maxMessages: options.maxMessages,
        sinceTimestampMs: options.sinceTimestampMs,
      }).catch((error) => {
        context.log
          .withError(error)
          .withMetadata({
            guildId: context.message.guildId,
            channelId: channel.id,
            userId,
          })
          .info("Failed to fetch channel messages for clean.");
        return [];
      }),
  );

  return sortMessagesNewestFirst(messageGroups.flat()).slice(
    0,
    options.maxMessages ?? Number.POSITIVE_INFINITY,
  );
}

export async function deleteCollectedGuildMessages(
  collectedMessages: readonly CollectedGuildMessage[],
): Promise<DeleteMessagesResult> {
  let deleted = 0;
  let failed = 0;
  const messagesByChannel = groupMessagesByChannel(collectedMessages);

  for (const [channel, messages] of messagesByChannel) {
    const bulkEligibleMessages = messages.filter(isBulkDeleteEligible);
    const individualMessages = messages.filter((message) => !isBulkDeleteEligible(message));

    if (typeof channel.bulkDelete !== "function") {
      const result = await deleteMessagesIndividually(messages);
      deleted += result.deleted;
      failed += result.failed;
      continue;
    }

    for (const chunk of chunkMessages(bulkEligibleMessages, 100)) {
      try {
        const result = await channel.bulkDelete(chunk, true);
        const bulkDeleted = result?.size ?? chunk.length;
        deleted += bulkDeleted;
        failed += chunk.length - bulkDeleted;
      } catch {
        const fallbackResult = await deleteMessagesIndividually(chunk);
        deleted += fallbackResult.deleted;
        failed += fallbackResult.failed;
      }
    }

    const individualResult = await deleteMessagesIndividually(individualMessages);
    deleted += individualResult.deleted;
    failed += individualResult.failed;
  }

  return { deleted, failed };
}

function groupMessagesByChannel(
  collectedMessages: readonly CollectedGuildMessage[],
): Map<FetchableChannel & { messages: FetchableMessageManager }, FetchableMessage[]> {
  const messagesByChannel = new Map<
    FetchableChannel & { messages: FetchableMessageManager },
    FetchableMessage[]
  >();

  for (const collectedMessage of collectedMessages) {
    const channelMessages = messagesByChannel.get(collectedMessage.channel) ?? [];
    channelMessages.push(collectedMessage.message);
    messagesByChannel.set(collectedMessage.channel, channelMessages);
  }

  return messagesByChannel;
}

function chunkMessages<T>(messages: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < messages.length; index += chunkSize) {
    chunks.push(messages.slice(index, index + chunkSize));
  }

  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R | undefined>({ length: items.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      if (item === undefined) {
        continue;
      }

      results[index] = await mapper(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  return results.filter((result): result is R => result !== undefined);
}

function isBulkDeleteEligible(message: FetchableMessage): boolean {
  const timestamp = getMessageTimestamp(message);
  return timestamp === null || Date.now() - timestamp < 14 * 24 * 60 * 60 * 1_000;
}

async function getFetchableGuildChannels(context: ActionContext): Promise<FetchableChannel[]> {
  const guildChannels = (context.message.guild as { channels?: FetchableGuildChannels } | null)
    ?.channels;
  const fetchedChannels = await guildChannels?.fetch?.().catch(() => null);
  const channelCollection = fetchedChannels ?? guildChannels?.cache;

  if (!channelCollection) {
    return [];
  }

  return [...channelCollection.values()].filter((channel): channel is FetchableChannel =>
    Boolean(channel),
  );
}

function isFetchableTextChannel(
  channel: FetchableChannel,
): channel is FetchableChannel & { messages: FetchableMessageManager } {
  if (typeof channel.isTextBased === "function" && !channel.isTextBased()) {
    return false;
  }

  return typeof channel.messages?.fetch === "function";
}

function isCleanableTextChannel(
  channel: FetchableChannel,
  botMember: unknown,
): channel is FetchableChannel & { messages: FetchableMessageManager } {
  if (!isFetchableTextChannel(channel)) {
    return false;
  }

  const permissions = botMember ? channel.permissionsFor?.(botMember) : null;

  if (!permissions) {
    return true;
  }

  return (
    permissions.has("ViewChannel") &&
    permissions.has("ReadMessageHistory") &&
    permissions.has("ManageMessages")
  );
}

async function collectMessagesForUser(
  channel: FetchableChannel & { messages: FetchableMessageManager },
  userId: string,
  options: { maxMessages?: number; sinceTimestampMs?: number },
): Promise<CollectedGuildMessage[]> {
  const matches: CollectedGuildMessage[] = [];
  let before: string | undefined;
  let batchesScanned = 0;
  const targetCount = options.maxMessages ?? Number.POSITIVE_INFINITY;

  while (matches.length < targetCount && batchesScanned < MAX_HISTORY_SCAN_BATCHES) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    batchesScanned += 1;

    if (batch.size === 0) {
      break;
    }

    for (const message of batch.values()) {
      if (message.author.id === userId && isMessageNewEnough(message, options.sinceTimestampMs)) {
        matches.push({ message, channel });

        if (matches.length >= targetCount) {
          break;
        }
      }
    }

    before = [...batch.values()].at(-1)?.id;

    if (!before || batch.size < 100 || isBatchOlderThanCutoff(batch, options.sinceTimestampMs)) {
      break;
    }
  }

  return matches.slice(0, targetCount);
}

function isMessageNewEnough(message: FetchableMessage, sinceTimestampMs?: number): boolean {
  if (sinceTimestampMs === undefined) {
    return true;
  }

  const createdTimestamp = getMessageTimestamp(message);
  return createdTimestamp === null || createdTimestamp >= sinceTimestampMs;
}

function isBatchOlderThanCutoff(
  batch: Map<string, FetchableMessage>,
  sinceTimestampMs?: number,
): boolean {
  if (sinceTimestampMs === undefined) {
    return false;
  }

  const oldestMessage = [...batch.values()].at(-1);
  const oldestTimestamp = oldestMessage ? getMessageTimestamp(oldestMessage) : null;
  return oldestTimestamp !== null && oldestTimestamp < sinceTimestampMs;
}

function sortMessagesNewestFirst(messages: CollectedGuildMessage[]): CollectedGuildMessage[] {
  return messages.toSorted((left, right) => {
    const leftTimestamp = getMessageTimestamp(left.message) ?? 0;
    const rightTimestamp = getMessageTimestamp(right.message) ?? 0;
    return rightTimestamp - leftTimestamp;
  });
}

function getMessageTimestamp(message: FetchableMessage): number | null {
  if (typeof message.createdTimestamp === "number") {
    return message.createdTimestamp;
  }

  try {
    return Number((BigInt(message.id) >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return null;
  }
}
