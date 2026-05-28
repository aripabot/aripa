import { describe, expect, test } from "vitest";
import { DEFAULT_RUNTIME_CONFIG, isGuildAllowed, parseRuntimeJsonConfig } from "@/config/config.ts";

describe("parseRuntimeJsonConfig", () => {
  test("uses defaults when config values are absent", () => {
    expect(parseRuntimeJsonConfig({})).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  test("normalizes configured name, operator user id, style prompt, allowlisted server ids, and agent rate limit", () => {
    expect(
      parseRuntimeJsonConfig({
        name: "  Wingbot  ",
        operatorUserId: "  123456789012345678  ",
        stylePrompt: "  friendly  ",
        allowlistedServerIds: [" guild-1 ", "", "guild-2", "guild-1", 123],
        agentRateLimitMessagesPerMinute: 20,
        agentTimeoutMs: 45_000,
        agentMaxConcurrentRequests: 8,
        agentMaxConcurrentRequestsPerGuild: 3,
        logPrivacy: true,
        models: {
          agent: {
            provider: "openrouter",
            model: " anthropic/claude-sonnet-4.5 ",
            reasoningEffort: "high",
          },
          summarizer: {
            provider: "lmstudio",
            model: " local-summary ",
          },
          web: {
            enabled: false,
            provider: "openrouter",
            model: " gemini-2.5-pro ",
          },
        },
        providers: {
          lmstudio: {
            baseURL: " http://localhost:1234/v1 ",
          },
        },
        updates: {
          enabled: true,
          githubRepo: " Owner/repo ",
          releasePublicKeyPemBase64: " abc123 ",
          autoInstall: {
            enabled: true,
            preset: "daily-4am",
            cronExpression: "0 4 * * *",
          },
        },
      }),
    ).toEqual({
      name: "Wingbot",
      operatorUserId: "123456789012345678",
      stylePrompt: "friendly",
      allowlistedServerIds: ["guild-1", "guild-2"],
      agentRateLimitMessagesPerMinute: 20,
      agentTimeoutMs: 45_000,
      agentMaxConcurrentRequests: 8,
      agentMaxConcurrentRequestsPerGuild: 3,
      logPrivacy: true,
      models: {
        agent: {
          provider: "openrouter",
          model: "anthropic/claude-sonnet-4.5",
          reasoningEffort: "high",
        },
        summarizer: {
          provider: "lmstudio",
          model: "local-summary",
          reasoningEffort: "low",
        },
        web: {
          enabled: false,
          provider: "google",
          model: "gemini-2.5-pro",
        },
      },
      providers: {
        lmstudio: {
          baseURL: "http://localhost:1234/v1",
        },
      },
      updates: {
        enabled: true,
        githubRepo: "Owner/repo",
        releasePublicKeyPemBase64: "abc123",
        autoInstall: {
          enabled: true,
          preset: "daily-4am",
          cronExpression: "0 4 * * *",
        },
      },
    });
  });

  test("allows disabling the agent rate limit", () => {
    expect(
      parseRuntimeJsonConfig({
        agentRateLimitMessagesPerMinute: null,
      }).agentRateLimitMessagesPerMinute,
    ).toBeNull();
  });

  test("falls back to no operator when the configured operator user id is invalid", () => {
    expect(parseRuntimeJsonConfig({ operatorUserId: "not-a-snowflake" }).operatorUserId).toBeNull();
  });

  test("falls back to safe agent timeout and concurrency defaults", () => {
    expect(
      parseRuntimeJsonConfig({
        agentTimeoutMs: 0,
        agentMaxConcurrentRequests: -1,
        agentMaxConcurrentRequestsPerGuild: 1.5,
      }),
    ).toMatchObject({
      agentTimeoutMs: DEFAULT_RUNTIME_CONFIG.agentTimeoutMs,
      agentMaxConcurrentRequests: DEFAULT_RUNTIME_CONFIG.agentMaxConcurrentRequests,
      agentMaxConcurrentRequestsPerGuild: DEFAULT_RUNTIME_CONFIG.agentMaxConcurrentRequestsPerGuild,
    });
  });
});

describe("isGuildAllowed", () => {
  test("only allows guild ids in the allowlist", () => {
    expect(isGuildAllowed("guild-1", ["guild-1"])).toBe(true);
    expect(isGuildAllowed("guild-2", ["guild-1"])).toBe(false);
    expect(isGuildAllowed(null, ["guild-1"])).toBe(false);
  });
});
