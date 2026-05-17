import type { ActionContext } from "@/bot/action.ts";

export const guildId = "999999999999999999";
export const guildName = "Test Guild";
export const channelId = "111111111111111111";
export const logChannelId = "222222222222222222";
export const targetUserId = "333333333333333333";
export const moderatorId = "444444444444444444";
export const roleId = "555555555555555555";
export const guildOwnerId = "666666666666666666";

interface CreateHarnessOptions {
  args: string[];
  actionName: string;
  memberPresent?: boolean;
  rolePresent?: boolean;
  roleName?: string;
  rolePermissions?: string[];
  invokerTopRolePosition?: number;
  targetTopRolePosition?: number;
  rolePosition?: number;
  targetIsOwner?: boolean;
  communicationDisabledUntilTimestamp?: number | null;
  messageBatches?: Array<Map<string, FakeMessage>>;
  targetSendFails?: boolean;
  targetCreateDmFails?: boolean;
  banFails?: boolean;
  kickFails?: boolean;
  modLogSendFails?: boolean;
}

export interface FakeMessage {
  id: string;
  author: { id: string };
  delete: () => Promise<void>;
}

export function createModerationHarness({
  args,
  actionName,
  memberPresent = true,
  rolePresent = true,
  roleName = "Muted",
  rolePermissions = [],
  invokerTopRolePosition = 20,
  targetTopRolePosition = 10,
  rolePosition = 5,
  targetIsOwner = false,
  communicationDisabledUntilTimestamp = null,
  messageBatches = [],
  targetSendFails = false,
  targetCreateDmFails = false,
  banFails = false,
  kickFails = false,
  modLogSendFails = false,
}: CreateHarnessOptions) {
  const replies: string[] = [];
  const dmMessages: unknown[] = [];
  const modLogMessages: unknown[] = [];
  const kickCalls: unknown[] = [];
  const timeoutCalls: unknown[] = [];
  const roleAddCalls: unknown[] = [];
  const roleRemoveCalls: unknown[] = [];
  const banCalls: unknown[] = [];
  const unbanCalls: unknown[] = [];
  const eventLog: string[] = [];
  const messageFetchCalls: Array<{ limit: number; before?: string }> = [];

  const targetUser = {
    id: targetUserId,
    username: "target-user",
    createDM: async () => {
      if (targetCreateDmFails) {
        throw new Error("DM create failed");
      }

      return {
        send: async (message: unknown) => {
          if (targetSendFails) {
            throw new Error("DM disabled");
          }

          eventLog.push("dm");
          dmMessages.push(message);
          return message;
        },
      };
    },
    send: async (message: unknown) => {
      if (targetSendFails) {
        throw new Error("DM disabled");
      }

      eventLog.push("dm");
      dmMessages.push(message);
      return message;
    },
  };

  const muteRole = {
    id: roleId,
    name: roleName,
    position: rolePosition,
    editable: true,
    permissions: {
      toArray: () => rolePermissions,
    },
    guild: { id: guildId, ownerId: guildOwnerId },
  };

  const targetHighestRole = {
    id: "777777777777777777",
    name: "Target Role",
    position: targetTopRolePosition,
  };

  const invokerHighestRole = {
    id: "888888888888888888",
    name: "Moderator Role",
    position: invokerTopRolePosition,
  };

  const targetMember = {
    id: targetUserId,
    user: targetUser,
    guild: {
      id: guildId,
      ownerId: targetIsOwner ? targetUserId : guildOwnerId,
      members: { me: { permissions: { has: () => true } } },
    },
    manageable: true,
    bannable: true,
    kickable: true,
    moderatable: true,
    communicationDisabledUntilTimestamp,
    roles: {
      highest: targetHighestRole,
      cache: new Map([
        [targetHighestRole.id, targetHighestRole],
        ...(rolePresent ? [[roleId, muteRole] as const] : []),
      ]),
      add: async (nextRoleId: string, reason?: string) => {
        roleAddCalls.push({ roleId: nextRoleId, reason });
      },
      remove: async (nextRoleId: string, reason?: string) => {
        roleRemoveCalls.push({ roleId: nextRoleId, reason });
      },
    },
    kick: async (reason?: string) => {
      eventLog.push("kick");
      if (kickFails) {
        throw new Error("Kick failed");
      }

      kickCalls.push(reason);
    },
    timeout: async (duration: number | null, reason?: string) => {
      timeoutCalls.push({ duration, reason });
    },
  };

  const invokerMember = {
    id: moderatorId,
    guild: {
      id: guildId,
      ownerId: guildOwnerId,
    },
    roles: {
      highest: invokerHighestRole,
      cache: new Map([[invokerHighestRole.id, invokerHighestRole]]),
    },
  };

  let nextMessageBatchIndex = 0;

  const guild = {
    id: guildId,
    name: guildName,
    ownerId: targetIsOwner ? targetUserId : guildOwnerId,
    roles: {
      cache: new Map(rolePresent ? [[roleId, muteRole]] : []),
      fetch: async (id: string) => (id === roleId && rolePresent ? muteRole : null),
    },
    members: {
      me: { permissions: { has: () => true } },
      fetch: async (id: string) => (memberPresent && id === targetUserId ? targetMember : null),
      ban: async (id: string, options: unknown) => {
        eventLog.push("ban");
        if (banFails) {
          throw new Error("Ban failed");
        }

        banCalls.push({ id, options });
      },
      unban: async (id: string, reason?: string) => {
        unbanCalls.push({ id, reason });
      },
    },
  };

  const context: ActionContext = {
    client: {
      users: {
        fetch: async (id: string) => (id === targetUserId ? targetUser : null),
      },
      channels: {
        fetch: async (id: string) =>
          id === logChannelId
            ? {
                isTextBased: () => true,
                send: async (message: unknown) => {
                  if (modLogSendFails) {
                    throw new Error("Mod log send failed");
                  }

                  modLogMessages.push(message);
                  return message;
                },
              }
            : null,
      },
    } as never,
    message: {
      id: "message-id",
      author: {
        id: moderatorId,
        username: "moderator",
      },
      guildId,
      guild,
      member: invokerMember,
      channelId,
      channel: {
        messages: {
          fetch: async (options: { limit: number; before?: string }) => {
            messageFetchCalls.push(options);
            return messageBatches[nextMessageBatchIndex++] ?? new Map<string, FakeMessage>();
          },
        },
      },
      inGuild: () => true,
    } as never,
    args,
    argTokens: [],
    tokens: [],
    rawArgs: args.join(" "),
    prefix: "-",
    actionName,
    actions: {} as never,
    isAgent: false,
    agentReplies: [],
    invoker: {
      user: { id: moderatorId } as never,
      member: invokerMember as never,
      permissions: null,
      can: () => true,
    },
    log: createLog(),
    reply: async (content: string) => {
      replies.push(content);
      return content;
    },
  };

  return {
    context,
    replies,
    dmMessages,
    modLogMessages,
    kickCalls,
    timeoutCalls,
    roleAddCalls,
    roleRemoveCalls,
    banCalls,
    unbanCalls,
    eventLog,
    messageFetchCalls,
    targetMember,
    targetUser,
    muteRole,
  };
}

export function createLog() {
  return {
    withError() {
      return this;
    },
    withMetadata() {
      return this;
    },
    info() {},
    warn() {},
    error() {},
  } as never;
}
