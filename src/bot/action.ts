import type {
  Client,
  GuildMember,
  Message,
  PermissionResolvable,
  PermissionsBitField,
  User,
} from "discord.js";
import type { LogLayer } from "loglayer";
import type { ActionDirectory } from "@/bot/action-loader.ts";
import type { CommandToken } from "@/commands/command-tokenizer.ts";

export type ActionReply = Message | string | null;

export interface ActionContext {
  client: Client;
  message: Message;
  args: string[];
  argTokens: CommandToken[];
  tokens: CommandToken[];
  rawArgs: string;
  prefix: string;
  actionName: string;
  actions: ActionDirectory;
  isAgent: boolean;
  agentReplies: string[];
  invoker: {
    user: User;
    member: GuildMember | null;
    permissions: Readonly<PermissionsBitField> | null;
    can: (permission: PermissionResolvable) => boolean;
  };
  log: LogLayer;
  reply: (content: string) => Promise<ActionReply>;
}

export interface Action {
  name: string;
  requiredUserPermissions: readonly PermissionResolvable[];
  resolveRequiredUserPermissions?: (
    context: ActionContext,
  ) => readonly PermissionResolvable[] | Promise<readonly PermissionResolvable[]>;
  aliases?: string[];
  description?: string;
  usage?: string;
  hidden?: boolean;
  execute: (context: ActionContext) => Promise<ActionReply | void> | ActionReply | void;
}
