import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { resolveUserReference } from "@/commands/command-resolvers.ts";
import { getGuildConfigStore, type GuildConfigStore } from "@/config/guild-config-store.ts";
import {
  botCanBanMember,
  buildAuditReason,
  formatReason,
  formatUserLabel,
  getInvokerHierarchyErrorForMember,
  parseTrailingDryRunFlag,
  prepareModerationDmChannel,
  replyUsage,
  resolveModerationSubject,
  sendModerationDm,
  sendModerationLog,
} from "@/moderation/moderation-helpers.ts";
import {
  collectGuildMessagesForUser,
  deleteCollectedGuildMessages,
} from "@/actions/moderation/clean.ts";

interface BanDependencies {
  guildConfigStore?: GuildConfigStore;
}

const banAction = {
  name: "ban",
  requiredUserPermissions: ["BanMembers"],
  description: "Ban a user from the server.",
  usage: "<target> [reason]",
  async execute(context) {
    return banMember(context);
  },
} satisfies Action;

export default banAction;

export async function banMember(
  context: ActionContext,
  dependencies: BanDependencies = {},
): Promise<ActionReply> {
  return banUserWithDeleteDays(context, 0, "Ban", dependencies);
}

export async function banUserWithDeleteDays(
  context: ActionContext,
  deleteMessageDays: number,
  actionTitle: "Ban" | "Cleanban",
  dependencies: BanDependencies = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply(`${actionTitle} can only be used from inside a server.`);
  }

  const parsedInvocation = parseTrailingDryRunFlag(context.args);

  const rawTarget = parsedInvocation.args[actionTitle === "Cleanban" ? 1 : 0];

  if (!rawTarget) {
    return replyUsage(
      context,
      actionTitle === "Cleanban" ? "<days 1-7> <target> [reason]" : "<target> [reason]",
    );
  }

  const resolvedTarget = resolveUserReference(rawTarget);

  if (!resolvedTarget.ok) {
    return context.reply(resolvedTarget.error.message);
  }

  const subject = await resolveModerationSubject(context, resolvedTarget.value.id);

  if (!subject) {
    return context.reply("I could not find that user.");
  }

  if (subject.member) {
    const invokerHierarchyError = getInvokerHierarchyErrorForMember(context, subject.member, "ban");

    if (invokerHierarchyError) {
      return context.reply(invokerHierarchyError);
    }
  }

  if (subject.member && !botCanBanMember(subject.member)) {
    return context.reply(
      `I cannot ban ${formatUserLabel(subject.user.id)} because their role is above mine.`,
    );
  }

  const reasonStartIndex = actionTitle === "Cleanban" ? 2 : 1;
  const reason = parsedInvocation.args.slice(reasonStartIndex).join(" ").trim() || null;
  const guildConfigStore = dependencies.guildConfigStore ?? getGuildConfigStore();
  const dmChannel = parsedInvocation.dryRun
    ? null
    : await prepareModerationDmChannel({ user: subject.user, context });
  const messagesToDelete =
    actionTitle === "Cleanban"
      ? await collectGuildMessagesForUser(context, subject.user.id, {
          sinceTimestampMs: Date.now() - deleteMessageDays * 24 * 60 * 60 * 1_000,
        })
      : [];

  if (!parsedInvocation.dryRun) {
    await context.message.guild.members.ban(subject.user.id, {
      deleteMessageSeconds: 0,
      reason: buildAuditReason(context, actionTitle, reason),
    });
  }

  const messageDeletionResult = parsedInvocation.dryRun
    ? { deleted: messagesToDelete.length, failed: 0 }
    : await deleteCollectedGuildMessages(messagesToDelete);

  const dmDelivered = parsedInvocation.dryRun
    ? false
    : await sendModerationDm({
        user: subject.user,
        context,
        channel: dmChannel,
        content: buildBanDmContent({
          guildName: context.message.guild.name,
          configuredBanMessage: guildConfigStore.getBanMessage(context.message.guildId),
          reason,
          deleteMessageDays,
        }),
      });

  const details = [
    `User: ${formatUserLabel(subject.user.id)}`,
    `Moderator: ${formatUserLabel(context.message.author.id)}`,
    `Reason: ${formatReason(reason)}`,
    `DM: ${dmDelivered ? "sent" : "failed"}`,
  ];

  if (actionTitle === "Cleanban") {
    details.splice(
      2,
      0,
      `Message window: ${deleteMessageDays} day${deleteMessageDays === 1 ? "" : "s"}`,
      `Deleted: ${messageDeletionResult.deleted} message${messageDeletionResult.deleted === 1 ? "" : "s"}`,
      `Failed: ${messageDeletionResult.failed} message${messageDeletionResult.failed === 1 ? "" : "s"}`,
    );
  }

  await sendModerationLog({
    context,
    title: actionTitle,
    store: guildConfigStore,
    dryRun: parsedInvocation.dryRun,
    details,
  });

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      userId: subject.user.id,
      moderatorId: context.message.author.id,
      reason,
      dmDelivered,
      deleteMessageDays,
      deletedCount: messageDeletionResult.deleted,
      failedCount: messageDeletionResult.failed,
      actionTitle,
      dryRun: parsedInvocation.dryRun,
    })
    .info(parsedInvocation.dryRun ? "Dry-run banned user." : "Banned user.");

  const deletedSuffix =
    actionTitle === "Cleanban"
      ? ` and deleted ${messageDeletionResult.deleted} message${messageDeletionResult.deleted === 1 ? "" : "s"} from the last ${deleteMessageDays} day${deleteMessageDays === 1 ? "" : "s"}`
      : "";
  const failureSuffix =
    actionTitle === "Cleanban" && messageDeletionResult.failed > 0
      ? ` ${messageDeletionResult.failed} message${messageDeletionResult.failed === 1 ? "" : "s"} could not be deleted.`
      : "";
  const prefix = parsedInvocation.dryRun ? "Dry run: would ban" : "Banned";
  return context.reply(
    `${prefix} ${formatUserLabel(subject.user.id)}${deletedSuffix}.${failureSuffix}${reason ? ` Reason: ${reason}` : ""}`,
  );
}

function buildBanDmContent(options: {
  guildName: string;
  configuredBanMessage: string | null;
  reason: string | null;
  deleteMessageDays: number;
}): string {
  const lines = [
    options.configuredBanMessage?.trim() || `You were banned from ${options.guildName}.`,
  ];

  if (options.deleteMessageDays > 0) {
    lines.push(
      `Messages deleted: ${options.deleteMessageDays} day${options.deleteMessageDays === 1 ? "" : "s"}`,
    );
  }

  lines.push(`Reason: ${formatReason(options.reason)}`);
  return lines.join("\n");
}
