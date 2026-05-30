import { tool } from "ai";
import type { Client, Message } from "discord.js";
import type { LogLayer } from "loglayer";
import * as z from "zod";
import {
  handleMessage,
  type AgentConfirmationStatus,
  type ActionErrorSnapshot,
  type HandleMessageResult,
} from "@aripabot/core/bot/message-router.ts";
import type { AgentConfirmationLifecycle } from "@aripabot/core/bot/agent-confirmation.ts";
import type { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";
import type { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { log as defaultLog } from "@aripabot/core/config/logger.ts";

export const runActionInputSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .describe(
      "A formatted bot command, preferably including the configured prefix, such as `-warn @user spam`.",
    ),
});

export interface RunActionToolDependencies {
  client: Client;
  message: Message;
  prefix: string;
  actions: ActionDirectory;
  log?: LogLayer;
  agentConfirmationTimeoutMs?: number;
  agentConfirmationLifecycle?: AgentConfirmationLifecycle;
  guildConfigStore?: GuildConfigStore;
  runMessage?: typeof handleMessage;
}

export interface RunActionErrorSnapshot {
  kind:
    | "parse_error"
    | "unknown_action"
    | "permission_denied"
    | "confirmation_cancelled"
    | "confirmation_timed_out"
    | "confirmation_failed"
    | ActionErrorSnapshot["kind"]
    | "runner_failed";
  message: string;
  missingUserPermissions?: string[];
  actionError?: ActionErrorSnapshot;
}

export interface RunActionResult {
  type: "action_result";
  ok: boolean;
  command: string;
  normalizedCommand: string;
  status: HandleMessageResult["status"] | "runner_failed";
  action?: string;
  replies: Array<Record<string, unknown> | string>;
  error?: RunActionErrorSnapshot;
}

export interface ExecuteRunActionOptions extends RunActionToolDependencies {
  command: string;
}

export function createRunActionTool(dependencies: RunActionToolDependencies) {
  return tool({
    description:
      "Run one of Aripa's existing Discord actions through the shared action router in agent mode. This waits for confirmation, completion, or failure before returning.",
    inputSchema: runActionInputSchema,
    execute: async ({ command }) =>
      executeRunAction({
        ...dependencies,
        command,
      }),
  });
}

export async function executeRunAction({
  command,
  client,
  message,
  prefix,
  actions,
  log = defaultLog,
  agentConfirmationTimeoutMs,
  agentConfirmationLifecycle,
  guildConfigStore,
  runMessage = handleMessage,
}: ExecuteRunActionOptions): Promise<RunActionResult> {
  const parsed = runActionInputSchema.parse({ command });
  const normalizedCommand = normalizeActionCommand(parsed.command, prefix);
  const actionMessage = createActionMessage(message, normalizedCommand);

  try {
    const result = await runMessage({
      client,
      message: actionMessage,
      prefix,
      actions,
      log,
      isAgent: true,
      ...(agentConfirmationTimeoutMs !== undefined ? { agentConfirmationTimeoutMs } : {}),
      ...(agentConfirmationLifecycle ? { agentConfirmationLifecycle } : {}),
      ...(guildConfigStore ? { guildConfigStore } : {}),
    });

    if (!result) {
      return {
        type: "action_result",
        ok: false,
        command: parsed.command,
        normalizedCommand,
        status: "runner_failed",
        replies: [],
        error: {
          kind: "runner_failed",
          message: "The action runner returned no result.",
        },
      };
    }

    return mapRunActionResult(parsed.command, normalizedCommand, result);
  } catch (error) {
    log
      .withError(error)
      .withMetadata({ command: parsed.command, normalizedCommand })
      .error("run_action failed.");

    return {
      type: "action_result",
      ok: false,
      command: parsed.command,
      normalizedCommand,
      status: "runner_failed",
      replies: [],
      error: {
        kind: "runner_failed",
        message: "The action runner threw before it could return a result.",
      },
    };
  }
}

function normalizeActionCommand(command: string, prefix: string): string {
  return command.startsWith(prefix) ? command : `${prefix}${command}`;
}

function createActionMessage(message: Message, content: string): Message {
  const proxy = Object.create(message) as Message;

  Object.defineProperty(proxy, "content", {
    value: content,
    configurable: true,
    enumerable: true,
    writable: false,
  });

  return proxy;
}

function mapRunActionResult(
  command: string,
  normalizedCommand: string,
  result: HandleMessageResult,
): RunActionResult {
  const baseResult = {
    type: "action_result" as const,
    command,
    normalizedCommand,
    status: result.status,
    replies: result.agentReplies.map(parseAgentReply),
  };

  switch (result.status) {
    case "completed":
      return {
        ...baseResult,
        ok: true,
        action: result.action,
      };
    case "parse_error":
      return {
        ...baseResult,
        ok: false,
        error: {
          kind: "parse_error",
          message: result.error,
        },
      };
    case "unknown_action":
      return {
        ...baseResult,
        ok: false,
        action: result.action,
        error: {
          kind: "unknown_action",
          message: `Unknown action: ${result.action}.`,
        },
      };
    case "denied":
      return {
        ...baseResult,
        ok: false,
        action: result.action,
        error: {
          kind: "permission_denied",
          message: "The invoking user does not have permission to run that action.",
          missingUserPermissions: result.missingUserPermissions,
        },
      };
    case "unconfirmed":
      return {
        ...baseResult,
        ok: false,
        action: result.action,
        error: {
          kind: getConfirmationErrorKind(result.confirmationStatus),
          message: getConfirmationErrorMessage(result.confirmationStatus),
        },
      };
    case "failed":
      return {
        ...baseResult,
        ok: false,
        action: result.action,
        error: {
          kind: result.error.kind,
          message: result.error.message,
          actionError: result.error,
        },
      };
  }
}

function parseAgentReply(reply: string): Record<string, unknown> | string {
  try {
    return JSON.parse(reply) as Record<string, unknown>;
  } catch {
    return reply;
  }
}

function getConfirmationErrorKind(
  status: Exclude<AgentConfirmationStatus, "confirmed">,
): RunActionErrorSnapshot["kind"] {
  switch (status) {
    case "cancelled":
      return "confirmation_cancelled";
    case "timed_out":
      return "confirmation_timed_out";
    case "failed":
      return "confirmation_failed";
  }
}

function getConfirmationErrorMessage(
  status: Exclude<AgentConfirmationStatus, "confirmed">,
): string {
  switch (status) {
    case "cancelled":
      return "The user cancelled the confirmation prompt.";
    case "timed_out":
      return "The confirmation prompt timed out before the user confirmed the action.";
    case "failed":
      return "The confirmation prompt could not be completed.";
  }
}
