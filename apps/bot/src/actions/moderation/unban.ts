import type { Action, ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";
import { resolveUserReference } from "@aripabot/core/commands/command-resolvers.ts";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import {
  buildAuditReason,
  formatReason,
  formatUserLabel,
  isDiscordUnknownBanError,
  parseTrailingDryRunFlag,
  replyUsage,
  sendModerationLog,
} from "@aripabot/core/moderation/moderation-helpers.ts";

const unbanAction = {
  name: "unban",
  requiredUserPermissions: ["BanMembers"],
  description: "Unban a user from the server.",
  usage: "<target> [reason]",
  async execute(context) {
    return unbanMember(context);
  },
} satisfies Action;

export default unbanAction;

export async function unbanMember(
  context: ActionContext,
  dependencies: { guildConfigStore?: GuildConfigStore } = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Unban can only be used from inside a server.");
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

  const reason = parsedInvocation.args.slice(1).join(" ").trim() || null;

  if (!parsedInvocation.dryRun) {
    try {
      await context.message.guild.members.unban(
        resolvedTarget.value.id,
        buildAuditReason(context, "Unban", reason),
      );
    } catch (error) {
      if (isDiscordUnknownBanError(error)) {
        return context.reply(
          `${formatUserLabel(resolvedTarget.value.id)} is not currently banned.`,
        );
      }

      throw error;
    }
  }

  await sendModerationLog({
    context,
    title: "Unban",
    store: dependencies.guildConfigStore ?? getGuildConfigStore(),
    dryRun: parsedInvocation.dryRun,
    details: [
      `User: ${formatUserLabel(resolvedTarget.value.id)}`,
      `Moderator: ${formatUserLabel(context.message.author.id)}`,
      `Reason: ${formatReason(reason)}`,
    ],
  });

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      userId: resolvedTarget.value.id,
      moderatorId: context.message.author.id,
      reason,
      dryRun: parsedInvocation.dryRun,
    })
    .info(parsedInvocation.dryRun ? "Dry-run unbanned user." : "Unbanned user.");

  return context.reply(
    `${parsedInvocation.dryRun ? "Dry run: would unban" : "Unbanned"} ${formatUserLabel(resolvedTarget.value.id)}.`,
  );
}
