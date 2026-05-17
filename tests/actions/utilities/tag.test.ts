import { describe, expect, test } from "vitest";
import type { PermissionResolvable } from "discord.js";
import type { ActionContext } from "@/bot/action.ts";
import { handleTagAction } from "@/actions/utilities/tag.ts";
import { GuildConfigStore } from "@/config/guild-config-store.ts";

const guildId = "999999999999999999";

describe("handleTagAction", () => {
  test("adds, views, edits, and removes tags", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      await handleTagAction(
        createContext({
          args: ["add", "politics", "No", "politics", "here."],
          replies,
          canManageMessages: true,
        }),
        store,
      );

      await handleTagAction(
        createContext({
          args: ["politics"],
          replies,
        }),
        store,
      );

      await handleTagAction(
        createContext({
          args: ["edit", "politics", "Still", "no", "politics."],
          replies,
          canManageMessages: true,
        }),
        store,
      );

      await handleTagAction(
        createContext({
          args: ["remove", "politics"],
          replies,
          canManageMessages: true,
        }),
        store,
      );

      expect(replies).toEqual([
        "Added tag `politics`.",
        "No politics here.",
        "Edited tag `politics`.",
        "Removed tag `politics`.",
      ]);
    } finally {
      store.close();
    }
  });

  test("denies tag edits without ManageMessages", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      await handleTagAction(
        createContext({
          args: ["add", "politics", "No", "politics", "here."],
          replies,
          canManageMessages: false,
        }),
        store,
      );

      expect(replies).toEqual([
        "You do not have permission to manage tags. Missing: `ManageMessages`.",
      ]);
    } finally {
      store.close();
    }
  });

  test("lists tags", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.upsertTag(guildId, "rules", "Read the rules.");
      store.upsertTag(guildId, "politics", "No politics.");

      await handleTagAction(
        createContext({
          args: ["list"],
          replies,
        }),
        store,
      );

      expect(replies).toEqual(["Tags: `politics`, `rules`"]);
    } finally {
      store.close();
    }
  });
});

interface CreateContextOptions {
  args: string[];
  replies: string[];
  canManageMessages?: boolean;
}

function createContext({
  args,
  replies,
  canManageMessages = false,
}: CreateContextOptions): ActionContext {
  return {
    client: {} as never,
    message: {
      author: { id: "user-id" },
      guildId,
      inGuild: () => true,
    },
    args,
    argTokens: [],
    tokens: [],
    rawArgs: args.join(" "),
    prefix: "-",
    actionName: "tag",
    actions: {} as never,
    isAgent: false,
    agentReplies: [],
    invoker: {
      user: {} as never,
      member: null,
      permissions: null,
      can: (permission: PermissionResolvable) =>
        permission === "ManageMessages" && canManageMessages,
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
