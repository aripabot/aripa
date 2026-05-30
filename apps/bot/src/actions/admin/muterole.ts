import type { PermissionResolvable, Role } from "discord.js";
import type { Action, ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";
import { resolveRoleReference } from "@aripabot/core/commands/command-resolvers.ts";
import {
  getGuildConfigStore,
  type GuildConfig,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import {
  botCanManageRole,
  formatRoleLabel,
  getInvokerHierarchyErrorForRole,
} from "@aripabot/core/moderation/moderation-helpers.ts";

const REQUIRED_MUTE_ROLE_CONFIGURATION_PERMISSION =
  "ManageRoles" as const satisfies PermissionResolvable;

const muteRoleAction = {
  name: "muterole",
  requiredUserPermissions: ["ManageGuild"],
  resolveRequiredUserPermissions(context) {
    return getMuteRoleConfigurationPermissions(context.args);
  },
  aliases: ["mute-role"],
  description: "Configure the guild mute role or timeout mode.",
  usage: "<role mention | role id | timeout | none>",
  async execute(context) {
    return configureMuteRole(context);
  },
} satisfies Action;

export default muteRoleAction;

export async function configureMuteRole(
  context: ActionContext,
  store: GuildConfigStore = getGuildConfigStore(),
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Mute configuration can only be changed from inside a server.");
  }

  if (context.args.length === 0) {
    const content = await formatUsageWithCurrent(
      context,
      store.getGuildConfig(context.message.guildId),
    );
    return context.reply(content);
  }

  if (context.args.length !== 1) {
    return context.reply(
      `Usage: \`${context.prefix}${context.actionName} <role mention | role id | timeout | none>\``,
    );
  }

  const rawTarget = context.args[0]!.trim();
  const normalizedTarget = rawTarget.toLowerCase();

  if (normalizedTarget === "none") {
    const config = store.setMuteMode(context.message.guildId, "none");
    logConfigurationChange(context, config, "Cleared guild mute configuration.");
    return context.reply("Mute configuration cleared.");
  }

  if (normalizedTarget === "timeout") {
    const config = store.setMuteMode(context.message.guildId, "timeout");
    logConfigurationChange(context, config, "Configured guild mute mode to timeout.");
    return context.reply("Mute configuration set to Discord timeout.");
  }

  const resolvedRole = resolveRoleReference(rawTarget);

  if (!resolvedRole.ok) {
    return context.reply(resolvedRole.error.message);
  }

  const role = await fetchGuildRole(context, resolvedRole.value.id);

  if (!role) {
    return context.reply("I could not find that role in this server.");
  }

  const validationError = validateMuteRole(context, role);

  if (validationError) {
    return context.reply(validationError);
  }

  const config = store.setMuteRole(context.message.guildId, role.id);
  logConfigurationChange(context, config, "Configured guild mute role.");

  return context.reply(`Mute configuration set to role <@&${role.id}> (\`${role.id}\`).`);
}

async function fetchGuildRole(context: ActionContext, roleId: string): Promise<Role | null> {
  const cachedRole = context.message.guild?.roles.cache.get(roleId);

  if (cachedRole) {
    return cachedRole;
  }

  const fetchedRole = await context.message.guild?.roles.fetch(roleId).catch(() => null);

  if (!fetchedRole || fetchedRole.guild.id !== context.message.guildId) {
    return null;
  }

  return fetchedRole;
}

async function formatUsageWithCurrent(
  context: ActionContext,
  config: GuildConfig | null,
): Promise<string> {
  const lines = [
    `Usage: \`${context.prefix}${context.actionName} <role mention | role id | timeout | none>\``,
  ];

  if (!config || config.muteMode === "none") {
    return lines.join("\n\n");
  }

  if (config.muteMode === "timeout") {
    lines.push("Current mute configuration:\nDiscord timeout");
    return lines.join("\n\n");
  }

  if (config.muteRoleId) {
    const role = await fetchGuildRole(context, config.muteRoleId);
    const roleLabel = role ? `@${role.name}` : `Role ID \`${config.muteRoleId}\``;
    const roleSummary = role ? `${roleLabel} (\`${config.muteRoleId}\`)` : roleLabel;
    lines.push(`Current mute configuration:\n${roleSummary}`);
  }

  return lines.join("\n\n");
}

function logConfigurationChange(
  context: ActionContext,
  config: GuildConfig,
  message: string,
): void {
  context.log
    .withMetadata({
      guildId: config.guildId,
      muteMode: config.muteMode,
      muteRoleId: config.muteRoleId,
      userId: context.message.author.id,
    })
    .info(message);
}

function validateMuteRole(context: ActionContext, role: Role): string | null {
  if (!context.invoker.can(REQUIRED_MUTE_ROLE_CONFIGURATION_PERMISSION)) {
    return `You do not have permission to set a mute role. Missing: \`${REQUIRED_MUTE_ROLE_CONFIGURATION_PERMISSION}\`.`;
  }

  const invokerHierarchyError = getInvokerHierarchyErrorForRole(
    context,
    role,
    "set as the mute role",
  );

  if (invokerHierarchyError) {
    return invokerHierarchyError;
  }

  if (!botCanManageRole(role)) {
    return `I cannot use ${formatRoleLabel(role.id)} as the mute role because my highest role is not above it.`;
  }

  const grantedPermissions = role.permissions.toArray();

  if (grantedPermissions.length > 0) {
    return [
      `I cannot use ${formatRoleLabel(role.id)} as the mute role because it grants permissions.`,
      `Remove these permissions first: ${formatPermissionList(grantedPermissions)}.`,
      "A mute role must not grant any permissions.",
    ].join(" ");
  }

  return null;
}

function formatPermissionList(permissions: readonly PermissionResolvable[]): string {
  return permissions.map((permission) => `\`${String(permission)}\``).join(", ");
}

function getMuteRoleConfigurationPermissions(args: readonly string[]): PermissionResolvable[] {
  const normalizedTarget = args[0]?.trim().toLowerCase();

  if (!normalizedTarget || normalizedTarget === "none" || normalizedTarget === "timeout") {
    return [];
  }

  return [REQUIRED_MUTE_ROLE_CONFIGURATION_PERMISSION];
}
