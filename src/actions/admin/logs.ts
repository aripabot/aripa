import {
  EmbedBuilder,
  type BaseMessageOptions,
  type GuildBasedChannel,
  type PermissionResolvable,
} from "discord.js";
import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { resolveChannelReference } from "@/commands/command-resolvers.ts";
import {
  getGuildConfigStore,
  type GuildConfig,
  type GuildConfigStore,
} from "@/config/guild-config-store.ts";

const REQUIRED_BOT_CHANNEL_PERMISSIONS = [
  "ViewChannel",
  "SendMessages",
] as const satisfies readonly PermissionResolvable[];
const REQUIRED_BOT_CONFIRMATION_PERMISSIONS = [
  ...REQUIRED_BOT_CHANNEL_PERMISSIONS,
  "EmbedLinks",
] as const satisfies readonly PermissionResolvable[];

const logsAction = {
  name: "logs",
  requiredUserPermissions: ["ManageGuild"],
  aliases: ["modlogs"],
  description: "Configure mod-log delivery.",
  usage: "<enable | disable | setchannel | getchannel> [channel mention | channel id | none]",
  async execute(context) {
    return configureLogs(context);
  },
} satisfies Action;

export default logsAction;

export async function configureLogs(
  context: ActionContext,
  store: GuildConfigStore = getGuildConfigStore(),
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    return context.reply("Logs can only be configured from inside a server.");
  }

  const guildId = context.message.guildId;
  const subaction = context.args[0]?.toLowerCase();

  switch (subaction) {
    case "enable":
      return enableLogs(context, store, guildId);
    case "disable":
      return disableLogs(context, store, guildId);
    case "setchannel":
      return setLogChannel(context, store, guildId);
    case "getchannel":
      return getLogChannel(context, store, guildId);
    default:
      return context.reply(formatUsage(context));
  }
}

async function enableLogs(
  context: ActionContext,
  store: GuildConfigStore,
  guildId: string,
): Promise<ActionReply> {
  const config = store.getGuildConfig(guildId);

  if (!config?.logChannelId) {
    return context.reply(
      `Set a log channel before enabling logs: \`${context.prefix}${context.actionName} setchannel <channel mention | channel id>\`.`,
    );
  }

  const validation = await validateLogChannel(
    context,
    config.logChannelId,
    REQUIRED_BOT_CONFIRMATION_PERMISSIONS,
  );

  if (!validation.ok) {
    return context.reply(validation.message);
  }

  const updatedConfig = store.setModLogEnabled(guildId, true);
  logConfigurationChange(context, updatedConfig, "Enabled guild mod logs.");
  const confirmationSent = await sendLogEnableConfirmation(context, validation.channel);

  if (!confirmationSent) {
    return context.reply(
      `Mod logs enabled for <#${updatedConfig.logChannelId}>, but I couldn't send the confirmation embed there.`,
    );
  }

  return context.reply(`Mod logs enabled for <#${updatedConfig.logChannelId}>.`);
}

async function disableLogs(
  context: ActionContext,
  store: GuildConfigStore,
  guildId: string,
): Promise<ActionReply> {
  const config = store.setModLogEnabled(guildId, false);
  logConfigurationChange(context, config, "Disabled guild mod logs.");

  return context.reply("Mod logs disabled.");
}

async function setLogChannel(
  context: ActionContext,
  store: GuildConfigStore,
  guildId: string,
): Promise<ActionReply> {
  const rawChannel = context.args[1];

  if (!rawChannel) {
    return context.reply(
      `Usage: \`${context.prefix}${context.actionName} setchannel <channel mention | channel id | none>\``,
    );
  }

  if (rawChannel.toLowerCase() === "none") {
    const config = store.setLogChannel(guildId, null);
    logConfigurationChange(context, config, "Cleared guild mod log channel.");
    return context.reply("Log channel cleared and mod logs disabled.");
  }

  const resolvedChannel = resolveChannelReference(rawChannel);

  if (!resolvedChannel.ok) {
    return context.reply(resolvedChannel.error.message);
  }

  const validation = await validateLogChannel(context, resolvedChannel.value.id);

  if (!validation.ok) {
    return context.reply(validation.message);
  }

  const config = store.setLogChannel(guildId, validation.channel.id);
  logConfigurationChange(context, config, "Configured guild mod log channel.");

  const enabledState = config.modLogsEnabled ? "enabled" : "disabled";
  return context.reply(
    `Log channel set to <#${validation.channel.id}>. Mod logs are currently ${enabledState}.`,
  );
}

async function getLogChannel(
  context: ActionContext,
  store: GuildConfigStore,
  guildId: string,
): Promise<ActionReply> {
  const config = store.getGuildConfig(guildId);

  if (!config?.logChannelId) {
    return context.reply("No log channel is configured.");
  }

  const enabledState = config.modLogsEnabled ? "enabled" : "disabled";
  return context.reply(
    `Log channel: <#${config.logChannelId}> (\`${config.logChannelId}\`). Mod logs are ${enabledState}.`,
  );
}

async function validateLogChannel(
  context: ActionContext,
  channelId: string,
  requiredPermissions: readonly PermissionResolvable[] = REQUIRED_BOT_CHANNEL_PERMISSIONS,
): Promise<{ ok: true; channel: GuildBasedChannel } | { ok: false; message: string }> {
  const channel = await fetchGuildChannel(context, channelId);

  if (!channel) {
    return { ok: false, message: "I could not find that channel in this server." };
  }

  if (!channel.isTextBased()) {
    return { ok: false, message: "The log channel must be a text-based channel." };
  }

  const botPermissions = context.client.user ? channel.permissionsFor(context.client.user) : null;
  const missingBotPermissions = requiredPermissions.filter(
    (permission) => !botPermissions?.has(permission),
  );

  if (missingBotPermissions.length > 0) {
    return {
      ok: false,
      message: `I need ${formatPermissionList(missingBotPermissions)} in <#${channel.id}> before I can use it as a log channel.`,
    };
  }

  return { ok: true, channel };
}

async function sendLogEnableConfirmation(
  context: ActionContext,
  channel: GuildBasedChannel,
): Promise<boolean> {
  const sendableChannel: unknown = channel;

  if (!isSendableChannel(sendableChannel)) {
    return false;
  }

  const embed = new EmbedBuilder()
    .setTitle("Logs Enabled")
    .setDescription("Mod logs have been enabled in this channel.")
    .setColor(0x2ecc71);

  try {
    await sendableChannel.send({
      embeds: [embed],
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
      },
    });
    return true;
  } catch (error) {
    context.log
      .withError(error)
      .withMetadata({
        guildId: context.message.guildId,
        channelId: channel.id,
      })
      .warn("Failed to send mod log enable confirmation.");
    return false;
  }
}

async function fetchGuildChannel(
  context: ActionContext,
  channelId: string,
): Promise<GuildBasedChannel | null> {
  const cachedChannel = context.message.guild?.channels.cache.get(channelId);

  if (cachedChannel) {
    return cachedChannel;
  }

  const fetchedChannel = await context.message.guild?.channels.fetch(channelId).catch(() => null);

  if (!fetchedChannel || fetchedChannel.guildId !== context.message.guildId) {
    return null;
  }

  return fetchedChannel;
}

function logConfigurationChange(
  context: ActionContext,
  config: GuildConfig,
  message: string,
): void {
  context.log
    .withMetadata({
      guildId: config.guildId,
      channelId: config.logChannelId,
      modLogsEnabled: config.modLogsEnabled,
      userId: context.message.author.id,
    })
    .info(message);
}

function formatUsage(context: ActionContext): string {
  return [
    "Usage:",
    `\`${context.prefix}${context.actionName} enable\``,
    `\`${context.prefix}${context.actionName} disable\``,
    `\`${context.prefix}${context.actionName} setchannel <channel mention | channel id | none>\``,
    `\`${context.prefix}${context.actionName} getchannel\``,
  ].join("\n");
}

function formatPermissionList(permissions: readonly PermissionResolvable[]): string {
  return permissions.map((permission) => `\`${permission}\``).join(", ");
}

interface SendableChannel {
  send: (options: string | BaseMessageOptions) => Promise<unknown>;
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel);
}
