import { describe, expect, test } from "vitest";
import { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";
import type { Action } from "@aripabot/core/bot/action.ts";
import {
  buildDefaultAgentPrompt,
  buildAgentSystemPrompt,
  createAgentMetadata,
  extractMentionPrompt,
  formatSingleMessagePrompt,
  type AgentTextGenerator,
  handleAgentMention,
  loadAgentPromptParts,
  shouldHandleAgentMention,
} from "@aripabot/core/agent/runtime.ts";
import { ConversationMemoryStore } from "@aripabot/core/agent/conversation-memory.ts";

interface CapturingLog {
  entries: Array<{
    level: string;
    message: string;
    metadata: unknown;
    error: unknown;
  }>;
  withMetadata(metadata: unknown): CapturingLog;
  withError(error: unknown): CapturingLog;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

type AgentTextOptions = Parameters<AgentTextGenerator>[0];
type AgentToolCallStart = NonNullable<AgentTextOptions["experimental_onToolCallStart"]>;
type AgentToolCallFinish = NonNullable<AgentTextOptions["experimental_onToolCallFinish"]>;

type AgentTextOptionsWithToolCallbacks = AgentTextOptions & {
  experimental_onToolCallStart: AgentToolCallStart;
  experimental_onToolCallFinish: AgentToolCallFinish;
};

interface MinimalToolCall {
  type: "tool-call";
  toolName: string;
  toolCallId: string;
  input: unknown;
}

interface MinimalToolCallStartEvent {
  stepNumber?: number;
  toolCall: MinimalToolCall;
}

type MinimalToolCallFinishEvent =
  | (MinimalToolCallStartEvent & {
      durationMs: number;
      success: true;
      output: unknown;
    })
  | (MinimalToolCallStartEvent & {
      durationMs: number;
      success: false;
      error: unknown;
    });

interface RunActionTool {
  execute(input: { command: string }): Promise<unknown>;
}

function withToolCallbacks(options: AgentTextOptions): AgentTextOptionsWithToolCallbacks {
  const { experimental_onToolCallStart, experimental_onToolCallFinish } = options;

  if (!experimental_onToolCallStart || !experimental_onToolCallFinish) {
    throw new Error("Expected agent tool callbacks to be registered.");
  }

  return {
    ...options,
    experimental_onToolCallStart,
    experimental_onToolCallFinish,
  };
}

async function callToolStart(
  callback: AgentToolCallStart,
  event: MinimalToolCallStartEvent,
): Promise<void> {
  await (callback as (event: MinimalToolCallStartEvent) => void | Promise<void>)(event);
}

async function callToolFinish(
  callback: AgentToolCallFinish,
  event: MinimalToolCallFinishEvent,
): Promise<void> {
  await (callback as (event: MinimalToolCallFinishEvent) => void | Promise<void>)(event);
}

function runActionTool(options: AgentTextOptions): RunActionTool {
  const tool = options.tools?.run_action as RunActionTool | undefined;

  if (!tool) {
    throw new Error("Expected run_action tool to be registered.");
  }

  return tool;
}

describe("shouldHandleAgentMention", () => {
  test("only handles non-bot guild messages that mention the bot", () => {
    const client = createClient("bot-1");

    expect(shouldHandleAgentMention(createMessage("<@bot-1> hi"), client)).toBe(true);
    expect(shouldHandleAgentMention(createMessage("<@bot-1> hi", { inGuild: false }), client)).toBe(
      false,
    );
    expect(
      shouldHandleAgentMention(createMessage("<@bot-1> hi", { authorBot: true }), client),
    ).toBe(false);
    expect(shouldHandleAgentMention(createMessage("hi"), client)).toBe(false);
  });
});

describe("extractMentionPrompt", () => {
  test("removes normal and nickname bot mentions", () => {
    expect(extractMentionPrompt("<@bot-1> can you ping?", "bot-1")).toBe("can you ping?");
    expect(extractMentionPrompt("hey <@!bot-1> please help", "bot-1")).toBe("hey please help");
  });

  test("uses a conversational fallback when only mentioned", () => {
    expect(extractMentionPrompt("<@bot-1>", "bot-1")).toContain(
      "mentioned you without additional text",
    );
  });
});

describe("buildAgentSystemPrompt", () => {
  test("combines default, style, metadata prompt, and injected metadata", () => {
    const system = buildAgentSystemPrompt(
      {
        defaultPrompt: "default instructions\n`{{PREFIX}}ping`",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      },
      {
        botName: "Aripa",
        botVersion: "0.1.0-alpha.3",
        currentDateTime: "2026-04-26T12:34:56.000Z",
      },
      {
        prefix: "!",
      },
    );

    expect(system).toContain("default instructions");
    expect(system).toContain("`!ping`");
    expect(system).not.toContain("{{PREFIX}}");
    expect(system).toContain("match style");
    expect(system).toContain("metadata header");
    expect(system).toContain("- Bot name: Aripa");
    expect(system).toContain("- Bot version: 0.1.0-alpha.3");
    expect(system).toContain("- Current date and time: 2026-04-26T12:34:56.000Z");
  });

  test("uses the configured bot name in injected metadata", () => {
    const metadata = createAgentMetadata(new Date("2026-04-26T12:34:56.000Z"), "Wingbot");

    expect(metadata).toEqual({
      botName: "Wingbot",
      botVersion: expect.any(String),
      currentDateTime: "2026-04-26T12:34:56.000Z",
    });
  });
});

describe("formatSingleMessagePrompt", () => {
  test("includes the invoking user's Discord username and id", () => {
    expect(formatSingleMessagePrompt(createMessage("<@bot-1> hello"), "hello")).toBe(
      "user (username: alice, id: user-1): hello",
    );
  });
});

describe("buildDefaultAgentPrompt", () => {
  test("includes two previous messages and the current mention by default", async () => {
    const prompt = await buildDefaultAgentPrompt({
      message: createMessage("<@bot-1> what happened?", {
        previousMessages: [
          createPreviousMessage("previous-1", "user-2", "Earlier question", 1, {
            username: "bob",
          }),
          createPreviousMessage("previous-2", "bot-1", "Earlier answer", 2, {
            bot: true,
            username: "Airpod",
          }),
          createPreviousMessage("previous-3", "user-3", "Most recent context", 3, {
            username: "casey",
          }),
        ],
      }),
      assistantUserId: "bot-1",
      log: createLog(),
    });

    expect(prompt).toBe(
      [
        "assistant: Earlier answer",
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: casey, id: user-3): Most recent context",
        "user (username: alice, id: user-1): what happened?",
      ].join("\n\n"),
    );
  });

  test("uses conversation memory, gap fill, replied-to message, and current message in order", async () => {
    const conversationMemory = new ConversationMemoryStore();
    conversationMemory.recordTurn("channel-1", [
      createPreviousMessage("memory-1", "user-1", "remember this", 1, {
        username: "alice",
      }),
      createPreviousMessage("memory-2", "bot-1", "I remembered it", 2, {
        bot: true,
        username: "Airpod",
      }),
    ]);

    const prompt = await buildDefaultAgentPrompt({
      message: createMessage("<@bot-1> what now?", {
        afterMessages: [
          createPreviousMessage("gap-1", "user-2", "intervening context", 3, {
            username: "bob",
          }),
          createPreviousMessage("message-1", "user-1", "<@bot-1> what now?", 4, {
            username: "alice",
          }),
        ],
        referencedMessage: createPreviousMessage("referenced-1", "bot-1", "the prior answer", 2, {
          bot: true,
          username: "Airpod",
        }),
      }),
      assistantUserId: "bot-1",
      conversationMemory,
      gapFillLimit: 10,
      log: createLog(),
    });

    expect(prompt).toBe(
      [
        "## Conversation memory",
        "This is prior conversation the assistant participated in for this channel.",
        [
          "user (username: alice, id: user-1): remember this",
          "assistant: I remembered it",
          "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: bob, id: user-2): intervening context",
        ].join("\n\n"),
        "## Replied-to message",
        "The user is replying to this message:",
        "assistant: the prior answer",
        "user (username: alice, id: user-1): what now?",
      ].join("\n\n"),
    );

    expect(
      conversationMemory.getContext("channel-1", {
        invokerId: "user-1",
        assistantUserId: "bot-1",
      })?.formattedTurns,
    ).toContain(
      "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: bob, id: user-2): intervening context",
    );
  });

  test("uses configured cold-start message count when memory has no channel entry", async () => {
    const prompt = await buildDefaultAgentPrompt({
      message: createMessage("<@bot-1> cold start", {
        previousMessages: [
          createPreviousMessage("previous-1", "user-2", "one", 1, { username: "bob" }),
          createPreviousMessage("previous-2", "user-3", "two", 2, { username: "casey" }),
          createPreviousMessage("previous-3", "user-4", "three", 3, { username: "drew" }),
          createPreviousMessage("previous-4", "user-1", "four", 4, { username: "alice" }),
        ],
      }),
      assistantUserId: "bot-1",
      conversationMemory: new ConversationMemoryStore(),
      contextMessageCount: 5,
      log: createLog(),
    });

    expect(prompt).toBe(
      [
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: bob, id: user-2): one",
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: casey, id: user-3): two",
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: drew, id: user-4): three",
        "user (username: alice, id: user-1): four",
        "user (username: alice, id: user-1): cold start",
      ].join("\n\n"),
    );
  });

  test("continues with ledger context when gap fill fails", async () => {
    const conversationMemory = new ConversationMemoryStore();
    const log = createCapturingLog();
    conversationMemory.recordTurn("channel-1", [
      createPreviousMessage("memory-1", "user-1", "remember this", 1, {
        username: "alice",
      }),
    ]);

    const prompt = await buildDefaultAgentPrompt({
      message: createMessage("<@bot-1> keep going", {
        fetchAfterError: new Error("missing access"),
      }),
      assistantUserId: "bot-1",
      conversationMemory,
      log: log as never,
    });

    expect(prompt).toContain("user (username: alice, id: user-1): remember this");
    expect(prompt).toContain("user (username: alice, id: user-1): keep going");
    expect(log.entries).toContainEqual({
      level: "warn",
      message: "Failed to gap fill conversation memory.",
      metadata: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        userId: "user-1",
        lastSeenMessageId: "memory-1",
        gapFillLimit: 10,
        assistantUserId: "bot-1",
      },
      error: new Error("missing access"),
    });
  });
});

describe("loadAgentPromptParts", () => {
  test("loads the default, match style, and metadata prompts from disk", async () => {
    const parts = await loadAgentPromptParts();

    expect(parts.defaultPrompt).toContain("You are an agentic Discord bot");
    expect(parts.defaultPrompt).toContain("{{PREFIX}}ping");
    expect(parts.webPrompt).toContain("Web search is enabled");
    expect(parts.stylePrompt).toContain("Match the vibe");
    expect(parts.metadataPrompt).toContain("Operator supplied metadata");
  });

  test("loads an arbitrary configured style prompt from the styles directory", async () => {
    const parts = await loadAgentPromptParts("friendly");

    expect(parts.defaultPrompt).toContain("You are an agentic Discord bot");
    expect(parts.webPrompt).toContain("Web search is enabled");
    expect(parts.stylePrompt).toContain("warm, approachable");
    expect(parts.metadataPrompt).toContain("Operator supplied metadata");
  });

  test("loads no-web instructions when web search is disabled", async () => {
    const parts = await loadAgentPromptParts("match", false);

    expect(parts.webPrompt).toContain("Web search is not enabled");
  });
});

describe("handleAgentMention", () => {
  test("records privacy-aware agent traces", async () => {
    const events: Array<{ method: string; input: unknown }> = [];
    const traceRecorder = {
      startTrace(input: unknown) {
        events.push({ method: "startTrace", input });
        return "trace-1";
      },
      startSpan(input: unknown) {
        events.push({ method: "startSpan", input });
        return "span-1";
      },
      finishSpan(input: unknown) {
        events.push({ method: "finishSpan", input });
      },
      finishTrace(input: unknown) {
        events.push({ method: "finishTrace", input });
      },
    };

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> show the exact context"),
      prefix: "-",
      actions: new ActionDirectory(),
      logPrivacy: false,
      traceRecorder,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async () => ({ text: "Visible reply." }),
    });

    expect(events.at(0)).toMatchObject({
      method: "startTrace",
      input: {
        guildId: "guild-1",
        channelId: "channel-1",
        private: false,
        prompt: expect.stringContaining("show the exact context"),
        system: expect.stringContaining("default instructions"),
      },
    });
    expect(events).toContainEqual({
      method: "finishTrace",
      input: { traceId: "trace-1", status: "completed", reply: "Visible reply." },
    });
  });

  test("runs the AI SDK agent loop and replies with the generated text", async () => {
    const replies: string[] = [];
    const captured: AgentTextOptions[] = [];

    const result = await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> please check this", {
        replies,
        previousMessages: [
          createPreviousMessage("previous-1", "user-2", "extra background", 1, {
            username: "bob",
          }),
          createPreviousMessage("previous-2", "user-1", "my earlier ask", 2, {
            username: "alice",
          }),
        ],
      }),
      prefix: "-",
      actions: new ActionDirectory(),
      log: createLog(),
      now: new Date("2026-04-26T12:34:56.000Z"),
      botName: "Wingbot",
      stylePromptName: "friendly",
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        captured.push(options);
        return { text: "Got it." };
      },
    });

    expect(result).toEqual({
      status: "completed",
      prompt: [
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: bob, id: user-2): extra background",
        "user (username: alice, id: user-1): my earlier ask",
        "user (username: alice, id: user-1): please check this",
      ].join("\n\n"),
      reply: "Got it.",
    });
    expect(replies).toEqual(["Got it."]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.prompt).toBe(
      [
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: bob, id: user-2): extra background",
        "user (username: alice, id: user-1): my earlier ask",
        "user (username: alice, id: user-1): please check this",
      ].join("\n\n"),
    );
    expect(String(captured[0]?.system)).toContain("- Bot name: Wingbot");
    expect(String(captured[0]?.system)).toContain("2026-04-26T12:34:56.000Z");
    expect(Object.keys(captured[0]?.tools ?? {}).sort()).toEqual([
      "request_context",
      "run_action",
      "search_web",
    ]);
  });

  test("records successful turns in conversation memory with the bot reply id", async () => {
    const conversationMemory = new ConversationMemoryStore();

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> remember the plan"),
      prefix: "-",
      actions: new ActionDirectory(),
      conversationMemory,
      log: createLog(),
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async () => ({ text: "Plan remembered." }),
    });

    expect(
      conversationMemory.getContext("channel-1", {
        invokerId: "user-1",
        assistantUserId: "bot-1",
      }),
    ).toMatchObject({
      lastSeenMessageId: "reply-1",
      formattedTurns: [
        "user (username: alice, id: user-1): remember the plan",
        "assistant: Plan remembered.",
      ],
    });
  });

  test("records failed turns without the generic error reply", async () => {
    const conversationMemory = new ConversationMemoryStore();

    const result = await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> this will fail"),
      prefix: "-",
      actions: new ActionDirectory(),
      conversationMemory,
      log: createLog(),
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async () => {
        throw new Error("model failed");
      },
    });

    expect(result.status).toBe("failed");
    expect(
      conversationMemory.getContext("channel-1", {
        invokerId: "user-1",
        assistantUserId: "bot-1",
      }),
    ).toMatchObject({
      lastSeenMessageId: "message-1",
      formattedTurns: ["user (username: alice, id: user-1): this will fail"],
    });
  });

  test("starts compaction after replying without waiting for it", async () => {
    const conversationMemory = new ConversationMemoryStore({ maxVerbatimChars: 1 });
    let compactStarted = false;
    let compactResolved = false;
    conversationMemory.compact = async () => {
      compactStarted = true;
      await sleep(25);
      compactResolved = true;
    };

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> compact this"),
      prefix: "-",
      actions: new ActionDirectory(),
      conversationMemory,
      log: createLog(),
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async () => ({ text: "Compaction can happen later." }),
    });

    expect(compactStarted).toBe(true);
    expect(compactResolved).toBe(false);

    await sleep(35);

    expect(compactResolved).toBe(true);
  });

  test("keeps prompt compatibility when no memory store is supplied", async () => {
    const captured: AgentTextOptions[] = [];

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> please check this", {
        previousMessages: [
          createPreviousMessage("previous-1", "user-2", "extra background", 1, {
            username: "bob",
          }),
          createPreviousMessage("previous-2", "user-1", "my earlier ask", 2, {
            username: "alice",
          }),
        ],
      }),
      prefix: "-",
      actions: new ActionDirectory(),
      log: createLog(),
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        captured.push(options);
        return { text: "Got it." };
      },
    });

    expect(captured[0]?.prompt).toBe(
      [
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: bob, id: user-2): extra background",
        "user (username: alice, id: user-1): my earlier ask",
        "user (username: alice, id: user-1): please check this",
      ].join("\n\n"),
    );
  });

  test("omits the web tool when web search is disabled", async () => {
    const captured: AgentTextOptions[] = [];

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> what is happening today?"),
      prefix: "-",
      actions: new ActionDirectory(),
      log: createLog(),
      webSearchEnabled: false,
      generateAgentText: async (options) => {
        captured.push(options);
        return { text: "Web search is disabled." };
      },
    });

    expect(Object.keys(captured[0]?.tools ?? {}).sort()).toEqual(["request_context", "run_action"]);
    expect(String(captured[0]?.system)).toContain("Web search is not enabled");
  });

  test("logs AI SDK tool call start and finish events", async () => {
    const log = createCapturingLog();

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> please run ping"),
      prefix: "-",
      actions: new ActionDirectory(),
      log: log as never,
      logPrivacy: false,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        const callbacks = withToolCallbacks(options);
        const toolCall = {
          type: "tool-call",
          toolName: "run_action",
          toolCallId: "tool-call-1",
          input: { command: "-ping" },
        } satisfies MinimalToolCall;

        await callToolStart(callbacks.experimental_onToolCallStart, {
          stepNumber: 1,
          toolCall,
        });
        await callToolFinish(callbacks.experimental_onToolCallFinish, {
          stepNumber: 1,
          toolCall,
          durationMs: 42,
          success: true,
          output: {
            ok: true,
          },
        });

        return { text: "pong" };
      },
    });

    expect(log.entries).toContainEqual({
      level: "info",
      message: "Agent tool call started.",
      metadata: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        userId: "user-1",
        stepNumber: 1,
        toolName: "run_action",
        toolCallId: "tool-call-1",
        input: { command: "-ping" },
      },
      error: undefined,
    });
    expect(log.entries).toContainEqual({
      level: "info",
      message: "Agent tool call completed.",
      metadata: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        userId: "user-1",
        stepNumber: 1,
        toolName: "run_action",
        toolCallId: "tool-call-1",
        input: { command: "-ping" },
        durationMs: 42,
        success: true,
        output: { ok: true },
      },
      error: undefined,
    });
  });

  test("redacts agent tool payloads when log privacy is enabled", async () => {
    const log = createCapturingLog();

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> summarize context"),
      prefix: "-",
      actions: new ActionDirectory(),
      log: log as never,
      logPrivacy: true,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        const callbacks = withToolCallbacks(options);
        const toolCall = {
          type: "tool-call",
          toolName: "request_context",
          toolCallId: "tool-call-private",
          input: { size: "xl" },
        } satisfies MinimalToolCall;

        await callToolStart(callbacks.experimental_onToolCallStart, {
          stepNumber: 1,
          toolCall,
        });
        await callToolFinish(callbacks.experimental_onToolCallFinish, {
          stepNumber: 1,
          toolCall,
          durationMs: 42,
          success: true,
          output: {
            messages: ["private channel context"],
          },
        });

        return { text: "Done." };
      },
    });

    expect(log.entries).toContainEqual({
      level: "info",
      message: "Agent tool call completed.",
      metadata: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        userId: "user-1",
        stepNumber: 1,
        toolName: "request_context",
        toolCallId: "tool-call-private",
        inputRedacted: true,
        durationMs: 42,
        success: true,
        outputRedacted: true,
      },
      error: undefined,
    });
  });

  test("logs failed AI SDK tool calls with pino-compatible error metadata", async () => {
    const log = createCapturingLog();

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> search this"),
      prefix: "-",
      actions: new ActionDirectory(),
      log: log as never,
      logPrivacy: false,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        const callbacks = withToolCallbacks(options);

        await callToolFinish(callbacks.experimental_onToolCallFinish, {
          stepNumber: 2,
          toolCall: {
            type: "tool-call",
            toolName: "search_web",
            toolCallId: "tool-call-2",
            input: { question: "current info" },
          } satisfies MinimalToolCall,
          durationMs: 7,
          success: false,
          error: new Error("provider failed"),
        });

        return { text: "I could not search." };
      },
    });

    expect(log.entries).toContainEqual({
      level: "error",
      message: "Agent tool call failed.",
      metadata: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        userId: "user-1",
        stepNumber: 2,
        toolName: "search_web",
        toolCallId: "tool-call-2",
        input: { question: "current info" },
        durationMs: 7,
        success: false,
        error: {
          name: "Error",
          message: "provider failed",
        },
      },
      error: new Error("provider failed"),
    });
  });

  test("refreshes the typing indicator until the agent finishes", async () => {
    const typingCalls: number[] = [];

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> take your time", { typingCalls }),
      prefix: "-",
      actions: new ActionDirectory(),
      log: createLog(),
      typingRefreshIntervalMs: 5,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async () => {
        await sleep(18);
        return { text: "Done." };
      },
    });

    expect(typingCalls.length).toBeGreaterThanOrEqual(2);

    const callsAfterCompletion = typingCalls.length;
    await sleep(15);

    expect(typingCalls).toHaveLength(callsAfterCompletion);
  });

  test("pauses typing while an agent action waits for confirmation", async () => {
    const typingCalls: number[] = [];
    const actions = new ActionDirectory();
    actions.add(
      {
        name: "ban",
        requiredUserPermissions: ["BanMembers"],
        async execute() {},
      } satisfies Action,
      "test",
    );

    await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> ban the spammer", {
        typingCalls,
        confirmationReactionEmoji: "\u2705",
        confirmationDelayMs: 20,
      }),
      prefix: "-",
      actions,
      log: createLog(),
      typingRefreshIntervalMs: 5,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        const result = await runActionTool(options).execute({
          command: "-ban @spammer spam",
        });

        expect(result).toMatchObject({
          ok: true,
          status: "completed",
          action: "ban",
        });

        return { text: "Done." };
      },
    });

    expect(typingCalls).toHaveLength(2);
  });

  test("does not call the model for direct messages", async () => {
    let called = false;

    const result = await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> hello", { inGuild: false }),
      prefix: "-",
      actions: new ActionDirectory(),
      log: createLog(),
      generateAgentText: async () => {
        called = true;
        return { text: "nope" };
      },
    });

    expect(result).toEqual({ status: "ignored" });
    expect(called).toBe(false);
  });

  test("passes a timeout abort signal to agent generation", async () => {
    const replies: string[] = [];
    const result = await handleAgentMention({
      client: createClient("bot-1"),
      message: createMessage("<@bot-1> think slowly", { replies }),
      prefix: "-",
      actions: new ActionDirectory(),
      log: createLog(),
      agentTimeoutMs: 5,
      loadPromptParts: async () => ({
        defaultPrompt: "default instructions",
        webPrompt: "web instructions",
        stylePrompt: "match style",
        metadataPrompt: "metadata header",
      }),
      generateAgentText: async (options) => {
        const signal = (options as { abortSignal?: AbortSignal }).abortSignal;

        expect(signal).toBeInstanceOf(AbortSignal);

        await new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          setTimeout(resolve, 50);
        });

        return { text: "too late" };
      },
    });

    expect(result.status).toBe("failed");
    expect(replies).toEqual(["Sorry, I ran into an error while thinking through that."]);
  });
});

describe("createAgentMetadata", () => {
  test("injects the default bot name and current ISO timestamp", () => {
    const metadata = createAgentMetadata(new Date("2026-04-26T12:34:56.000Z"));

    expect(metadata).toEqual({
      botName: "Aripa",
      botVersion: expect.any(String),
      currentDateTime: "2026-04-26T12:34:56.000Z",
    });
  });
});

function createClient(botId: string) {
  return {
    user: {
      id: botId,
    },
  } as never;
}

function createMessage(
  content: string,
  options: {
    inGuild?: boolean;
    authorBot?: boolean;
    replies?: string[];
    typingCalls?: number[];
    previousMessages?: ReturnType<typeof createPreviousMessage>[];
    afterMessages?: ReturnType<typeof createPreviousMessage>[];
    referencedMessage?: ReturnType<typeof createPreviousMessage>;
    fetchAfterError?: Error;
    confirmationReactionEmoji?: string;
    confirmationDelayMs?: number;
  } = {},
) {
  const botId = "bot-1";
  const confirmationMessage = {
    react: async () => undefined,
    edit: async () => confirmationMessage,
    awaitReactions: async () => {
      if (options.confirmationDelayMs) {
        await sleep(options.confirmationDelayMs);
      }

      if (!options.confirmationReactionEmoji) {
        return {
          first: () => undefined,
        };
      }

      return {
        first: () => ({
          emoji: {
            name: options.confirmationReactionEmoji,
          },
        }),
      };
    },
  };

  return {
    author: {
      bot: options.authorBot ?? false,
      id: "user-1",
      username: "alice",
    },
    content,
    guildId: options.inGuild === false ? null : "guild-1",
    channelId: "channel-1",
    id: "message-1",
    member: {
      id: "member-1",
    },
    client: {
      user: {
        id: botId,
      },
    },
    mentions: {
      users: {
        has(id: string) {
          return (
            id === botId && (content.includes(`<@${botId}>`) || content.includes(`<@!${botId}>`))
          );
        },
      },
    },
    channel: {
      permissionsFor() {
        return {
          has() {
            return true;
          },
        };
      },
      sendTyping: async () => {
        options.typingCalls?.push(Date.now());
      },
      messages: {
        fetch: async ({
          before,
          after,
          limit,
        }: {
          before?: string;
          after?: string;
          limit: number;
        }) => {
          if (after) {
            if (options.fetchAfterError) {
              throw options.fetchAfterError;
            }

            const selected = (options.afterMessages ?? []).slice(-limit).reverse();
            return new Map(selected.map((message) => [message.id, message]));
          }

          expect(before).toBe("message-1");
          const selected = (options.previousMessages ?? []).slice(-limit).reverse();
          return new Map(selected.map((message) => [message.id, message]));
        },
      },
    },
    inGuild: () => options.inGuild ?? true,
    reference: options.referencedMessage ? { messageId: options.referencedMessage.id } : null,
    fetchReference: async () => {
      if (!options.referencedMessage) {
        throw new Error("No referenced message configured.");
      }

      return options.referencedMessage;
    },
    reply: async ({ content: replyContent, embeds }: { content?: string; embeds?: unknown[] }) => {
      if (replyContent) {
        options.replies?.push(replyContent);
      }

      if (embeds) {
        return confirmationMessage;
      }

      return {
        id: "reply-1",
        content: replyContent,
        createdTimestamp: 10_000,
        author: {
          id: botId,
          bot: true,
          username: "Airpod",
        },
      };
    },
  } as never;
}

function createPreviousMessage(
  id: string,
  authorId: string,
  content: string,
  createdTimestamp: number,
  options: {
    bot?: boolean;
    username?: string;
  } = {},
) {
  return {
    id,
    content,
    createdTimestamp,
    author: {
      id: authorId,
      bot: options.bot ?? false,
      username: options.username ?? authorId,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function createCapturingLog(): CapturingLog {
  const entries: Array<{
    level: string;
    message: string;
    metadata: unknown;
    error: unknown;
  }> = [];
  const state: {
    metadata?: unknown;
    error?: unknown;
  } = {};

  return {
    entries,
    withMetadata(metadata: unknown) {
      state.metadata = metadata;
      return this;
    },
    withError(error: unknown) {
      state.error = error;
      return this;
    },
    info(message: string) {
      entries.push({
        level: "info",
        message,
        metadata: state.metadata,
        error: state.error,
      });
      state.metadata = undefined;
      state.error = undefined;
    },
    warn(message: string) {
      entries.push({
        level: "warn",
        message,
        metadata: state.metadata,
        error: state.error,
      });
      state.metadata = undefined;
      state.error = undefined;
    },
    error(message: string) {
      entries.push({
        level: "error",
        message,
        metadata: state.metadata,
        error: state.error,
      });
      state.metadata = undefined;
      state.error = undefined;
    },
  };
}
