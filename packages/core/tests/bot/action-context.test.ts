import { describe, expect, test } from "vitest";
import type { Client, Message } from "discord.js";
import type { LogLayer } from "loglayer";
import { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";
import {
  createActionContext,
  formatAgentReply,
  safeReply,
  safeReplyWithOptions,
} from "@aripabot/core/bot/action-context.ts";

describe("safeReply", () => {
  test("disables all mentions in bot replies", async () => {
    const reply = async (options: unknown) => options;
    const message = {
      reply,
      guildId: "guild",
      channelId: "channel",
      id: "message",
    } as never;
    const log = {
      withError() {
        return this;
      },
      withMetadata() {
        return this;
      },
      warn() {},
    } as never;

    const result = await safeReply(message, "@everyone <@123> <@&456>", log);

    expect(result as unknown).toEqual({
      content: "@everyone <@123> <@&456>",
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: false,
      },
    });
  });

  test("preserves embed options while disabling mentions", async () => {
    const reply = async (options: unknown) => options;
    const message = {
      reply,
      guildId: "guild",
      channelId: "channel",
      id: "message",
    } as never;
    const log = {
      withError() {
        return this;
      },
      withMetadata() {
        return this;
      },
      warn() {},
    } as never;

    const result = await safeReplyWithOptions(
      message,
      {
        embeds: [{ title: "Test Embed" }] as never,
      },
      log,
    );

    expect(result as unknown).toEqual({
      embeds: [{ title: "Test Embed" }],
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: false,
      },
    });
  });
});

describe("formatAgentReply", () => {
  test("returns parseable agent action output", () => {
    const reply = formatAgentReply("testban", "Test ban action accepted.");

    expect(JSON.parse(reply)).toEqual({
      type: "action_reply",
      action: "testban",
      ok: true,
      message: "Test ban action accepted.",
    });
  });
});

describe("createActionContext", () => {
  test("does not send Discord replies in agent mode", async () => {
    const context = createActionContext({
      client: {} as Client,
      message: {
        author: { id: "user-id" },
        member: null,
        inGuild: () => false,
      } as Message,
      args: [],
      rawArgs: "",
      prefix: "-",
      actionName: "testban",
      actions: new ActionDirectory(),
      log: {} as LogLayer,
      isAgent: true,
    });

    const reply = await context.reply("Test ban action accepted.");

    expect(typeof reply).toBe("string");
    if (typeof reply !== "string") {
      throw new Error("Expected an agent reply string.");
    }

    expect(context.agentReplies).toEqual([reply]);
  });
});
