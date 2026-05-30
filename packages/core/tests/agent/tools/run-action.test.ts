import { describe, expect, test } from "vitest";
import { executeRunAction } from "@aripabot/core/agent/tools/run-action.ts";
import type { HandleMessageResult } from "@aripabot/core/bot/message-router.ts";

describe("executeRunAction", () => {
  test("normalizes the command and returns parsed agent replies on success", async () => {
    const result = await executeRunAction({
      command: "ping",
      client: {} as never,
      message: createMessage("-original"),
      prefix: "-",
      actions: {} as never,
      runMessage: async ({ message }) => {
        expect(message.content).toBe("-ping");
        return {
          status: "completed",
          action: "ping",
          isAgent: true,
          agentReplies: ['{"type":"action_reply","action":"ping","ok":true,"message":"pong"}'],
        };
      },
      log: createLog(),
    });

    expect(result).toEqual({
      type: "action_result",
      ok: true,
      command: "ping",
      normalizedCommand: "-ping",
      status: "completed",
      action: "ping",
      replies: [
        {
          type: "action_reply",
          action: "ping",
          ok: true,
          message: "pong",
        },
      ],
    });
  });

  test("maps permission denial into a safe error snapshot", async () => {
    const result = await executeRunAction({
      command: "-ban @user spam",
      client: {} as never,
      message: createMessage("-original"),
      prefix: "-",
      actions: {} as never,
      runMessage: async () => ({
        status: "denied",
        action: "ban",
        isAgent: true,
        agentReplies: [],
        missingUserPermissions: ["BanMembers"],
      }),
      log: createLog(),
    });

    expect(result).toEqual({
      type: "action_result",
      ok: false,
      command: "-ban @user spam",
      normalizedCommand: "-ban @user spam",
      status: "denied",
      action: "ban",
      replies: [],
      error: {
        kind: "permission_denied",
        message: "The invoking user does not have permission to run that action.",
        missingUserPermissions: ["BanMembers"],
      },
    });
  });

  test("maps cancelled confirmations into a tool error result", async () => {
    const result = await executeRunAction({
      command: "-ban @user spam",
      client: {} as never,
      message: createMessage("-original"),
      prefix: "-",
      actions: {} as never,
      runMessage: async () => ({
        status: "unconfirmed",
        action: "ban",
        isAgent: true,
        agentReplies: [],
        confirmationStatus: "cancelled",
      }),
      log: createLog(),
    });

    expect(result).toEqual({
      type: "action_result",
      ok: false,
      command: "-ban @user spam",
      normalizedCommand: "-ban @user spam",
      status: "unconfirmed",
      action: "ban",
      replies: [],
      error: {
        kind: "confirmation_cancelled",
        message: "The user cancelled the confirmation prompt.",
      },
    });
  });

  test("passes confirmation lifecycle hooks to the action router", async () => {
    const lifecycle = {
      onWaitStart() {},
      onWaitEnd() {},
    };

    await executeRunAction({
      command: "-ban @user spam",
      client: {} as never,
      message: createMessage("-original"),
      prefix: "-",
      actions: {} as never,
      agentConfirmationLifecycle: lifecycle,
      runMessage: async (options) => {
        expect(options.agentConfirmationLifecycle).toBe(lifecycle);
        return {
          status: "unconfirmed",
          action: "ban",
          isAgent: true,
          agentReplies: [],
          confirmationStatus: "cancelled",
        };
      },
      log: createLog(),
    });
  });

  test("maps action failures into a safe error snapshot", async () => {
    const result = await executeRunAction({
      command: "-ban @user spam",
      client: {} as never,
      message: createMessage("-original"),
      prefix: "-",
      actions: {} as never,
      runMessage: async () => ({
        status: "failed",
        action: "ban",
        isAgent: true,
        agentReplies: [],
        error: {
          kind: "discord_missing_permissions",
          message: "Discord denied the required permissions.",
          errorName: "DiscordAPIError",
          code: "50013",
        },
      }),
      log: createLog(),
    });

    expect(result).toEqual({
      type: "action_result",
      ok: false,
      command: "-ban @user spam",
      normalizedCommand: "-ban @user spam",
      status: "failed",
      action: "ban",
      replies: [],
      error: {
        kind: "discord_missing_permissions",
        message: "Discord denied the required permissions.",
        actionError: {
          kind: "discord_missing_permissions",
          message: "Discord denied the required permissions.",
          errorName: "DiscordAPIError",
          code: "50013",
        },
      },
    });
  });

  test("waits for the action router before returning to the agent loop", async () => {
    const deferred: { resolve?: (value: HandleMessageResult | void) => void } = {};
    let settled = false;

    const resultPromise = executeRunAction({
      command: "ping",
      client: {} as never,
      message: createMessage("-original"),
      prefix: "-",
      actions: {} as never,
      runMessage: async () =>
        new Promise<HandleMessageResult | void>((resolve) => {
          deferred.resolve = resolve;
        }),
      log: createLog(),
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    if (!deferred.resolve) {
      throw new Error("Router promise was not created.");
    }

    deferred.resolve({
      status: "completed",
      action: "ping",
      isAgent: true,
      agentReplies: [],
    });

    const result = await resultPromise;

    expect(settled).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      action: "ping",
    });
  });
});

function createMessage(content: string) {
  return {
    content,
  } as never;
}

function createLog() {
  return {
    withMetadata() {
      return this;
    },
    withError() {
      return this;
    },
    error() {},
  } as never;
}
