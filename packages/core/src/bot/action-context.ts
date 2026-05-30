import type {
  BaseMessageOptions,
  Client,
  Message,
  MessageCreateOptions,
  PermissionResolvable,
  PermissionsBitField,
} from "discord.js";
import type { LogLayer } from "loglayer";
import type { ActionContext } from "@aripabot/core/bot/action.ts";
import type { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";
import type { CommandToken } from "@aripabot/core/commands/command-tokenizer.ts";

interface CreateActionContextOptions {
  client: Client;
  message: Message;
  args: string[];
  argTokens?: readonly CommandToken[];
  tokens?: readonly CommandToken[];
  rawArgs: string;
  prefix: string;
  actionName: string;
  actions: ActionDirectory;
  log: LogLayer;
  isAgent?: boolean;
}

export function createActionContext(options: CreateActionContextOptions): ActionContext {
  const permissions = getInvokerPermissions(options.message);
  const isAgent = options.isAgent ?? false;
  const agentReplies: string[] = [];

  return {
    ...options,
    argTokens: [...(options.argTokens ?? [])],
    tokens: [...(options.tokens ?? [])],
    isAgent,
    agentReplies,
    invoker: {
      user: options.message.author,
      member: options.message.member,
      permissions,
      can: (permission: PermissionResolvable) => permissions?.has(permission) ?? false,
    },
    reply: async (content: string) => {
      if (!isAgent) {
        return safeReply(options.message, content, options.log);
      }

      const agentReply = formatAgentReply(options.actionName, content);
      agentReplies.push(agentReply);
      return agentReply;
    },
  };
}

export function formatAgentReply(actionName: string, content: string, ok = true): string {
  return JSON.stringify({
    type: "action_reply",
    action: actionName,
    ok,
    message: content,
  });
}

export async function safeReply(
  message: Message,
  content: string,
  log: LogLayer,
): Promise<Message | null> {
  return safeReplyWithOptions(
    message,
    {
      content,
    },
    log,
  );
}

export async function safeReplyWithOptions(
  message: Message,
  options: BaseMessageOptions | MessageCreateOptions,
  log: LogLayer,
): Promise<Message | null> {
  try {
    return await message.reply({
      ...options,
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: false,
      },
    });
  } catch (error) {
    log
      .withError(error)
      .withMetadata({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
      })
      .warn("Failed to send action reply.");

    return null;
  }
}

function getInvokerPermissions(message: Message): Readonly<PermissionsBitField> | null {
  if (!message.inGuild() || !message.member || !("permissionsFor" in message.channel)) {
    return null;
  }

  return message.channel.permissionsFor(message.member);
}
