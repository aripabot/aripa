import type { Action, ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";
import type { GuildMember } from "discord.js";
import {
  resolveDuration,
  resolveUserReference,
} from "@aripabot/core/commands/command-resolvers.ts";
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
  botCanManageRole,
  botCanManageMemberRoles,
  botCanTimeoutMember,
  buildAuditReason,
  fetchGuildRole,
  formatDuration,
  formatReason,
  formatRoleLabel,
  formatUserLabel,
  getInvokerHierarchyErrorForMember,
  parseTrailingDryRunFlag,
  replyUsage,
  resolveModerationSubject,
  sendModerationDm,
  sendModerationLog,
  validateTimeoutDuration,
} from "@aripabot/core/moderation/moderation-helpers.ts";

const muteAction = {
  name: "mute",
  requiredUserPermissions: ["ModerateMembers"],
  aliases: ["tempmute"],
  description: "Mute a member with the configured mute role or Discord timeout.",
  usage: "<target> [duration] [reason]",
  async execute(context) {
    return muteMember(context);
  },
} satisfies Action;

export default muteAction;

interface MuteDependencies {
  guildConfigStore?: GuildConfigStore;
  activeMuteStore?: ActiveMuteStore;
  scheduler?: MuteScheduler;
}

export async function muteMember(
  context: ActionContext,
  dependencies: MuteDependencies = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Mute can only be used from inside a server.");
  }

  const parsedInvocation = parseTrailingDryRunFlag(context.args);
  const rawTarget = parsedInvocation.args[0];

  if (!rawTarget) {
    return replyUsage(context, "<target> [duration] [reason]");
  }

  const resolvedTarget = resolveUserReference(rawTarget);

  if (!resolvedTarget.ok) {
    return context.reply(resolvedTarget.error.message);
  }

  const subject = await resolveModerationSubject(context, resolvedTarget.value.id);

  if (!subject?.member) {
    return context.reply("I could not find that member in this server.");
  }

  const invokerHierarchyError = getInvokerHierarchyErrorForMember(context, subject.member, "mute");

  if (invokerHierarchyError) {
    return context.reply(invokerHierarchyError);
  }

  const guildConfigStore = dependencies.guildConfigStore ?? getGuildConfigStore();
  const activeMuteStore = dependencies.activeMuteStore ?? getActiveMuteStore();
  const scheduler = dependencies.scheduler ?? getMuteScheduler(context.log);
  const guildConfig = guildConfigStore.getGuildConfig(context.message.guildId);

  if (!guildConfig || guildConfig.muteMode === "none") {
    return context.reply(
      `Mute behavior is not configured. Set it with \`${context.prefix}muterole <role mention | role id | timeout>\`.`,
    );
  }

  const parsedTiming = parseOptionalMuteDuration(parsedInvocation.args);

  if (!parsedTiming.ok) {
    return context.reply(parsedTiming.message);
  }

  const reason =
    parsedInvocation.args.slice(parsedTiming.reasonStartIndex).join(" ").trim() || null;

  if (guildConfig.muteMode === "timeout") {
    if (!parsedTiming.durationMs) {
      return context.reply(
        `Discord timeout mode requires a duration. Usage: \`${context.prefix}${context.actionName} <target> <duration> [reason]\`.`,
      );
    }

    if (!botCanTimeoutMember(subject.member)) {
      return context.reply(
        `I cannot timeout ${formatUserLabel(subject.user.id)} because their role is above mine.`,
      );
    }

    const timeoutValidationMessage = validateTimeoutDuration(parsedTiming.durationMs);

    if (timeoutValidationMessage) {
      return context.reply(timeoutValidationMessage);
    }

    if (!parsedInvocation.dryRun) {
      await subject.member.timeout(
        parsedTiming.durationMs,
        buildAuditReason(context, "Mute", reason),
      );
    }

    const dmDelivered = parsedInvocation.dryRun
      ? false
      : await sendModerationDm({
          user: subject.user,
          context,
          content: [
            `You were muted in ${context.message.guild.name}.`,
            `Duration: ${formatDuration(parsedTiming.durationMs)}`,
            `Reason: ${formatReason(reason)}`,
          ].join("\n"),
        });

    await sendModerationLog({
      context,
      title: "Mute",
      store: guildConfigStore,
      dryRun: parsedInvocation.dryRun,
      details: [
        `User: ${formatUserLabel(subject.user.id)}`,
        `Moderator: ${formatUserLabel(context.message.author.id)}`,
        `Mode: Discord timeout`,
        `Duration: ${formatDuration(parsedTiming.durationMs)}`,
        `Reason: ${formatReason(reason)}`,
        `DM: ${parsedInvocation.dryRun ? "skipped" : dmDelivered ? "sent" : "failed"}`,
      ],
    });

    context.log
      .withMetadata({
        guildId: context.message.guildId,
        userId: subject.user.id,
        moderatorId: context.message.author.id,
        muteMode: "timeout",
        durationMs: parsedTiming.durationMs,
        reason,
        dryRun: parsedInvocation.dryRun,
      })
      .info(
        parsedInvocation.dryRun
          ? "Dry-run muted member with Discord timeout."
          : "Muted member with Discord timeout.",
      );

    return context.reply(
      `${parsedInvocation.dryRun ? "Dry run: would mute" : "Muted"} ${formatUserLabel(subject.user.id)} for ${formatDuration(parsedTiming.durationMs)} with Discord timeout.`,
    );
  }

  const muteRoleId = guildConfig.muteRoleId;

  if (!muteRoleId) {
    return context.reply(
      `Mute role mode is configured without a role. Set it with \`${context.prefix}muterole <role mention | role id>\`.`,
    );
  }

  const muteRole = await fetchGuildRole(context.message.guild, muteRoleId);

  if (!muteRole) {
    return context.reply(
      `The configured mute role (\`${muteRoleId}\`) no longer exists. Set a new one with \`${context.prefix}muterole\`.`,
    );
  }

  if (!botCanManageRole(muteRole)) {
    return context.reply(
      `I cannot manage ${formatRoleLabel(muteRole.id)} because my highest role is not above it.`,
    );
  }

  const grantedPermissions = muteRole.permissions.toArray();

  if (grantedPermissions.length > 0) {
    return context.reply(
      [
        `I cannot use ${formatRoleLabel(muteRole.id)} as the mute role because it grants permissions.`,
        `Remove these permissions first: ${formatPermissionList(grantedPermissions)}.`,
        "A mute role must not grant any permissions.",
      ].join(" "),
    );
  }

  if (!botCanManageMemberRoles(subject.member)) {
    return context.reply(
      `I cannot manage ${formatUserLabel(subject.user.id)} because their role is above mine.`,
    );
  }

  if (!parsedInvocation.dryRun) {
    await applyPersistentRoleMute({
      context,
      activeMuteStore,
      scheduler,
      guildId: context.message.guildId,
      muteRoleId: muteRole.id,
      userId: subject.user.id,
      member: subject.member,
      reason,
      durationMs: parsedTiming.durationMs,
    });
  }

  const dmLines = [`You were muted in ${context.message.guild.name}.`];

  if (parsedTiming.durationMs) {
    dmLines.push(`Duration: ${formatDuration(parsedTiming.durationMs)}`);
  }

  dmLines.push(`Reason: ${formatReason(reason)}`);

  const dmDelivered = parsedInvocation.dryRun
    ? false
    : await sendModerationDm({
        user: subject.user,
        context,
        content: dmLines.join("\n"),
      });

  const logDetails = [
    `User: ${formatUserLabel(subject.user.id)}`,
    `Moderator: ${formatUserLabel(context.message.author.id)}`,
    `Mode: Mute role ${formatRoleLabel(muteRole.id)}`,
  ];

  if (parsedTiming.durationMs) {
    logDetails.push(`Duration: ${formatDuration(parsedTiming.durationMs)}`);
  }

  logDetails.push(`Reason: ${formatReason(reason)}`);
  logDetails.push(`DM: ${parsedInvocation.dryRun ? "skipped" : dmDelivered ? "sent" : "failed"}`);

  await sendModerationLog({
    context,
    title: "Mute",
    store: guildConfigStore,
    dryRun: parsedInvocation.dryRun,
    details: logDetails,
  });

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      userId: subject.user.id,
      moderatorId: context.message.author.id,
      muteMode: "role",
      muteRoleId: muteRole.id,
      durationMs: parsedTiming.durationMs,
      reason,
      dryRun: parsedInvocation.dryRun,
    })
    .info(
      parsedInvocation.dryRun
        ? "Dry-run muted member with mute role."
        : "Muted member with mute role.",
    );

  const durationSuffix = parsedTiming.durationMs
    ? ` for ${formatDuration(parsedTiming.durationMs)}`
    : "";
  return context.reply(
    `${parsedInvocation.dryRun ? "Dry run: would mute" : "Muted"} ${formatUserLabel(subject.user.id)}${durationSuffix}.`,
  );
}

function parseOptionalMuteDuration(
  args: readonly string[],
):
  | { ok: true; durationMs: number | null; reasonStartIndex: number }
  | { ok: false; message: string } {
  const rawSecondArg = args[1];

  if (!rawSecondArg) {
    return { ok: true, durationMs: null, reasonStartIndex: 1 };
  }

  const resolvedDuration = resolveDuration(rawSecondArg, {
    defaultUnit: "minutes",
    minMs: 1_000,
  });

  if (resolvedDuration.ok) {
    return {
      ok: true,
      durationMs: resolvedDuration.value.milliseconds,
      reasonStartIndex: 2,
    };
  }

  if (looksLikeDurationToken(rawSecondArg)) {
    return { ok: false, message: resolvedDuration.error.message };
  }

  return { ok: true, durationMs: null, reasonStartIndex: 1 };
}

function looksLikeDurationToken(value: string): boolean {
  return /^\d+[A-Za-z]*$/.test(value);
}

function formatPermissionList(permissions: readonly unknown[]): string {
  return permissions.map((permission) => `\`${String(permission)}\``).join(", ");
}

async function applyPersistentRoleMute(options: {
  context: ActionContext;
  activeMuteStore: ActiveMuteStore;
  scheduler: MuteScheduler;
  guildId: string;
  muteRoleId: string;
  userId: string;
  member: GuildMember;
  reason: string | null;
  durationMs: number | null;
}): Promise<void> {
  const {
    context,
    activeMuteStore,
    scheduler,
    guildId,
    muteRoleId,
    userId,
    member,
    reason,
    durationMs,
  } = options;
  return muteMutationLock.run(muteMutationKey(guildId, userId), async () => {
    const auditReason = buildAuditReason(context, "Mute", reason);
    let recordWritten = false;

    await member.roles.add(muteRoleId, auditReason);

    try {
      const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
      const record = activeMuteStore.upsertRoleMute({
        guildId,
        userId,
        muteRoleId,
        expiresAt,
      });
      recordWritten = true;
      await scheduler.schedule(record);
    } catch (error) {
      if (recordWritten) {
        activeMuteStore.delete(guildId, userId);
      }

      try {
        await member.roles.remove(muteRoleId, buildAuditReason(context, "Mute Rollback", reason));
      } catch (rollbackError) {
        context.log
          .withError(rollbackError)
          .withMetadata({
            guildId: context.message.guildId,
            userId,
            muteRoleId,
          })
          .error("Failed to roll back mute role after persistence error.");
      }

      throw error;
    }
  });
}
