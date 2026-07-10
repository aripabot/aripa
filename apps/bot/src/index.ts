import { fileURLToPath } from "node:url";
import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import { loadActions } from "@aripabot/core/bot/action-loader.ts";
import { config, isGuildAllowed, requireToken } from "@aripabot/core/config/config.ts";
import { log } from "@aripabot/core/config/logger.ts";
import { handleMessage } from "@aripabot/core/bot/message-router.ts";
import { getMuteScheduler } from "@aripabot/core/moderation/mute-scheduler.ts";
import { handleAgentMention, shouldHandleAgentMention } from "@aripabot/core/agent/runtime.ts";
import { AgentRateLimiter, formatRateLimitRetryAfter } from "@aripabot/core/agent/rate-limit.ts";
import { AgentConcurrencyLimiter } from "@aripabot/core/agent/concurrency.ts";
import { ConversationMemoryStore } from "@aripabot/core/agent/conversation-memory.ts";
import { AgentTraceStore, resolveAgentTracePath } from "@aripabot/core/agent/traces.ts";
import { safeReply } from "@aripabot/core/bot/action-context.ts";
import {
  resolveAgentTextModel,
  resolveSummarizerTextModel,
  resolveWebTextModel,
} from "@aripabot/core/agent/models.ts";

const token = requireToken();
const actions = await loadActions(fileURLToPath(new URL("./actions", import.meta.url)));
const agentRateLimiter =
  config.agentRateLimitMessagesPerMinute === null
    ? null
    : new AgentRateLimiter({ limit: config.agentRateLimitMessagesPerMinute });
const agentConcurrencyLimiter = new AgentConcurrencyLimiter({
  maxGlobal: config.agentMaxConcurrentRequests,
  maxPerGuild: config.agentMaxConcurrentRequestsPerGuild,
});
const conversationMemory = config.memory.enabled
  ? new ConversationMemoryStore({
      idleTtlMs: config.memory.idleTtlMinutes * 60_000,
      maxChannels: config.memory.maxChannels,
      maxVerbatimChars: config.memory.maxVerbatimChars,
      keepRecentTurns: config.memory.keepRecentTurns,
    })
  : undefined;
const agentTraceStore = new AgentTraceStore(resolveAgentTracePath(config.databasePath));
const agentModel = resolveAgentTextModel(config.models.agent, config.providers);
const summarizerModel = resolveSummarizerTextModel(config.models.summarizer, config.providers);
const webModel = config.models.web.enabled
  ? resolveWebTextModel(config.models.web, config.providers)
  : undefined;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await getMuteScheduler(log).start(client);
  } catch (error) {
    log.withError(error).error("Failed to start mute scheduler.");
  }

  log
    .withMetadata({
      botId: readyClient.user.id,
      tag: readyClient.user.tag,
      actionCount: actions.size,
      prefix: config.prefix,
    })
    .info("Aripa is ready.");
});

async function dispatchMessage(message: Message): Promise<void> {
  try {
    if (!isGuildAllowed(message.guildId)) {
      return;
    }

    if (shouldHandleAgentMention(message, client)) {
      const guildId = message.guildId;
      if (!guildId) {
        return;
      }

      const rateLimitResult = agentRateLimiter?.check(`${guildId}:${message.author.id}`) ?? {
        allowed: true,
        remaining: Number.POSITIVE_INFINITY,
        retryAfterMs: 0,
      };

      if (!rateLimitResult.allowed) {
        log
          .withMetadata({
            guildId: message.guildId,
            channelId: message.channelId,
            messageId: message.id,
            userId: message.author.id,
            retryAfterMs: rateLimitResult.retryAfterMs,
          })
          .warn("Agent mention denied by user rate limit.");

        await safeReply(
          message,
          `You are using agent mentions too quickly. Try again in ${formatRateLimitRetryAfter(rateLimitResult.retryAfterMs)}.`,
          log,
        );
        return;
      }

      const concurrencyResult = agentConcurrencyLimiter.tryAcquire(guildId);

      if (!concurrencyResult.allowed) {
        log
          .withMetadata({
            guildId: message.guildId,
            channelId: message.channelId,
            messageId: message.id,
            userId: message.author.id,
            reason: concurrencyResult.reason,
          })
          .warn("Agent mention denied by concurrency limit.");

        await safeReply(
          message,
          "I am already handling the maximum number of agent requests. Try again shortly.",
          log,
        );
        return;
      }

      try {
        await handleAgentMention({
          client,
          message,
          prefix: config.prefix,
          actions,
          log,
          botName: config.name,
          stylePromptName: config.stylePrompt,
          logPrivacy: config.logPrivacy,
          agentTimeoutMs: config.agentTimeoutMs,
          agentModel,
          summarizerModel,
          webSearchEnabled: config.models.web.enabled,
          conversationMemory,
          traceRecorder: agentTraceStore,
          coldStartMessageCount: config.memory.coldStartMessageCount,
          gapFillLimit: config.memory.gapFillLimit,
          ...(webModel ? { webModel } : {}),
        });
      } finally {
        concurrencyResult.lease.release();
      }

      return;
    }

    await handleMessage({
      client,
      message,
      prefix: config.prefix,
      actions,
      log,
    });
  } catch (error) {
    log
      .withError(error)
      .withMetadata({
        stage: "dispatch",
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: message.author.id,
      })
      .error("Message dispatch failed.");
  }
}

client.on(Events.MessageCreate, (message) => {
  void dispatchMessage(message);
});

client.on(Events.Error, (error) => {
  log.withError(error).error("Discord client emitted an error.");
});

process.on("unhandledRejection", (error) => {
  log.withError(error).error("Unhandled promise rejection.");
});

process.on("uncaughtException", (error) => {
  log.withError(error).fatal("Uncaught exception.");
  process.exitCode = 1;
});

await client.login(token);
