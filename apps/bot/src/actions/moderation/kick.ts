import type { Action, ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";
import { resolveUserReference } from "@aripabot/core/commands/command-resolvers.ts";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import {
  botCanKickMember,
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
} from "@aripabot/core/moderation/moderation-helpers.ts";

const kickAction = {
  name: "kick",
  requiredUserPermissions: ["KickMembers"],
  description: "Kick a member from the server.",
  usage: "<target> [reason]",
  async execute(context) {
    return kickMember(context);
  },
} satisfies Action;

export default kickAction;

export async function kickMember(
  context: ActionContext,
  dependencies: { guildConfigStore?: GuildConfigStore } = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Kick can only be used from inside a server.");
  }

  const parsedInvocation = parseTrailingDryRunFlag(context.args);
  const rawTarget = parsedInvocation.args[0];

  if (!rawTarget) {
    return replyUsage(context, "<target> [reason]");
  }

  const resolvedTarget = resolveUserReference(rawTarget);

  if (!resolvedTarget.ok) {
    return context.reply(resolvedTarget.error.message);
  }

  const subject = await resolveModerationSubject(context, resolvedTarget.value.id);

  if (!subject?.member) {
    return context.reply("I could not find that member in this server.");
  }

  const invokerHierarchyError = getInvokerHierarchyErrorForMember(context, subject.member, "kick");

  if (invokerHierarchyError) {
    return context.reply(invokerHierarchyError);
  }

  if (!botCanKickMember(subject.member)) {
    return context.reply(
      `I cannot kick ${formatUserLabel(subject.user.id)} because their role is above mine.`,
    );
  }

  const reason = parsedInvocation.args.slice(1).join(" ").trim() || null;
  const dmChannel = parsedInvocation.dryRun
    ? null
    : await prepareModerationDmChannel({ user: subject.user, context });

  const dmDelivered = parsedInvocation.dryRun
    ? false
    : await sendModerationDm({
        user: subject.user,
        context,
        channel: dmChannel,
        content: [
          `You were kicked from ${context.message.guild.name}.`,
          `Reason: ${formatReason(reason)}`,
        ].join("\n"),
      });

  if (!parsedInvocation.dryRun) {
    await subject.member.kick(buildAuditReason(context, "Kick", reason));
  }

  await sendModerationLog({
    context,
    title: "Kick",
    store: dependencies.guildConfigStore ?? getGuildConfigStore(),
    dryRun: parsedInvocation.dryRun,
    details: [
      `User: ${formatUserLabel(subject.user.id)}`,
      `Moderator: ${formatUserLabel(context.message.author.id)}`,
      `Reason: ${formatReason(reason)}`,
      `DM: ${parsedInvocation.dryRun ? "skipped" : dmDelivered ? "sent" : "failed"}`,
    ],
  });

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      userId: subject.user.id,
      moderatorId: context.message.author.id,
      reason,
      dmDelivered,
      dryRun: parsedInvocation.dryRun,
    })
    .info(parsedInvocation.dryRun ? "Dry-run kicked member." : "Kicked member.");

  const prefix = parsedInvocation.dryRun ? "Dry run: would kick" : "Kicked";
  return context.reply(
    `${prefix} ${formatUserLabel(subject.user.id)}.${reason ? ` Reason: ${reason}` : ""}`,
  );
}
