import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { Client, Message, PermissionResolvable } from "discord.js";
import type { LogLayer } from "loglayer";
import {
  DEFAULT_AGENT_CONFIRMATION_TIMEOUT_MS,
  requestAgentConfirmation,
  type AgentConfirmationLifecycle,
  type AgentConfirmationStatus,
} from "@aripabot/core/bot/agent-confirmation.ts";
import {
  createActionContext,
  formatAgentReply,
  safeReply,
} from "@aripabot/core/bot/action-context.ts";
import type { Action } from "@aripabot/core/bot/action.ts";
import type { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";
import {
  getGuildConfigStore,
  type GuildConfigStore,
} from "@aripabot/core/config/guild-config-store.ts";
import { parsePrefixedCommand } from "@aripabot/core/commands/command-tokenizer.ts";

export type { AgentConfirmationStatus } from "@aripabot/core/bot/agent-confirmation.ts";

export interface HandleMessageOptions {
  client: Client;
  message: Message;
  prefix: string;
  actions: ActionDirectory;
  log: LogLayer;
  isAgent?: boolean;
  agentConfirmationTimeoutMs?: number;
  agentConfirmationLifecycle?: AgentConfirmationLifecycle;
  guildConfigStore?: GuildConfigStore;
  requestAgentConfirmation?: typeof requestAgentConfirmation;
}

export type HandleMessageResult =
  | { status: "parse_error"; isAgent: boolean; agentReplies: string[]; error: string }
  | { status: "unknown_action"; action: string; isAgent: boolean; agentReplies: string[] }
  | {
      status: "denied";
      action: string;
      isAgent: boolean;
      agentReplies: string[];
      missingUserPermissions: string[];
    }
  | {
      status: "unconfirmed";
      action: string;
      isAgent: boolean;
      agentReplies: string[];
      confirmationStatus: Exclude<AgentConfirmationStatus, "confirmed">;
    }
  | { status: "completed"; action: string; isAgent: boolean; agentReplies: string[] }
  | {
      status: "failed";
      action: string;
      isAgent: boolean;
      agentReplies: string[];
      error: ActionErrorSnapshot;
    };

export interface ActionErrorSnapshot {
  kind: "discord_missing_permissions" | "action_failed";
  message: string;
  errorName?: string;
  code?: string;
}

export async function handleMessage({
  client,
  message,
  prefix,
  actions,
  log,
  isAgent = false,
  agentConfirmationTimeoutMs = DEFAULT_AGENT_CONFIRMATION_TIMEOUT_MS,
  agentConfirmationLifecycle,
  guildConfigStore = getGuildConfigStore(),
  requestAgentConfirmation: confirmAgentAction = requestAgentConfirmation,
}: HandleMessageOptions): Promise<HandleMessageResult | void> {
  if (message.author.bot || !message.content.startsWith(prefix)) {
    return;
  }

  const parsedResult = parsePrefixedCommand(message.content, prefix);

  if (!parsedResult) {
    return;
  }

  if (!parsedResult.ok) {
    const replyMessage = `Could not parse that action: ${parsedResult.error.message}`;
    const agentReplies = isAgent ? [formatAgentReply("parse", replyMessage, false)] : [];

    if (!isAgent) {
      await safeReply(message, replyMessage, log);
    }

    return {
      status: "parse_error",
      isAgent,
      agentReplies,
      error: parsedResult.error.message,
    };
  }

  const parsed = parsedResult.command;
  const action = actions.find(parsed.name);

  if (!action) {
    const tagResult = await handleTagInvocation({
      message,
      parsedName: parsed.name,
      parsedArgs: parsed.args,
      log,
      isAgent,
      store: guildConfigStore,
    });

    if (tagResult) {
      return tagResult;
    }

    const replyMessage = `Unknown action: \`${parsed.name}\`. Try \`${prefix}help\`.`;
    const agentReplies = isAgent ? [formatAgentReply(parsed.name, replyMessage, false)] : [];

    if (!isAgent) {
      await safeReply(message, replyMessage, log);
    }

    return {
      status: "unknown_action",
      action: parsed.name,
      isAgent,
      agentReplies,
    };
  }

  const actionMetadata = {
    action: action.name,
    requestedAction: parsed.name,
    requestedActionCall: renderActionCall(prefix, parsed.name, parsed.rawArgs),
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
  };

  log.withMetadata(actionMetadata).info("Action requested.");

  const startedAt = performance.now();
  const context = createActionContext({
    client,
    message,
    args: parsed.args,
    argTokens: parsed.tokens.slice(1),
    tokens: parsed.tokens,
    rawArgs: parsed.rawArgs,
    prefix,
    actionName: parsed.name,
    actions,
    log,
    isAgent,
  });
  const requiredUserPermissions = await getEffectiveRequiredUserPermissions(action, context);
  const missingUserPermissions = getMissingUserPermissions(
    requiredUserPermissions,
    context.invoker.can,
  );

  if (missingUserPermissions.length > 0) {
    log
      .withMetadata({
        ...actionMetadata,
        missingUserPermissions: missingUserPermissions.map(String),
      })
      .warn("Action denied by user permission guard.");

    await deliverRouterReply({
      message,
      log,
      isAgent,
      agentReplies: context.agentReplies,
      actionName: action.name,
      content: `You do not have permission to run that action. Missing: ${formatPermissions(missingUserPermissions)}.`,
    });
    return {
      status: "denied",
      action: action.name,
      isAgent,
      agentReplies: context.agentReplies,
      missingUserPermissions: missingUserPermissions.map(String),
    };
  }

  if (shouldConfirmAgentAction(isAgent, requiredUserPermissions)) {
    const confirmation = await confirmAgentAction({
      message,
      actionCall: actionMetadata.requestedActionCall,
      timeoutMs: agentConfirmationTimeoutMs,
      log,
      actionMetadata,
      lifecycle: agentConfirmationLifecycle,
    });

    if (confirmation.status !== "confirmed") {
      log
        .withMetadata({ ...actionMetadata, confirmationStatus: confirmation.status })
        .info("Agent action was not confirmed.");
      await deliverRouterReply({
        message,
        log,
        isAgent,
        agentReplies: context.agentReplies,
        actionName: action.name,
        content: getAgentConfirmationFailureReply(confirmation.status),
      });
      return {
        status: "unconfirmed",
        action: action.name,
        isAgent,
        agentReplies: context.agentReplies,
        confirmationStatus: confirmation.status,
      };
    }
  }

  log.withMetadata(actionMetadata).info("Running action.");

  try {
    const result = await action.execute(context);

    if (isAgent && typeof result === "string" && !context.agentReplies.includes(result)) {
      context.agentReplies.push(result);
    }

    log
      .withMetadata({ ...actionMetadata, durationMs: Math.round(performance.now() - startedAt) })
      .info("Action completed.");

    return {
      status: "completed",
      action: action.name,
      isAgent,
      agentReplies: context.agentReplies,
    };
  } catch (error) {
    const errorSnapshot = await handleActionError(
      message,
      error,
      log,
      actionMetadata,
      isAgent,
      context.agentReplies,
      action.name,
    );
    return {
      status: "failed",
      action: action.name,
      isAgent,
      agentReplies: context.agentReplies,
      error: errorSnapshot,
    };
  }
}

interface HandleTagInvocationOptions {
  message: Message;
  parsedName: string;
  parsedArgs: readonly string[];
  log: LogLayer;
  isAgent: boolean;
  store: GuildConfigStore;
}

async function handleTagInvocation({
  message,
  parsedName,
  parsedArgs,
  log,
  isAgent,
  store,
}: HandleTagInvocationOptions): Promise<HandleMessageResult | null> {
  if (!message.inGuild() || !message.guildId || parsedArgs.length > 0) {
    return null;
  }

  const tag = store.getTag(message.guildId, parsedName);

  if (!tag) {
    return null;
  }

  if (isAgent) {
    return {
      status: "completed",
      action: parsedName,
      isAgent,
      agentReplies: [formatAgentReply(parsedName, tag.content)],
    };
  }

  await safeReply(message, tag.content, log);
  return {
    status: "completed",
    action: parsedName,
    isAgent,
    agentReplies: [],
  };
}

export function getMissingUserPermissions(
  requiredPermissions: readonly PermissionResolvable[],
  can: (permission: PermissionResolvable) => boolean,
): PermissionResolvable[] {
  return requiredPermissions.filter((permission) => !can(permission));
}

async function getEffectiveRequiredUserPermissions(
  action: Action,
  context: ReturnType<typeof createActionContext>,
): Promise<PermissionResolvable[]> {
  const resolvedPermissions = action.resolveRequiredUserPermissions
    ? await action.resolveRequiredUserPermissions(context)
    : [];

  return dedupePermissions(action.requiredUserPermissions, resolvedPermissions);
}

export function shouldConfirmAgentAction(
  isAgent: boolean,
  requiredPermissions: readonly PermissionResolvable[],
): boolean {
  return isAgent && requiredPermissions.length > 0;
}

function getAgentConfirmationFailureReply(
  status: Exclude<AgentConfirmationStatus, "confirmed">,
): string {
  switch (status) {
    case "timed_out":
      return "Confirmation timed out, so I did not run that action.";
    case "cancelled":
      return "Confirmation was cancelled, so I did not run that action.";
    case "failed":
      return "I could not confirm that action, so I did not run it.";
  }
}

function renderActionCall(prefix: string, name: string, rawArgs: string): string {
  return `${prefix}${name}${rawArgs ? ` ${rawArgs}` : ""}`;
}

async function handleActionError(
  message: Message,
  error: unknown,
  log: LogLayer,
  actionMetadata: Record<string, unknown>,
  isAgent: boolean,
  agentReplies: string[],
  actionName: string,
): Promise<ActionErrorSnapshot> {
  log.withError(error).withMetadata(actionMetadata).error("Action failed.");

  if (isMissingPermissionsError(error)) {
    await deliverRouterReply({
      message,
      log,
      isAgent,
      agentReplies,
      actionName,
      content: "I could not complete that action because Discord denied the required permissions.",
    });
    return {
      kind: "discord_missing_permissions",
      message: "Discord denied the required permissions.",
      errorName: getErrorName(error),
      code: getErrorCode(error),
    };
  }

  await deliverRouterReply({
    message,
    log,
    isAgent,
    agentReplies,
    actionName,
    content: "That action failed. I logged the details so it can be fixed.",
  });
  return {
    kind: "action_failed",
    message: "The action threw before it could complete.",
    errorName: getErrorName(error),
    code: getErrorCode(error),
  };
}

function isMissingPermissionsError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeDiscordError = error as { code?: unknown; message?: unknown };

  return (
    maybeDiscordError.code === RESTJSONErrorCodes.MissingPermissions ||
    maybeDiscordError.message === "Missing Permissions"
  );
}

function formatPermissions(permissions: readonly PermissionResolvable[]): string {
  return permissions.map((permission) => `\`${String(permission)}\``).join(", ");
}

function dedupePermissions(
  ...permissionSets: ReadonlyArray<readonly PermissionResolvable[]>
): PermissionResolvable[] {
  const deduped = new Map<string, PermissionResolvable>();

  for (const permissionSet of permissionSets) {
    for (const permission of permissionSet) {
      deduped.set(String(permission), permission);
    }
  }

  return [...deduped.values()];
}

async function deliverRouterReply(options: {
  message: Message;
  log: LogLayer;
  isAgent: boolean;
  agentReplies: string[];
  actionName: string;
  content: string;
}): Promise<void> {
  if (options.isAgent) {
    options.agentReplies.push(formatAgentReply(options.actionName, options.content, false));
    return;
  }

  await safeReply(options.message, options.content, options.log);
}

function getErrorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}
