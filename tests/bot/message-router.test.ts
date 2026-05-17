import { describe, expect, test } from "vitest";
import { ActionDirectory } from "@/bot/action-loader.ts";
import type { Action } from "@/bot/action.ts";
import { GuildConfigStore } from "@/config/guild-config-store.ts";
import {
  getMissingUserPermissions,
  handleMessage,
  shouldConfirmAgentAction,
} from "@/bot/message-router.ts";

describe("getMissingUserPermissions", () => {
  test("returns permissions the invoker does not have", () => {
    const missing = getMissingUserPermissions(["BanMembers", "ManageMessages"], (permission) => {
      return permission === "ManageMessages";
    });

    expect(missing).toEqual(["BanMembers"]);
  });

  test("returns an empty list when no permissions are required", () => {
    expect(getMissingUserPermissions([], () => false)).toEqual([]);
  });
});

describe("shouldConfirmAgentAction", () => {
  test("requires confirmation for privileged agent actions", () => {
    expect(shouldConfirmAgentAction(true, ["BanMembers"])).toBe(true);
  });

  test("does not require confirmation for normal user calls or unprivileged actions", () => {
    expect(shouldConfirmAgentAction(false, ["BanMembers"])).toBe(false);
    expect(shouldConfirmAgentAction(true, [])).toBe(false);
  });
});

describe("handleMessage tag fallback", () => {
  test("returns a guild tag when no action matches", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.upsertTag("guild-1", "politics", "No politics here.");

      const result = await handleMessage({
        client: {} as never,
        message: createMessage("-politics", replies),
        prefix: "-",
        actions: new ActionDirectory(),
        log: createLog(),
        guildConfigStore: store,
      });

      expect(result).toMatchObject({
        status: "completed",
        action: "politics",
      });
      expect(replies).toEqual(["No politics here."]);
    } finally {
      store.close();
    }
  });

  test("gives action priority over a same-named tag", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.upsertTag("guild-1", "ping", "tag ping");

      const actions = new ActionDirectory();
      const pingAction = {
        name: "ping",
        requiredUserPermissions: [],
        async execute({ reply }) {
          await reply("action ping");
        },
      } satisfies Action;
      actions.add(pingAction, "test");

      const result = await handleMessage({
        client: {} as never,
        message: createMessage("-ping", replies),
        prefix: "-",
        actions,
        log: createLog(),
        guildConfigStore: store,
      });

      expect(result).toMatchObject({
        status: "completed",
        action: "ping",
      });
      expect(replies).toEqual(["action ping"]);
    } finally {
      store.close();
    }
  });
});

describe("handleMessage agent confirmation", () => {
  test("returns unconfirmed with cancelled status when the user reacts with cancel", async () => {
    const actions = new ActionDirectory();
    const moderatedAction = {
      name: "ban",
      requiredUserPermissions: ["BanMembers"],
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const replies: string[] = [];

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-ban @user spam", replies, {
        reactionEmoji: "\u274c",
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(result).toMatchObject({
      status: "unconfirmed",
      action: "ban",
      confirmationStatus: "cancelled",
    });
    expect(replies).toEqual([]);
    expect(parseAgentReplies(result)).toEqual([
      {
        type: "action_reply",
        action: "ban",
        ok: false,
        message: "Confirmation was cancelled, so I did not run that action.",
      },
    ]);
  });

  test("does not wrap mentions in inline code in the confirmation embed", async () => {
    const actions = new ActionDirectory();
    const moderatedAction = {
      name: "clean",
      requiredUserPermissions: ["ManageMessages"],
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const confirmationDescriptions: string[] = [];

    await handleMessage({
      client: {} as never,
      message: createConfirmableMessage(
        "-clean user <@123456789012345678> <#234567890123456789>",
        [],
        {
          confirmationDescriptions,
          permissions: ["ManageMessages"],
          reactionEmoji: "\u274c",
        },
      ),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(confirmationDescriptions).toEqual([
      "I will run -clean user <@123456789012345678> <#234567890123456789>.\nReact with \u2705 to confirm or \u274c to cancel.",
    ]);
  });

  test("edits the confirmation embed green when confirmed", async () => {
    const actions = new ActionDirectory();
    let executed = false;
    const moderatedAction = {
      name: "ban",
      requiredUserPermissions: ["BanMembers"],
      async execute() {
        executed = true;
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const confirmationEmbeds: EmbedSnapshot[] = [];

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-ban <@123456789012345678> spam", [], {
        confirmationEmbeds,
        reactionEmoji: "\u2705",
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(executed).toBe(true);
    expect(result).toMatchObject({ status: "completed", action: "ban" });
    expect(confirmationEmbeds.map((embed) => ({ title: embed.title, color: embed.color }))).toEqual(
      [
        { title: "Confirm Action", color: 0xffffff },
        { title: "Action Confirmed", color: 0x2ecc71 },
      ],
    );
    expect(confirmationEmbeds[0]?.footer?.text).toMatch(/^Expires in \d+ seconds$/);
    expect(confirmationEmbeds[1]?.description).toBe(
      "Confirmed. I will run -ban <@123456789012345678> spam.",
    );
  });

  test("notifies lifecycle while waiting on agent confirmation", async () => {
    const actions = new ActionDirectory();
    const events: string[] = [];
    const moderatedAction = {
      name: "ban",
      requiredUserPermissions: ["BanMembers"],
      async execute() {
        events.push("execute");
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-ban <@123456789012345678> spam", [], {
        reactionEmoji: "\u2705",
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
      agentConfirmationLifecycle: {
        onWaitStart: () => events.push("pause"),
        onWaitEnd: () => events.push("resume"),
      },
    });

    expect(result).toMatchObject({ status: "completed", action: "ban" });
    expect(events).toEqual(["pause", "resume", "execute"]);
  });

  test("edits the confirmation embed amber when timed out", async () => {
    const actions = new ActionDirectory();
    const moderatedAction = {
      name: "ban",
      requiredUserPermissions: ["BanMembers"],
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const confirmationEmbeds: EmbedSnapshot[] = [];

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-ban <@123456789012345678> spam", [], {
        confirmationEmbeds,
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(result).toMatchObject({
      status: "unconfirmed",
      action: "ban",
      confirmationStatus: "timed_out",
    });
    expect(confirmationEmbeds.map((embed) => ({ title: embed.title, color: embed.color }))).toEqual(
      [
        { title: "Confirm Action", color: 0xffffff },
        { title: "Confirmation Timed Out", color: 0xf1c40f },
      ],
    );
  });

  test("edits the confirmation embed red when cancelled", async () => {
    const actions = new ActionDirectory();
    const moderatedAction = {
      name: "ban",
      requiredUserPermissions: ["BanMembers"],
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const confirmationEmbeds: EmbedSnapshot[] = [];

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-ban <@123456789012345678> spam", [], {
        confirmationEmbeds,
        reactionEmoji: "\u274c",
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(result).toMatchObject({
      status: "unconfirmed",
      action: "ban",
      confirmationStatus: "cancelled",
    });
    expect(confirmationEmbeds.map((embed) => ({ title: embed.title, color: embed.color }))).toEqual(
      [
        { title: "Confirm Action", color: 0xffffff },
        { title: "Action Cancelled", color: 0xe74c3c },
      ],
    );
  });

  test("returns unconfirmed with failed status when sending confirmation fails", async () => {
    const actions = new ActionDirectory();
    const moderatedAction = {
      name: "ban",
      requiredUserPermissions: ["BanMembers"],
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(moderatedAction, "test");

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-ban @user spam", [], {
        shouldThrowWhileConfirming: true,
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(result).toMatchObject({
      status: "unconfirmed",
      action: "ban",
      confirmationStatus: "failed",
    });
    expect(parseAgentReplies(result)).toEqual([
      {
        type: "action_reply",
        action: "ban",
        ok: false,
        message: "I could not confirm that action, so I did not run it.",
      },
    ]);
  });
});

describe("handleMessage dynamic action permissions", () => {
  test("denies agent actions using invocation-specific permissions before execution", async () => {
    const actions = new ActionDirectory();
    const tagAction = {
      name: "tag",
      requiredUserPermissions: [],
      resolveRequiredUserPermissions({ args }) {
        return args[0]?.toLowerCase() === "add" ? ["ManageMessages"] : [];
      },
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(tagAction, "test");

    const replies: string[] = [];

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-tag add rules Be nice", replies),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(result).toMatchObject({
      status: "denied",
      action: "tag",
      missingUserPermissions: ["ManageMessages"],
    });
    expect(replies).toEqual([]);
    expect(parseAgentReplies(result)).toEqual([
      {
        type: "action_reply",
        action: "tag",
        ok: false,
        message: "You do not have permission to run that action. Missing: `ManageMessages`.",
      },
    ]);
  });

  test("requires confirmation for invocation-specific permissions", async () => {
    const actions = new ActionDirectory();
    const tagAction = {
      name: "tag",
      requiredUserPermissions: [],
      resolveRequiredUserPermissions({ args }) {
        return args[0]?.toLowerCase() === "add" ? ["ManageMessages"] : [];
      },
      async execute() {
        throw new Error("should not run");
      },
    } satisfies Action;
    actions.add(tagAction, "test");

    const replies: string[] = [];

    const result = await handleMessage({
      client: {} as never,
      message: createConfirmableMessage("-tag add rules Be nice", replies, {
        reactionEmoji: "\u274c",
        permissions: ["ManageMessages"],
      }),
      prefix: "-",
      actions,
      log: createLog(),
      isAgent: true,
    });

    expect(result).toMatchObject({
      status: "unconfirmed",
      action: "tag",
      confirmationStatus: "cancelled",
    });
    expect(replies).toEqual([]);
    expect(parseAgentReplies(result)).toEqual([
      {
        type: "action_reply",
        action: "tag",
        ok: false,
        message: "Confirmation was cancelled, so I did not run that action.",
      },
    ]);
  });
});

function createMessage(content: string, replies: string[]) {
  return {
    author: { bot: false, id: "user-1" },
    content,
    guildId: "guild-1",
    channelId: "channel-1",
    id: "message-1",
    member: null,
    inGuild: () => true,
    reply: async ({ content }: { content?: string }) => {
      if (content) {
        replies.push(content);
      }

      return { content };
    },
  } as never;
}

function createConfirmableMessage(
  content: string,
  replies: string[],
  options: {
    reactionEmoji?: string;
    shouldThrowWhileConfirming?: boolean;
    shouldThrowWhileWaiting?: boolean;
    confirmationDescriptions?: string[];
    confirmationEmbeds?: EmbedSnapshot[];
    permissions?: string[];
  } = {},
) {
  const confirmationMessage = {
    react: async () => undefined,
    edit: async (input: { embeds?: unknown[] }) => {
      recordEmbedSnapshots(input.embeds, options.confirmationEmbeds);
      return confirmationMessage;
    },
    awaitReactions: async () => {
      if (options.shouldThrowWhileWaiting) {
        throw new Error("reaction failure");
      }

      if (options.reactionEmoji) {
        return {
          size: 1,
          first: () => ({
            emoji: {
              name: options.reactionEmoji,
            },
          }),
        };
      }

      return {
        size: 0,
        first: () => undefined,
      };
    },
  };

  return {
    author: { bot: false, id: "user-1" },
    content,
    guildId: "guild-1",
    channelId: "channel-1",
    id: "message-1",
    member: { id: "member-1" },
    channel: {
      permissionsFor() {
        return {
          has(permission: string) {
            return options.permissions?.includes(permission) ?? permission === "BanMembers";
          },
        };
      },
    },
    inGuild: () => true,
    reply: async (input: { content?: string; embeds?: unknown[] }) => {
      if (options.shouldThrowWhileConfirming && input.embeds) {
        throw new Error("confirmation send failed");
      }

      if (input.content) {
        replies.push(input.content);
        return { content: input.content };
      }

      if (input.embeds) {
        const snapshots = recordEmbedSnapshots(input.embeds, options.confirmationEmbeds);
        const description = snapshots[0]?.description;

        if (description) {
          options.confirmationDescriptions?.push(description);
        }

        return confirmationMessage;
      }

      return { content: input.content };
    },
  } as never;
}

interface EmbedSnapshot {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text?: string };
}

function recordEmbedSnapshots(
  embeds: unknown[] | undefined,
  destination: EmbedSnapshot[] | undefined,
): EmbedSnapshot[] {
  const snapshots = (embeds ?? []).map((embed) => {
    const maybeEmbed = embed as { toJSON?: () => EmbedSnapshot; data?: EmbedSnapshot };
    return maybeEmbed.toJSON?.() ?? maybeEmbed.data ?? {};
  });

  destination?.push(...snapshots);
  return snapshots;
}

function createLog() {
  return {
    withMetadata() {
      return this;
    },
    withError() {
      return this;
    },
    info() {},
    warn() {},
    error() {},
  } as never;
}

function parseAgentReplies(result: Awaited<ReturnType<typeof handleMessage>>): unknown[] {
  if (!result) {
    return [];
  }

  return result.agentReplies.map((reply) => JSON.parse(reply));
}
