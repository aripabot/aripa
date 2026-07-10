import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimePaths } from "@aripabot/core/config/runtime-paths.ts";
import {
  DEFAULT_RUNTIME_CONFIG,
  config,
  isGuildAllowed,
  loadRuntimeJsonConfig,
  parseRuntimeJsonConfig,
  resolveDatabasePath,
} from "@aripabot/core/config/config.ts";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));

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
        memory: {
          enabled: false,
          idleTtlMinutes: 45,
          maxChannels: 250,
          maxVerbatimChars: 12_000,
          keepRecentTurns: 8,
          gapFillLimit: 15,
          coldStartMessageCount: 7,
        },
        models: {
          agent: {
            provider: "openrouter",
            model: " anthropic/claude-sonnet-4.5 ",
            reasoningEffort: "high",
          },
          summarizer: {
            provider: "fm",
            model: " system ",
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
      memory: {
        enabled: false,
        idleTtlMinutes: 45,
        maxChannels: 250,
        maxVerbatimChars: 12_000,
        keepRecentTurns: 8,
        gapFillLimit: 15,
        coldStartMessageCount: 7,
      },
      models: {
        agent: {
          provider: "openrouter",
          model: "anthropic/claude-sonnet-4.5",
          reasoningEffort: "high",
        },
        summarizer: {
          provider: "fm",
          model: "system",
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

  test("falls back to safe memory defaults", () => {
    expect(
      parseRuntimeJsonConfig({
        memory: {
          enabled: true,
          idleTtlMinutes: 0,
          maxChannels: -1,
          maxVerbatimChars: 1.5,
          keepRecentTurns: 0,
          gapFillLimit: -10,
          coldStartMessageCount: Number.NaN,
        },
      }).memory,
    ).toEqual(DEFAULT_RUNTIME_CONFIG.memory);
  });
});

describe("loadRuntimeJsonConfig", () => {
  test("uses defaults when the config file is missing", async () => {
    await expect(
      loadRuntimeJsonConfig(join(repositoryRoot, ".missing-config.json")),
    ).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});

describe("resolveDatabasePath", () => {
  test("uses DATABASE_PATH when configured", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "  /tmp/aripa.sqlite  " }, () => true)).toBe(
      "/tmp/aripa.sqlite",
    );
  });

  test("defaults to the repository root database path when no database exists", () => {
    expect(resolveDatabasePath({}, () => false)).toBe(join(repositoryRoot, "aripa.sqlite"));
  });

  test("prefers an existing legacy bot database", () => {
    const legacyBotPath = join(repositoryRoot, "apps", "bot", "aripa.sqlite");

    expect(resolveDatabasePath({}, (path) => path === legacyBotPath)).toBe(legacyBotPath);
  });

  test("uses the same database path factory as other runtime entrypoints", () => {
    const botDatabase = join(repositoryRoot, "apps", "bot", "aripa.sqlite");
    const fileExists = (path: string) => path === botDatabase;

    expect(resolveDatabasePath({}, fileExists)).toBe(
      createRuntimePaths({ repositoryRoot, fileExists }).databasePath,
    );
  });
});

describe("config", () => {
  test("uses a repository-root database path by default", () => {
    expect(config.databasePath).toBe(join(repositoryRoot, "aripa.sqlite"));
  });
});

describe("isGuildAllowed", () => {
  test("only allows guild ids in the allowlist", () => {
    expect(isGuildAllowed("guild-1", ["guild-1"])).toBe(true);
    expect(isGuildAllowed("guild-2", ["guild-1"])).toBe(false);
    expect(isGuildAllowed(null, ["guild-1"])).toBe(false);
  });
});
