import { describe, expect, test } from "vitest";
import type { PermissionResolvable } from "discord.js";
import type { ActionContext } from "@aripabot/core/bot/action.ts";
import { configureMuteRole } from "@aripabot/bot/actions/admin/muterole.ts";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";

const guildId = "999999999999999999";
const roleId = "222222222222222222";

describe("configureMuteRole", () => {
  test("stores a mute role from a role mention", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [`<@&${roleId}>`],
        replies,
      });

      await configureMuteRole(context, store);

      expect(store.getGuildConfig(guildId)).toMatchObject({
        muteRoleId: roleId,
        muteMode: "role",
      });
      expect(replies).toEqual([`Mute configuration set to role <@&${roleId}> (\`${roleId}\`).`]);
    } finally {
      store.close();
    }
  });

  test("stores timeout mode", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["timeout"],
        replies,
      });

      await configureMuteRole(context, store);

      expect(store.getGuildConfig(guildId)).toMatchObject({
        muteRoleId: null,
        muteMode: "timeout",
      });
      expect(replies).toEqual(["Mute configuration set to Discord timeout."]);
    } finally {
      store.close();
    }
  });

  test("clears mute configuration with none", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setMuteRole(guildId, roleId);

      const context = createContext({
        args: ["none"],
        replies,
      });

      await configureMuteRole(context, store);

      expect(store.getGuildConfig(guildId)).toMatchObject({
        muteRoleId: null,
        muteMode: "none",
      });
      expect(replies).toEqual(["Mute configuration cleared."]);
    } finally {
      store.close();
    }
  });

  test("returns usage when no argument is provided", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [],
        replies,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual(["Usage: `-muterole <role mention | role id | timeout | none>`"]);
    } finally {
      store.close();
    }
  });

  test("returns usage and current timeout mode when no argument is provided", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setMuteMode(guildId, "timeout");

      const context = createContext({
        args: [],
        replies,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual([
        "Usage: `-muterole <role mention | role id | timeout | none>`\n\nCurrent mute configuration:\nDiscord timeout",
      ]);
    } finally {
      store.close();
    }
  });

  test("returns usage and current role when no argument is provided", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setMuteRole(guildId, roleId);

      const context = createContext({
        args: [],
        replies,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual([
        `Usage: \`-muterole <role mention | role id | timeout | none>\`\n\nCurrent mute configuration:\n@Muted (\`${roleId}\`)`,
      ]);
    } finally {
      store.close();
    }
  });

  test("rejects extra arguments", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [roleId, "extra"],
        replies,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual(["Usage: `-muterole <role mention | role id | timeout | none>`"]);
    } finally {
      store.close();
    }
  });

  test("rejects invalid role references", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["not-a-role"],
        replies,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual(['Expected a role mention or ID, got "not-a-role".']);
    } finally {
      store.close();
    }
  });

  test("rejects roles that are not in the guild", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [roleId],
        replies,
        includeRole: false,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual(["I could not find that role in this server."]);
    } finally {
      store.close();
    }
  });

  test("rejects configuring a mute role without ManageRoles", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [roleId],
        replies,
        invokerPermissions: ["ManageGuild"],
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual([
        "You do not have permission to set a mute role. Missing: `ManageRoles`.",
      ]);
      expect(store.getGuildConfig(guildId)).toBeNull();
    } finally {
      store.close();
    }
  });

  test("rejects roles that grant permissions", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [roleId],
        replies,
        rolePermissions: ["BanMembers", "KickMembers"],
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual([
        `I cannot use <@&${roleId}> (\`${roleId}\`) as the mute role because it grants permissions. Remove these permissions first: \`BanMembers\`, \`KickMembers\`. A mute role must not grant any permissions.`,
      ]);
      expect(store.getGuildConfig(guildId)).toBeNull();
    } finally {
      store.close();
    }
  });

  test("rejects roles the invoker cannot manage", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [roleId],
        replies,
        invokerTopRolePosition: 5,
        rolePosition: 10,
      });

      await configureMuteRole(context, store);

      expect(replies).toEqual([
        `You cannot set as the mute role <@&${roleId}> (\`${roleId}\`) because it is equal to or above your highest role.`,
      ]);
      expect(store.getGuildConfig(guildId)).toBeNull();
    } finally {
      store.close();
    }
  });
});

interface CreateContextOptions {
  args: string[];
  replies: string[];
  includeRole?: boolean;
  invokerPermissions?: readonly PermissionResolvable[];
  invokerTopRolePosition?: number;
  rolePermissions?: readonly PermissionResolvable[];
  rolePosition?: number;
  roleEditable?: boolean;
}

function createContext({
  args,
  replies,
  includeRole = true,
  invokerPermissions = ["ManageGuild", "ManageRoles"],
  invokerTopRolePosition = 50,
  rolePermissions = [],
  rolePosition = 10,
  roleEditable = true,
}: CreateContextOptions): ActionContext {
  const role = {
    id: roleId,
    name: "Muted",
    guild: { id: guildId },
    position: rolePosition,
    editable: roleEditable,
    permissions: {
      toArray: () => [...rolePermissions],
    },
  };

  return {
    client: {} as never,
    message: {
      author: { id: "user-id" },
      guildId,
      inGuild: () => true,
      member: {
        id: "user-id",
        guild: { ownerId: "owner-id" },
        roles: {
          highest: {
            position: invokerTopRolePosition,
          },
        },
      },
      guild: {
        ownerId: "owner-id",
        roles: {
          cache: {
            get: (id: string) => (includeRole && id === roleId ? role : undefined),
          },
          fetch: async () => null,
        },
      },
    },
    args,
    argTokens: [],
    tokens: [],
    rawArgs: args.join(" "),
    prefix: "-",
    actionName: "muterole",
    actions: {} as never,
    isAgent: false,
    agentReplies: [],
    invoker: {
      user: { id: "user-id" } as never,
      member: {
        id: "user-id",
        guild: { ownerId: "owner-id" },
        roles: {
          highest: {
            position: invokerTopRolePosition,
          },
        },
      } as never,
      permissions: null,
      can: (permission: PermissionResolvable) => invokerPermissions.includes(permission),
    },
    log: {
      withMetadata() {
        return this;
      },
      info() {},
    } as never,
    reply: async (content: string) => {
      replies.push(content);
      return content;
    },
  } as never;
}
