import type { Action, ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";
import { resolveUserReference } from "@aripabot/core/commands/command-resolvers.ts";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import {
  getActiveMuteStore,
  type ActiveMuteStore,
} from "@aripabot/core/moderation/active-mute-store.ts";
import { getMuteScheduler, type MuteScheduler } from "@aripabot/core/moderation/mute-scheduler.ts";
import { muteMutationKey, muteMutationLock } from "@aripabot/core/moderation/mute-mutation-lock.ts";
import {
  botCanManageMemberRoles,
  botCanManageRole,
  botCanTimeoutMember,
  buildAuditReason,
  fetchGuildRole,
  formatReason,
  formatUserLabel,
  getInvokerHierarchyErrorForMember,
  parseTrailingDryRunFlag,
  replyUsage,
  resolveModerationSubject,
  sendModerationDm,
  sendModerationLog,
} from "@aripabot/core/moderation/moderation-helpers.ts";

const unmuteAction = {
  name: "unmute",
  requiredUserPermissions: ["ModerateMembers"],
  description: "Remove a mute role or Discord timeout from a member.",
  usage: "<target> [reason]",
  async execute(context) {
    return unmuteMember(context);
  },
} satisfies Action;

export default unmuteAction;

interface UnmuteDependencies {
  activeMuteStore?: ActiveMuteStore;
  scheduler?: MuteScheduler;
  guildConfigStore?: GuildConfigStore;
}

export async function unmuteMember(
  context: ActionContext,
  dependencies: UnmuteDependencies = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Unmute can only be used from inside a server.");
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

  const guildId = context.message.guildId;
  const member = subject.member;

  const activeMuteStore = dependencies.activeMuteStore ?? getActiveMuteStore();
  const scheduler = dependencies.scheduler ?? getMuteScheduler(context.log);
  const reason = parsedInvocation.args.slice(1).join(" ").trim() || null;
  const activeMute = activeMuteStore.get(context.message.guildId, subject.user.id);
  const timeoutActive = subject.member.communicationDisabledUntilTimestamp
    ? subject.member.communicationDisabledUntilTimestamp > Date.now()
    : false;

  if (!activeMute && !timeoutActive) {
    return context.reply(`${formatUserLabel(subject.user.id)} is not muted.`);
  }

  const invokerHierarchyError = getInvokerHierarchyErrorForMember(
    context,
    subject.member,
    "unmute",
  );

  if (invokerHierarchyError) {
    return context.reply(invokerHierarchyError);
  }

  if (activeMute) {
    const muteRole = await fetchGuildRole(context.message.guild, activeMute.muteRoleId);

    if (muteRole && subject.member.roles.cache.has(muteRole.id)) {
      if (!botCanManageRole(muteRole)) {
        return context.reply(
          `I cannot remove the mute role from ${formatUserLabel(subject.user.id)}.`,
        );
      }

      if (!botCanManageMemberRoles(subject.member)) {
        return context.reply(
          `I cannot manage ${formatUserLabel(subject.user.id)} because their role is above mine.`,
        );
      }

      if (!parsedInvocation.dryRun) {
        await muteMutationLock.run(muteMutationKey(guildId, subject.user.id), async () => {
          await member.roles.remove(muteRole.id, buildAuditReason(context, "Unmute", reason));
          scheduler.cancel(guildId, subject.user.id);
        });
      }
    }

    if (!parsedInvocation.dryRun && (!muteRole || !subject.member.roles.cache.has(muteRole.id))) {
      await muteMutationLock.run(muteMutationKey(guildId, subject.user.id), async () => {
        scheduler.cancel(guildId, subject.user.id);
      });
    }
  }

  if (timeoutActive) {
    if (!botCanTimeoutMember(subject.member)) {
      return context.reply(`I cannot clear the timeout for ${formatUserLabel(subject.user.id)}.`);
    }

    if (!parsedInvocation.dryRun) {
      await subject.member.timeout(null, buildAuditReason(context, "Unmute", reason));
    }
  }

  const dmDelivered = parsedInvocation.dryRun
    ? false
    : await sendModerationDm({
        user: subject.user,
        context,
        content: [
          `You were unmuted in ${context.message.guild.name}.`,
          `Reason: ${formatReason(reason)}`,
        ].join("\n"),
      });

  await sendModerationLog({
    context,
    title: "Unmute",
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
      removedRoleMute: Boolean(activeMute),
      clearedTimeout: timeoutActive,
      dryRun: parsedInvocation.dryRun,
    })
    .info(parsedInvocation.dryRun ? "Dry-run unmuted member." : "Unmuted member.");

  return context.reply(
    `${parsedInvocation.dryRun ? "Dry run: would unmute" : "Unmuted"} ${formatUserLabel(subject.user.id)}.`,
  );
}
