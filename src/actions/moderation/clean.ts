import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { resolveCount, resolveUserReference } from "@/commands/command-resolvers.ts";
import { getGuildConfigStore, type GuildConfigStore } from "@/config/guild-config-store.ts";
import {
  deleteMessagesIndividually,
  formatUserLabel,
  parseTrailingDryRunFlag,
  replyUsage,
  sendModerationLog,
} from "@/moderation/moderation-helpers.ts";

const cleanAction = {
  name: "clean",
  requiredUserPermissions: ["ManageMessages"],
  description: "Delete recent messages from a user in the current channel.",
  usage: "user <target> <count 1-100>",
  async execute(context) {
    return cleanMessages(context);
  },
} satisfies Action;

export default cleanAction;

const MAX_HISTORY_SCAN_BATCHES = 10;

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

  const channel = context.message.channel;
  const messageManager = "messages" in channel ? channel.messages : null;

  if (!messageManager || typeof messageManager.fetch !== "function") {
    return context.reply("I cannot clean messages in this channel.");
  }

  const matchingMessages = await collectMessagesForUser(
    messageManager,
    resolvedTarget.value.id,
    resolvedCount.value,
  );

  if (matchingMessages.length === 0) {
    return context.reply(
      `I could not find any recent messages from ${formatUserLabel(resolvedTarget.value.id)} here.`,
    );
  }

  const deletionResult = parsedInvocation.dryRun
    ? { deleted: matchingMessages.length, failed: 0 }
    : await deleteMessagesIndividually(matchingMessages);

  await sendModerationLog({
    context,
    title: "Clean User",
    store: dependencies.guildConfigStore ?? getGuildConfigStore(),
    dryRun: parsedInvocation.dryRun,
    details: [
      `User: ${formatUserLabel(resolvedTarget.value.id)}`,
      `Moderator: ${formatUserLabel(context.message.author.id)}`,
      `Channel: <#${context.message.channelId}>`,
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
  delete: () => Promise<unknown>;
}

interface FetchableMessageManager {
  fetch: (options: { limit: number; before?: string }) => Promise<Map<string, FetchableMessage>>;
}

async function collectMessagesForUser(
  manager: FetchableMessageManager,
  userId: string,
  targetCount: number,
): Promise<FetchableMessage[]> {
  const matches: FetchableMessage[] = [];
  let before: string | undefined;
  let batchesScanned = 0;

  while (matches.length < targetCount && batchesScanned < MAX_HISTORY_SCAN_BATCHES) {
    const batch = await manager.fetch({ limit: 100, before });
    batchesScanned += 1;

    if (batch.size === 0) {
      break;
    }

    for (const message of batch.values()) {
      if (message.author.id === userId) {
        matches.push(message);

        if (matches.length >= targetCount) {
          break;
        }
      }
    }

    before = [...batch.values()].at(-1)?.id;

    if (!before || batch.size < 100) {
      break;
    }
  }

  return matches.slice(0, targetCount);
}
