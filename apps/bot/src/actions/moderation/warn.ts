import type { Action, ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";
import { resolveUserReference } from "@aripabot/core/commands/command-resolvers.ts";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import {
  formatReason,
  formatUserLabel,
  getInvokerHierarchyErrorForMember,
  parseTrailingDryRunFlag,
  replyUsage,
  resolveModerationSubject,
  sendModerationDm,
  sendModerationLog,
} from "@aripabot/core/moderation/moderation-helpers.ts";

const warnAction = {
  name: "warn",
  requiredUserPermissions: ["ModerateMembers"],
  description: "Warn a member and log the warning.",
  usage: "<target> [reason]",
  async execute(context) {
    return warnMember(context);
  },
} satisfies Action;

export default warnAction;

export async function warnMember(
  context: ActionContext,
  dependencies: { guildConfigStore?: GuildConfigStore } = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guildId) {
    return context.reply("Warn can only be used from inside a server.");
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

  const invokerHierarchyError = getInvokerHierarchyErrorForMember(context, subject.member, "warn");

  if (invokerHierarchyError) {
    return context.reply(invokerHierarchyError);
  }

  const reason = parsedInvocation.args.slice(1).join(" ").trim() || null;
  const dmReasonLine = reason ? `Reason: ${reason}` : "Reason: No reason provided.";

  const dmDelivered = parsedInvocation.dryRun
    ? false
    : await sendModerationDm({
        user: subject.user,
        context,
        content: [
          `You were warned in ${context.message.guild?.name ?? "this server"}.`,
          dmReasonLine,
        ].join("\n"),
      });

  await sendModerationLog({
    context,
    title: "Warn",
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
    .info(parsedInvocation.dryRun ? "Dry-run warned member." : "Warned member.");

  const prefix = parsedInvocation.dryRun ? "Dry run: would warn" : "Warned";
  return context.reply(
    `${prefix} ${formatUserLabel(subject.user.id)}.${reason ? ` Reason: ${reason}` : ""}`,
  );
}
