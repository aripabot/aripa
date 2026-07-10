import { readFile } from "node:fs/promises";
import { openai, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText, stepCountIs } from "ai";
import type { Client, Message } from "discord.js";
import type { LogLayer } from "loglayer";
import { safeReply } from "@aripabot/core/bot/action-context.ts";
import type { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";
import { handleMessage } from "@aripabot/core/bot/message-router.ts";
import { DEFAULT_MODEL_CONFIG } from "@aripabot/core/config/config.ts";
import type { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { log as defaultLog } from "@aripabot/core/config/logger.ts";
import {
  createRequestContextTool,
  createRunActionTool,
  createWebSearchTool,
  type RunActionToolDependencies,
} from "@aripabot/core/agent/tools/index.ts";
import {
  fetchPreviousMessages,
  fetchMessagesAfter,
  formatContextMessage,
  summarizeConversationMemoryWithModel,
  summarizeConversationMemoryWithNano,
  summarizeRequestContextWithModel,
  type ContextMessageLike,
} from "@aripabot/core/agent/tools/request-context.ts";
import {
  ConversationMemoryStore,
  createRawMemoryTurn,
  type RawMemoryTurn,
} from "@aripabot/core/agent/conversation-memory.ts";
import type { AgentTraceRecorder, AgentTraceUsage } from "@aripabot/core/agent/traces.ts";
import type { ResolvedTextModel } from "@aripabot/core/agent/models.ts";
import { errorMessage, errorSnapshot } from "@aripabot/core/shared/errors.ts";
import { escapeRegExp } from "@aripabot/core/shared/text.ts";
import { unrefTimer } from "@aripabot/core/shared/timers.ts";
import packageJson from "../../package.json" with { type: "json" };

const DEFAULT_BOT_NAME = "Aripa";
const DEFAULT_STYLE_PROMPT_NAME = "match";
const DEFAULT_MAX_AGENT_STEPS = 8;
const DEFAULT_AGENT_CONTEXT_MESSAGE_COUNT = 3;
const DEFAULT_AGENT_COLD_START_MESSAGE_COUNT = 5;
const DEFAULT_AGENT_GAP_FILL_LIMIT = 10;
const DEFAULT_AGENT_TIMEOUT_MS = 60_000;
const DEFAULT_MEMORY_COMPACTION_TIMEOUT_MS = 30_000;
const DEFAULT_TYPING_REFRESH_INTERVAL_MS = 8_000;
const EMPTY_AGENT_PROMPT = "The user mentioned you without additional text. Respond naturally.";
const EMPTY_AGENT_REPLY = "I'm here, but I couldn't produce a useful reply for that.";
const AGENT_ERROR_REPLY = "Sorry, I ran into an error while thinking through that.";

const defaultPromptUrl = new URL("./prompts/default.md", import.meta.url);
const stylePromptDirectoryUrl = new URL("./prompts/styles/", import.meta.url);
const metadataPromptUrl = new URL("./prompts/metadata.md", import.meta.url);
const webPromptUrl = new URL("./prompts/web.md", import.meta.url);
const noWebPromptUrl = new URL("./prompts/no_web.md", import.meta.url);

const cachedPromptPartsPromises = new Map<string, Promise<AgentPromptParts>>();

export interface AgentPromptParts {
  defaultPrompt: string;
  webPrompt: string;
  stylePrompt: string;
  metadataPrompt: string;
}

export interface AgentMetadata {
  botName: string;
  botVersion: string;
  currentDateTime: string;
}

export interface AgentPromptTemplateContext {
  prefix: string;
}

export interface HandleAgentMentionOptions {
  client: Client;
  message: Message;
  prefix: string;
  actions: ActionDirectory;
  log?: LogLayer;
  now?: Date;
  botName?: string;
  stylePromptName?: string;
  logPrivacy?: boolean;
  maxSteps?: number;
  agentTimeoutMs?: number;
  defaultContextMessageCount?: number;
  coldStartMessageCount?: number;
  gapFillLimit?: number;
  agentConfirmationTimeoutMs?: number;
  typingRefreshIntervalMs?: number;
  guildConfigStore?: GuildConfigStore;
  conversationMemory?: ConversationMemoryStore;
  traceRecorder?: AgentTraceRecorder;
  loadPromptParts?: () => Promise<AgentPromptParts>;
  generateAgentText?: AgentTextGenerator;
  agentModel?: ResolvedTextModel;
  summarizerModel?: ResolvedTextModel;
  webSearchEnabled?: boolean;
  webModel?: LanguageModelV3;
}

export type AgentTextGenerator = (
  options: Parameters<typeof generateText>[0],
) => Promise<Pick<Awaited<ReturnType<typeof generateText>>, "text">>;

export type HandleAgentMentionResult =
  | { status: "ignored" }
  | { status: "completed"; prompt: string; reply: string }
  | { status: "failed"; prompt: string; error: unknown };

export async function handleAgentMention({
  client,
  message,
  prefix,
  actions,
  log = defaultLog,
  now = new Date(),
  botName = DEFAULT_BOT_NAME,
  stylePromptName = DEFAULT_STYLE_PROMPT_NAME,
  logPrivacy = true,
  maxSteps = DEFAULT_MAX_AGENT_STEPS,
  agentTimeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
  defaultContextMessageCount = DEFAULT_AGENT_CONTEXT_MESSAGE_COUNT,
  coldStartMessageCount = DEFAULT_AGENT_COLD_START_MESSAGE_COUNT,
  gapFillLimit = DEFAULT_AGENT_GAP_FILL_LIMIT,
  agentConfirmationTimeoutMs,
  typingRefreshIntervalMs = DEFAULT_TYPING_REFRESH_INTERVAL_MS,
  guildConfigStore,
  conversationMemory,
  traceRecorder,
  webSearchEnabled = true,
  loadPromptParts = () => loadAgentPromptParts(stylePromptName, webSearchEnabled),
  generateAgentText = runAgentTextGeneration,
  agentModel = {
    model: openai(DEFAULT_MODEL_CONFIG.agent.model),
    providerOptions: {
      openai: {
        parallelToolCalls: false,
        store: false,
        reasoningEffort: DEFAULT_MODEL_CONFIG.agent.reasoningEffort,
      } satisfies OpenAILanguageModelResponsesOptions,
    },
  },
  summarizerModel,
  webModel,
}: HandleAgentMentionOptions): Promise<HandleAgentMentionResult> {
  if (!shouldHandleAgentMention(message, client)) {
    return { status: "ignored" };
  }
  const guildId = message.guildId;
  if (!guildId) {
    return { status: "ignored" };
  }

  let prompt = formatSingleMessagePrompt(
    message,
    extractMentionPrompt(message.content, client.user?.id),
  );
  const typingIndicator = startTypingIndicator({
    message,
    log,
    intervalMs: typingRefreshIntervalMs,
  });
  let traceId: string | null = null;

  try {
    prompt = await buildDefaultAgentPrompt({
      message,
      assistantUserId: client.user?.id,
      contextMessageCount: conversationMemory ? coldStartMessageCount : defaultContextMessageCount,
      conversationMemory,
      gapFillLimit,
      fallbackPrompt: prompt,
      log,
    });
    const promptParts = await loadPromptParts();
    const system = buildAgentSystemPrompt(promptParts, createAgentMetadata(now, botName), {
      prefix,
    });
    traceId = startAgentTrace(
      traceRecorder,
      {
        guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: message.author.id,
        private: logPrivacy,
        system,
        prompt,
      },
      log,
    );
    const modelSpanIds = new Map<number, string>();
    let confirmationSpanId: string | null = null;
    const tools = createAgentTools({
      client,
      message,
      prefix,
      actions,
      log,
      agentConfirmationTimeoutMs,
      guildConfigStore,
      summarizerModel,
      webSearchEnabled,
      webModel,
      logPrivacy,
      agentConfirmationLifecycle: {
        onWaitStart: () => {
          typingIndicator.pause();
          if (!traceId) return;
          confirmationSpanId = startAgentTraceSpan(
            traceRecorder,
            {
              traceId,
              kind: "tool",
              name: "User confirmation",
              parentSpanId: [...modelSpanIds.values()].at(-1),
            },
            log,
          );
        },
        onWaitEnd: () => {
          typingIndicator.resume({ immediate: true });
          if (!traceId || !confirmationSpanId) return;
          finishAgentTraceSpan(
            traceRecorder,
            { traceId, spanId: confirmationSpanId, status: "completed" },
            log,
          );
          confirmationSpanId = null;
        },
      },
    });

    log
      .withMetadata({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: message.author.id,
      })
      .info("Agent mention received.");

    const timeout = createAgentTimeout(agentTimeoutMs);
    let result: Awaited<ReturnType<AgentTextGenerator>>;

    try {
      result = await generateAgentText({
        model: agentModel.model,
        system,
        prompt,
        tools,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: timeout.signal,
        experimental_onStepStart: (event) => {
          if (!traceId) return;
          const spanId = startAgentTraceSpan(
            traceRecorder,
            {
              traceId,
              kind: "model",
              name: event.model.modelId,
              stepNumber: event.stepNumber,
              detail: logPrivacy
                ? null
                : {
                    provider: event.model.provider,
                    system: event.system,
                    messages: event.messages,
                  },
            },
            log,
          );
          if (spanId) modelSpanIds.set(event.stepNumber, spanId);
        },
        onStepFinish: (event) => {
          if (!traceId) return;
          const spanId = modelSpanIds.get(event.stepNumber);
          if (!spanId) return;
          finishAgentTraceSpan(
            traceRecorder,
            {
              traceId,
              spanId,
              status: "completed",
              detail: {
                provider: event.model.provider,
                modelId: event.model.modelId,
                finishReason: event.finishReason,
                ...(logPrivacy ? {} : { text: event.text }),
              },
              usage: createAgentTraceUsage(event.usage),
            },
            log,
          );
        },
        experimental_onToolCallStart: (event) => {
          if (traceId) {
            startAgentTraceSpan(
              traceRecorder,
              {
                traceId,
                spanId: event.toolCall.toolCallId,
                kind: "tool",
                name: event.toolCall.toolName,
                stepNumber: event.stepNumber,
                parentSpanId:
                  event.stepNumber === undefined ? undefined : modelSpanIds.get(event.stepNumber),
                detail: logPrivacy ? null : { input: event.toolCall.input },
              },
              log,
            );
          }
          log
            .withMetadata({
              ...createAgentMessageLogMetadata(message),
              ...createToolCallLogMetadata(event, { logPrivacy }),
            })
            .info("Agent tool call started.");
        },
        experimental_onToolCallFinish: (event) => {
          const metadata = {
            ...createAgentMessageLogMetadata(message),
            ...createToolCallLogMetadata(event, { logPrivacy }),
            durationMs: event.durationMs,
            success: event.success,
            ...(event.success ? createToolOutputLogMetadata(event.output, { logPrivacy }) : {}),
          };

          if (event.success) {
            if (traceId) {
              finishAgentTraceSpan(
                traceRecorder,
                {
                  traceId,
                  spanId: event.toolCall.toolCallId,
                  status: "completed",
                  detail: logPrivacy ? null : { output: event.output },
                },
                log,
              );
            }
            log.withMetadata(metadata).info("Agent tool call completed.");
            return;
          }

          if (traceId) {
            finishAgentTraceSpan(
              traceRecorder,
              {
                traceId,
                spanId: event.toolCall.toolCallId,
                status: "failed",
                error: errorMessage(event.error),
              },
              log,
            );
          }

          log
            .withError(event.error)
            .withMetadata({
              ...metadata,
              error: errorSnapshot(event.error),
            })
            .error("Agent tool call failed.");
        },
        ...(agentModel.providerOptions ? { providerOptions: agentModel.providerOptions } : {}),
      });
    } finally {
      timeout.clear();
    }

    const reply = normalizeAgentReply(result.text);
    const replySpanId = traceId
      ? startAgentTraceSpan(traceRecorder, { traceId, kind: "reply", name: "Discord reply" }, log)
      : null;
    const replyMessage = await safeReply(message, reply, log);
    if (traceId && replySpanId) {
      finishAgentTraceSpan(
        traceRecorder,
        { traceId, spanId: replySpanId, status: "completed" },
        log,
      );
    }
    recordAgentTurn({
      message,
      assistantUserId: client.user?.id,
      reply,
      replyMessage,
      conversationMemory,
      log,
      summarizerModel,
      logPrivacy,
    });
    if (traceId) {
      finishAgentTrace(
        traceRecorder,
        {
          traceId,
          status: "completed",
          ...(logPrivacy ? {} : { reply }),
        },
        log,
      );
    }

    return {
      status: "completed",
      prompt,
      reply,
    };
  } catch (error) {
    if (traceId) {
      finishAgentTrace(
        traceRecorder,
        { traceId, status: "failed", error: errorMessage(error) },
        log,
      );
    }
    log
      .withError(error)
      .withMetadata({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: message.author.id,
      })
      .error("Agent mention failed.");

    await safeReply(message, AGENT_ERROR_REPLY, log);
    recordAgentTurn({
      message,
      assistantUserId: client.user?.id,
      conversationMemory,
      log,
      summarizerModel,
      logPrivacy,
    });

    return {
      status: "failed",
      prompt,
      error,
    };
  } finally {
    typingIndicator.stop();
  }
}

function startAgentTrace(
  recorder: AgentTraceRecorder | undefined,
  input: Parameters<AgentTraceRecorder["startTrace"]>[0],
  log: LogLayer,
): string | null {
  if (!recorder) return null;
  try {
    return recorder.startTrace(input);
  } catch (error) {
    log.withError(error).warn("Failed to start agent trace.");
    return null;
  }
}

function startAgentTraceSpan(
  recorder: AgentTraceRecorder | undefined,
  input: Parameters<AgentTraceRecorder["startSpan"]>[0],
  log: LogLayer,
): string | null {
  if (!recorder) return null;
  try {
    return recorder.startSpan(input);
  } catch (error) {
    log.withError(error).warn("Failed to record agent trace span.");
    return null;
  }
}

function finishAgentTraceSpan(
  recorder: AgentTraceRecorder | undefined,
  input: Parameters<AgentTraceRecorder["finishSpan"]>[0],
  log: LogLayer,
): void {
  if (!recorder) return;
  try {
    recorder.finishSpan(input);
  } catch (error) {
    log.withError(error).warn("Failed to finish agent trace span.");
  }
}

function finishAgentTrace(
  recorder: AgentTraceRecorder | undefined,
  input: Parameters<AgentTraceRecorder["finishTrace"]>[0],
  log: LogLayer,
): void {
  if (!recorder) return;
  try {
    recorder.finishTrace(input);
  } catch (error) {
    log.withError(error).warn("Failed to finish agent trace.");
  }
}

function createAgentTraceUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  inputTokenDetails: { cacheReadTokens: number | undefined };
  outputTokenDetails: { reasoningTokens: number | undefined };
}): AgentTraceUsage {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
  };
}

function createAgentTimeout(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const delayMs =
    Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_AGENT_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Agent request timed out after ${delayMs}ms.`));
  }, delayMs);

  unrefTimer(timeout);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function shouldHandleAgentMention(message: Message, client: Client): boolean {
  if (message.author.bot || !message.inGuild()) {
    return false;
  }

  const botId = client.user?.id;

  if (!botId) {
    return false;
  }

  return message.mentions.users.has(botId);
}

export function extractMentionPrompt(content: string, botId: string | undefined): string {
  if (!botId) {
    return content.trim() || EMPTY_AGENT_PROMPT;
  }

  const mentionPattern = new RegExp(`<@!?${escapeRegExp(botId)}>`, "g");
  const prompt = content.replace(mentionPattern, " ").replace(/\s+/g, " ").trim();

  return prompt.length > 0 ? prompt : EMPTY_AGENT_PROMPT;
}

export function createAgentMetadata(now: Date, botName = DEFAULT_BOT_NAME): AgentMetadata {
  return {
    botName,
    botVersion: packageJson.version,
    currentDateTime: now.toISOString(),
  };
}

export function formatSingleMessagePrompt(message: Message, content: string): string {
  return `${formatUserIdentity(message.author)}: ${content}`;
}

export async function buildDefaultAgentPrompt({
  message,
  assistantUserId = message.client.user?.id,
  contextMessageCount = DEFAULT_AGENT_CONTEXT_MESSAGE_COUNT,
  conversationMemory,
  gapFillLimit = DEFAULT_AGENT_GAP_FILL_LIMIT,
  fallbackPrompt,
  log = defaultLog,
}: {
  message: Message;
  assistantUserId?: string;
  contextMessageCount?: number;
  conversationMemory?: ConversationMemoryStore;
  gapFillLimit?: number;
  fallbackPrompt?: string;
  log?: LogLayer;
}): Promise<string> {
  const currentMessage = createCurrentContextMessage(message, assistantUserId);
  const currentPrompt = formatContextMessage(currentMessage, {
    invokerId: message.author.id,
    assistantUserId,
  });

  if (conversationMemory) {
    const memoryContext = conversationMemory.getContext(message.channelId, {
      invokerId: message.author.id,
      assistantUserId,
    });

    if (memoryContext) {
      const seenMessageIds = new Set([...memoryContext.messageIds, currentMessage.id]);
      const promptParts: string[] = [];
      const memoryLines = [...memoryContext.formattedTurns];
      const gapFillMessages = await fetchGapFillMessages({
        message,
        lastSeenMessageId: memoryContext.lastSeenMessageId,
        seenMessageIds,
        gapFillLimit,
        conversationMemory,
        assistantUserId,
        log,
      });
      const replyReference = await fetchReplyReferenceMessage({
        message,
        seenMessageIds,
        assistantUserId,
        log,
      });

      if (gapFillMessages.length > 0) {
        memoryLines.push(
          ...gapFillMessages.map((entry) =>
            formatContextMessage(entry, {
              invokerId: message.author.id,
              assistantUserId,
            }),
          ),
        );
      }

      if (memoryContext.summary || memoryLines.length > 0) {
        promptParts.push(formatConversationMemoryBlock(memoryContext.summary, memoryLines));
      }

      if (replyReference) {
        promptParts.push(
          [
            "## Replied-to message",
            "The user is replying to this message:",
            formatContextMessage(replyReference, {
              invokerId: message.author.id,
              assistantUserId,
            }),
          ].join("\n\n"),
        );
      }

      promptParts.push(currentPrompt);
      return promptParts.join("\n\n");
    }
  }

  const previousLimit = Math.max(0, contextMessageCount - 1);

  if (previousLimit === 0) {
    return currentPrompt;
  }

  try {
    const previousMessages = await fetchPreviousMessages(message, previousLimit);
    const formattedMessages = [...previousMessages, currentMessage].map((entry) =>
      formatContextMessage(entry, {
        invokerId: message.author.id,
        assistantUserId,
      }),
    );

    return formattedMessages.join("\n\n");
  } catch (error) {
    log
      .withError(error)
      .withMetadata(createAgentMessageLogMetadata(message))
      .warn("Failed to load default agent context.");

    return fallbackPrompt ?? currentPrompt;
  }
}

function formatConversationMemoryBlock(
  summary: string | null,
  formattedTurns: readonly string[],
): string {
  return [
    "## Conversation memory",
    "This is prior conversation the assistant participated in for this channel.",
    summary ? `Summary: ${summary}` : "",
    formattedTurns.length > 0 ? formattedTurns.join("\n\n") : "",
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

async function fetchGapFillMessages({
  message,
  lastSeenMessageId,
  seenMessageIds,
  gapFillLimit,
  conversationMemory,
  assistantUserId,
  log,
}: {
  message: Message;
  lastSeenMessageId: string | null;
  seenMessageIds: Set<string>;
  gapFillLimit: number;
  conversationMemory: ConversationMemoryStore;
  assistantUserId?: string;
  log: LogLayer;
}): Promise<RawMemoryTurn[]> {
  if (!lastSeenMessageId || gapFillLimit <= 0) {
    return [];
  }

  try {
    const fetchedMessages = await fetchMessagesAfter(message, lastSeenMessageId, gapFillLimit);
    const gapFillMessages = fetchedMessages
      .filter((entry) => !seenMessageIds.has(entry.id))
      .map((entry) => createRawMemoryTurn(entry));
    const promptMessages: RawMemoryTurn[] = [];

    if (fetchedMessages.length === gapFillLimit) {
      const skippedTurn = conversationMemory.recordSkippedMessages(
        message.channelId,
        lastSeenMessageId,
      );
      promptMessages.push(skippedTurn);
      seenMessageIds.add(skippedTurn.id);
    }

    if (gapFillMessages.length > 0) {
      conversationMemory.recordTurn(message.channelId, gapFillMessages);
      promptMessages.push(...gapFillMessages);

      for (const entry of gapFillMessages) {
        seenMessageIds.add(entry.id);
      }
    }

    return promptMessages;
  } catch (error) {
    log
      .withError(error)
      .withMetadata({
        ...createAgentMessageLogMetadata(message),
        lastSeenMessageId,
        gapFillLimit,
        assistantUserId,
      })
      .warn("Failed to gap fill conversation memory.");
    return [];
  }
}

async function fetchReplyReferenceMessage({
  message,
  seenMessageIds,
  assistantUserId,
  log,
}: {
  message: Message;
  seenMessageIds: Set<string>;
  assistantUserId?: string;
  log: LogLayer;
}): Promise<RawMemoryTurn | null> {
  const referencedMessageId = message.reference?.messageId;

  if (!referencedMessageId || seenMessageIds.has(referencedMessageId)) {
    return null;
  }

  if (!("fetchReference" in message) || typeof message.fetchReference !== "function") {
    return null;
  }

  try {
    const referencedMessage = await message.fetchReference();
    const turn = createRawMemoryTurn(referencedMessage);
    seenMessageIds.add(turn.id);
    return turn;
  } catch (error) {
    log
      .withError(error)
      .withMetadata({
        ...createAgentMessageLogMetadata(message),
        referencedMessageId,
        assistantUserId,
      })
      .warn("Failed to fetch agent reply reference.");
    return null;
  }
}

export function buildAgentSystemPrompt(
  promptParts: AgentPromptParts,
  metadata: AgentMetadata,
  templateContext: AgentPromptTemplateContext = { prefix: "-" },
): string {
  return [
    renderPromptTemplate(promptParts.defaultPrompt, templateContext),
    renderPromptTemplate(promptParts.webPrompt, templateContext),
    renderPromptTemplate(promptParts.stylePrompt, templateContext),
    renderPromptTemplate(promptParts.metadataPrompt, templateContext),
    renderMetadata(metadata),
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function renderPromptTemplate(prompt: string, { prefix }: AgentPromptTemplateContext): string {
  return prompt.replaceAll("{{PREFIX}}", prefix);
}

export async function loadAgentPromptParts(
  stylePromptName = DEFAULT_STYLE_PROMPT_NAME,
  webSearchEnabled = true,
): Promise<AgentPromptParts> {
  const normalizedStylePromptName = normalizeStylePromptName(stylePromptName);
  const cacheKey = `${normalizedStylePromptName}:${webSearchEnabled ? "web" : "no-web"}`;
  const cached = cachedPromptPartsPromises.get(cacheKey);

  if (cached) {
    return cached;
  }

  const promptPartsPromise = Promise.all([
    readPromptFile(defaultPromptUrl),
    readPromptFile(webSearchEnabled ? webPromptUrl : noWebPromptUrl),
    readPromptFile(getStylePromptUrl(normalizedStylePromptName)),
    readPromptFile(metadataPromptUrl),
  ]).then(([defaultPrompt, webPrompt, stylePrompt, metadataPrompt]) => ({
    defaultPrompt,
    webPrompt,
    stylePrompt,
    metadataPrompt,
  }));

  cachedPromptPartsPromises.set(cacheKey, promptPartsPromise);
  return promptPartsPromise;
}

function createAgentTools({
  client,
  message,
  prefix,
  actions,
  log,
  agentConfirmationTimeoutMs,
  guildConfigStore,
  summarizerModel,
  webSearchEnabled,
  webModel,
  logPrivacy,
  agentConfirmationLifecycle,
}: Pick<
  HandleAgentMentionOptions,
  | "client"
  | "message"
  | "prefix"
  | "actions"
  | "log"
  | "agentConfirmationTimeoutMs"
  | "guildConfigStore"
  | "summarizerModel"
  | "webSearchEnabled"
  | "webModel"
  | "logPrivacy"
> &
  Pick<RunActionToolDependencies, "agentConfirmationLifecycle">) {
  return {
    ...(webSearchEnabled
      ? {
          search_web: createWebSearchTool({
            log,
            logPrivacy,
            ...(webModel ? { model: webModel } : {}),
          }),
        }
      : {}),
    request_context: createRequestContextTool({
      message,
      invokerId: message.author.id,
      assistantUserId: message.client.user?.id,
      ...(summarizerModel
        ? {
            summarizeContext: (formattedMessages, options) =>
              summarizeRequestContextWithModel(formattedMessages, {
                ...summarizerModel,
                abortSignal: options?.abortSignal,
              }),
          }
        : {}),
    }),
    run_action: createRunActionTool({
      client,
      message,
      prefix,
      actions,
      log,
      runMessage: handleMessage,
      ...(agentConfirmationTimeoutMs !== undefined ? { agentConfirmationTimeoutMs } : {}),
      agentConfirmationLifecycle,
      ...(guildConfigStore ? { guildConfigStore } : {}),
    }),
  };
}

function createCurrentContextMessage(
  message: Message,
  assistantUserId?: string,
): ContextMessageLike {
  return {
    id: message.id,
    content: extractMentionPrompt(message.content, assistantUserId),
    createdTimestamp: message.createdTimestamp,
    author: {
      id: message.author.id,
      bot: message.author.bot,
      username: message.author.username,
      tag: message.author.tag,
    },
  };
}

function recordAgentTurn({
  message,
  assistantUserId,
  reply,
  replyMessage,
  conversationMemory,
  log,
  summarizerModel,
  logPrivacy,
}: {
  message: Message;
  assistantUserId?: string;
  reply?: string;
  replyMessage?: Message | null;
  conversationMemory?: ConversationMemoryStore;
  log: LogLayer;
  summarizerModel?: ResolvedTextModel;
  logPrivacy?: boolean;
}): void {
  if (!conversationMemory) {
    return;
  }

  const turns = [createRawMemoryTurn(createCurrentContextMessage(message, assistantUserId))];

  if (reply && replyMessage) {
    turns.push(
      createRawMemoryTurn({
        id: replyMessage.id,
        content: reply,
        createdTimestamp: replyMessage.createdTimestamp,
        author: {
          id: replyMessage.author.id,
          bot: replyMessage.author.bot,
          username: replyMessage.author.username,
          tag: replyMessage.author.tag,
        },
      }),
    );
  }

  conversationMemory.recordTurn(message.channelId, turns);

  if (!conversationMemory.needsCompaction(message.channelId)) {
    return;
  }

  const timeout = createAgentTimeout(DEFAULT_MEMORY_COMPACTION_TIMEOUT_MS);
  const summarize = summarizerModel
    ? (
        formattedMessages: readonly string[],
        options?: { abortSignal?: AbortSignal; previousSummary?: string | null },
      ) =>
        summarizeConversationMemoryWithModel(formattedMessages, {
          ...summarizerModel,
          abortSignal: options?.abortSignal,
          previousSummary: options?.previousSummary,
        })
    : summarizeConversationMemoryWithNano;

  void conversationMemory
    .compact(message.channelId, summarize, {
      invokerId: message.author.id,
      assistantUserId,
      log,
      abortSignal: timeout.signal,
      logPrivacy,
    })
    .finally(timeout.clear);
}

function createAgentMessageLogMetadata(message: Message): Record<string, unknown> {
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
  };
}

function createToolCallLogMetadata(
  event: {
    stepNumber?: number;
    toolCall: {
      toolName: string;
      toolCallId: string;
      input: unknown;
    };
  },
  options: { logPrivacy?: boolean } = {},
): Record<string, unknown> {
  return {
    stepNumber: event.stepNumber,
    toolName: event.toolCall.toolName,
    toolCallId: event.toolCall.toolCallId,
    ...(options.logPrivacy ? { inputRedacted: true } : { input: event.toolCall.input }),
  };
}

function createToolOutputLogMetadata(
  output: unknown,
  options: { logPrivacy?: boolean } = {},
): Record<string, unknown> {
  return options.logPrivacy ? { outputRedacted: true } : { output };
}

interface AgentTypingIndicator {
  pause: () => void;
  resume: (options?: { immediate?: boolean }) => void;
  stop: () => void;
}

function startTypingIndicator({
  message,
  log,
  intervalMs,
}: {
  message: Message;
  log: LogLayer;
  intervalMs: number;
}): AgentTypingIndicator {
  let stopped = false;
  let paused = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let sendInFlight = false;

  const clearScheduledRefresh = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };

  const scheduleNextRefresh = () => {
    if (stopped || paused) {
      return;
    }

    clearScheduledRefresh();
    timeout = setTimeout(refresh, intervalMs);

    unrefTimer(timeout);
  };

  const refresh = () => {
    if (stopped || paused || sendInFlight) {
      return;
    }

    sendInFlight = true;
    void sendTyping(message, log).finally(() => {
      sendInFlight = false;
      scheduleNextRefresh();
    });
  };

  refresh();

  return {
    pause: () => {
      paused = true;
      clearScheduledRefresh();
    },
    resume: (options = {}) => {
      if (stopped) {
        return;
      }

      paused = false;

      if (options.immediate) {
        refresh();
        return;
      }

      scheduleNextRefresh();
    },
    stop: () => {
      stopped = true;
      clearScheduledRefresh();
    },
  };
}

async function sendTyping(message: Message, log: LogLayer): Promise<void> {
  if (!("sendTyping" in message.channel) || typeof message.channel.sendTyping !== "function") {
    return;
  }

  try {
    await message.channel.sendTyping();
  } catch (error) {
    log
      .withError(error)
      .withMetadata(createAgentMessageLogMetadata(message))
      .warn("Failed to send agent typing indicator.");
  }
}

async function runAgentTextGeneration(
  options: Parameters<typeof generateText>[0],
): Promise<Pick<Awaited<ReturnType<typeof generateText>>, "text">> {
  return generateText(options);
}

async function readPromptFile(url: URL): Promise<string> {
  return readFile(url, "utf8").then((content) => content.trim());
}

function getStylePromptUrl(stylePromptName: string): URL {
  return new URL(`${stylePromptName}.md`, stylePromptDirectoryUrl);
}

function normalizeStylePromptName(stylePromptName: string): string {
  const trimmed = stylePromptName.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error(`Invalid style prompt name: ${stylePromptName}`);
  }

  return trimmed;
}

function renderMetadata(metadata: AgentMetadata): string {
  return [
    `- Bot name: ${metadata.botName}`,
    `- Bot version: ${metadata.botVersion}`,
    `- Current date and time: ${metadata.currentDateTime}`,
  ].join("\n");
}

function formatUserIdentity(user: {
  id: string;
  bot?: boolean;
  username?: string | null;
  tag?: string | null;
}): string {
  if (user.bot) {
    return "assistant";
  }

  const username = user.username?.trim() || user.tag?.trim() || "unknown";
  return `user (username: ${username}, id: ${user.id})`;
}

function normalizeAgentReply(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : EMPTY_AGENT_REPLY;
}
