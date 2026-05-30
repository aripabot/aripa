import { describe, expect, test } from "vitest";
import type { ActionContext } from "@aripabot/core/bot/action.ts";
import { setBanMessage } from "@aripabot/bot/actions/admin/banmessage.ts";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";

describe("setBanMessage", () => {
  test("stores the guild ban message from the full argument tail", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["You", "are", "banned."],
        replies,
      });

      await setBanMessage(context, store);

      expect(store.getBanMessage("999999999999999999")).toBe("You are banned.");
      expect(replies).toEqual(["Ban message set to:\nYou are banned."]);
    } finally {
      store.close();
    }
  });

  test("returns usage when no message is provided", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: [],
        replies,
      });

      await setBanMessage(context, store);

      expect(store.getBanMessage("999999999999999999")).toBeNull();
      expect(replies).toEqual(["Usage: `-banmessage <message | none>`"]);
    } finally {
      store.close();
    }
  });

  test("returns usage and the current ban message when no message is provided but one is configured", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setBanMessage("999999999999999999", "You are banned.");

      const context = createContext({
        args: [],
        replies,
      });

      await setBanMessage(context, store);

      expect(replies).toEqual([
        "Usage: `-banmessage <message | none>`\n\nCurrent ban message:\nYou are banned.",
      ]);
    } finally {
      store.close();
    }
  });

  test("clears the ban message when the message is none", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setBanMessage("999999999999999999", "You are banned.");

      const context = createContext({
        args: ["none"],
        replies,
      });

      await setBanMessage(context, store);

      expect(store.getBanMessage("999999999999999999")).toBeNull();
      expect(replies).toEqual(["Ban message cleared."]);
    } finally {
      store.close();
    }
  });

  test("rejects ban messages that are too long for a Discord DM with details", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];
    const longMessage = "a".repeat(1_801);

    try {
      const context = createContext({
        args: [longMessage],
        replies,
      });

      await setBanMessage(context, store);

      expect(store.getBanMessage("999999999999999999")).toBeNull();
      expect(replies).toEqual([
        "Ban message must be at most 1800 characters so it can fit with ban details in one Discord message.",
      ]);
    } finally {
      store.close();
    }
  });
});

interface CreateContextOptions {
  args: string[];
  replies: string[];
}

function createContext({ args, replies }: CreateContextOptions): ActionContext {
  return {
    client: {} as never,
    message: {
      author: { id: "user-id" },
      guildId: "999999999999999999",
      inGuild: () => true,
    },
    args,
    argTokens: [],
    tokens: [],
    rawArgs: args.join(" "),
    prefix: "-",
    actionName: "banmessage",
    actions: {} as never,
    isAgent: false,
    agentReplies: [],
    invoker: {} as never,
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
