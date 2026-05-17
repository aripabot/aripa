import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { resolveRoleReference, resolveUserReference } from "@/commands/command-resolvers.ts";
import { getGuildConfigStore, type GuildConfigStore } from "@/config/guild-config-store.ts";
import {
  buildAuditReason,
  fetchGuildRole,
  formatRoleLabel,
  formatUserLabel,
  getInvokerHierarchyErrorForMember,
  getInvokerHierarchyErrorForRole,
  isMissingBotPermissionsForRoleAction,
  parseTrailingDryRunFlag,
  replyUsage,
  resolveModerationSubject,
  sendModerationLog,
} from "@/moderation/moderation-helpers.ts";

const roleAction = {
  name: "role",
  requiredUserPermissions: ["ManageRoles"],
  description: "Add or remove a role from a member.",
  usage: "<add | remove> <target> <role>",
  async execute(context) {
    return updateMemberRole(context);
  },
} satisfies Action;

export default roleAction;

export async function updateMemberRole(
  context: ActionContext,
  dependencies: { guildConfigStore?: GuildConfigStore } = {},
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Role can only be used from inside a server.");
  }

  const parsedInvocation = parseTrailingDryRunFlag(context.args);
  const subaction = parsedInvocation.args[0]?.toLowerCase();

  if (subaction !== "add" && subaction !== "remove") {
    return replyUsage(context, "<add | remove> <target> <role>");
  }

  const rawTarget = parsedInvocation.args[1];
  const rawRole = parsedInvocation.args[2];

  if (!rawTarget || !rawRole) {
    return replyUsage(context, "<add | remove> <target> <role>");
  }

  const resolvedTarget = resolveUserReference(rawTarget);

  if (!resolvedTarget.ok) {
    return context.reply(resolvedTarget.error.message);
  }

  const resolvedRole = resolveRoleReference(rawRole);

  if (!resolvedRole.ok) {
    return context.reply(resolvedRole.error.message);
  }

  const subject = await resolveModerationSubject(context, resolvedTarget.value.id);

  if (!subject?.member) {
    return context.reply("I could not find that member in this server.");
  }

  const role = await fetchGuildRole(context.message.guild, resolvedRole.value.id);

  if (!role) {
    return context.reply("I could not find that role in this server.");
  }

  const invokerMemberHierarchyError = getInvokerHierarchyErrorForMember(
    context,
    subject.member,
    "manage",
  );

  if (invokerMemberHierarchyError) {
    return context.reply(invokerMemberHierarchyError);
  }

  const invokerRoleHierarchyError = getInvokerHierarchyErrorForRole(context, role, "manage");

  if (invokerRoleHierarchyError) {
    return context.reply(invokerRoleHierarchyError);
  }

  const roleActionError = isMissingBotPermissionsForRoleAction(role, subject.member);

  if (roleActionError) {
    return context.reply(roleActionError);
  }

  if (!parsedInvocation.dryRun) {
    if (subaction === "add") {
      await subject.member.roles.add(role.id, buildAuditReason(context, "Role Add", null));
    } else {
      await subject.member.roles.remove(role.id, buildAuditReason(context, "Role Remove", null));
    }
  }

  await sendModerationLog({
    context,
    title: subaction === "add" ? "Role Add" : "Role Remove",
    store: dependencies.guildConfigStore ?? getGuildConfigStore(),
    dryRun: parsedInvocation.dryRun,
    details: [
      `User: ${formatUserLabel(subject.user.id)}`,
      `Moderator: ${formatUserLabel(context.message.author.id)}`,
      `Role: ${formatRoleLabel(role.id)}`,
    ],
  });

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      userId: subject.user.id,
      moderatorId: context.message.author.id,
      roleId: role.id,
      subaction,
      dryRun: parsedInvocation.dryRun,
    })
    .info(parsedInvocation.dryRun ? "Dry-run updated member role." : "Updated member role.");

  return context.reply(
    `${parsedInvocation.dryRun ? `Dry run: would ${subaction}` : subaction === "add" ? "Added" : "Removed"} ${formatRoleLabel(role.id)} ${subaction === "add" ? "to" : "from"} ${formatUserLabel(subject.user.id)}.`,
  );
}
