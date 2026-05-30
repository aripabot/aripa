import type { BaseMessageOptions, Client, MessageCreateOptions } from "discord.js";
import type { LogLayer } from "loglayer";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";

export interface SendModLogOptions {
  client: Client;
  guildId: string;
  content?: string;
  embeds?: MessageCreateOptions["embeds"];
  log: LogLayer;
  store?: GuildConfigStore;
}

export async function sendModLog({
  client,
  guildId,
  content,
  embeds,
  log,
  store = getGuildConfigStore(),
}: SendModLogOptions): Promise<boolean> {
  const config = store.getGuildConfig(guildId);
  const channelId = config?.logChannelId;

  if (!config?.modLogsEnabled || !channelId) {
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch((error: unknown) => {
    log
      .withError(error)
      .withMetadata({ guildId, channelId })
      .warn("Failed to fetch configured mod log channel.");
    return null;
  });

  if (!channel || !channel.isTextBased()) {
    log
      .withMetadata({ guildId, channelId })
      .warn("Configured mod log channel is missing or is not text-based.");
    return false;
  }

  const sendableChannel: unknown = channel;

  if (!isSendableChannel(sendableChannel)) {
    log
      .withMetadata({ guildId, channelId })
      .warn("Configured mod log channel is text-based but not sendable.");
    return false;
  }

  try {
    await sendableChannel.send({
      content,
      embeds,
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
      },
    });
  } catch (error) {
    log
      .withError(error)
      .withMetadata({ guildId, channelId })
      .warn("Failed to send moderation log message.");
    return false;
  }

  return true;
}

interface SendableChannel {
  send: (options: string | MessageCreateOptions | BaseMessageOptions) => Promise<unknown>;
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel);
}
