import { describe, expect, test } from "vitest";

import {
  buildRuntimeConfig,
  parseAgentRateLimitInput,
  parseAllowlistedServerIds,
  parseRuntimeOnboardingInput,
  validateGitHubRepo,
  validateAgentRateLimitMessagesPerMinute,
  validateAllowlistedServerIds,
  validateOperatorUserId,
  writeRuntimeConfig,
} from "@aripabot/core/config/onboarding.ts";
import { DEFAULT_RUNTIME_CONFIG } from "@aripabot/core/config/runtime-config.ts";

describe("parseAllowlistedServerIds", () => {
  test("splits comma and whitespace separated ids and removes duplicates", () => {
    expect(
      parseAllowlistedServerIds("123456789012345678, 234567890123456789\n123456789012345678"),
    ).toEqual(["123456789012345678", "234567890123456789"]);
  });
});

describe("parseAgentRateLimitInput", () => {
  test("accepts positive whole numbers and off aliases", () => {
    expect(parseAgentRateLimitInput("20")).toBe(20);
    expect(parseAgentRateLimitInput("off")).toBeNull();
    expect(parseAgentRateLimitInput("none")).toBeNull();
    expect(parseAgentRateLimitInput("0")).toBeNull();
    expect(parseAgentRateLimitInput("1.5")).toBe("invalid");
  });
});

describe("validateAgentRateLimitMessagesPerMinute", () => {
  test("requires a positive whole number or null", () => {
    expect(validateAgentRateLimitMessagesPerMinute(null)).toBeNull();
    expect(validateAgentRateLimitMessagesPerMinute(3)).toBeNull();
    expect(validateAgentRateLimitMessagesPerMinute(0)).toBe(
      "Agent rate limit must be a whole number greater than 0, or off.",
    );
  });
});

describe("validateAllowlistedServerIds", () => {
  test("requires at least one Discord snowflake", () => {
    expect(validateAllowlistedServerIds([])).toBe("Enter at least one Discord server ID.");
    expect(validateAllowlistedServerIds(["not-a-snowflake"])).toBe(
      'Server ID "not-a-snowflake" should be a Discord snowflake with 17-20 digits.',
    );
    expect(validateAllowlistedServerIds(["123456789012345678"])).toBeNull();
  });
});

describe("validateOperatorUserId", () => {
  test("accepts a single optional Discord snowflake", () => {
    expect(validateOperatorUserId(null)).toBeNull();
    expect(validateOperatorUserId("123456789012345678")).toBeNull();
    expect(validateOperatorUserId("not-a-snowflake")).toBe(
      "Operator user ID should be a Discord snowflake with 17-20 digits, or blank.",
    );
  });
});

describe("validateGitHubRepo", () => {
  test("requires owner/repo format", () => {
    expect(validateGitHubRepo("aripabot/aripa")).toBeNull();
    expect(validateGitHubRepo("not-a-repo")).toBe(
      "GitHub update repository must use owner/repo format.",
    );
  });
});

describe("buildRuntimeConfig", () => {
  test("uses defaults and preserves future config fields", () => {
    expect(
      buildRuntimeConfig(
        {
          name: " ",
          operatorUserId: " 123456789012345678 ",
          stylePrompt: "",
          allowlistedServerIds: ["123456789012345678", "123456789012345678"],
          agentRateLimitMessagesPerMinute: null,
          logPrivacy: true,
        },
        {
          futureFeature: true,
        },
      ),
    ).toEqual({
      futureFeature: true,
      name: "Aripa",
      operatorUserId: "123456789012345678",
      stylePrompt: "match",
      allowlistedServerIds: ["123456789012345678"],
      agentRateLimitMessagesPerMinute: null,
      agentTimeoutMs: 60_000,
      agentMaxConcurrentRequests: 4,
      agentMaxConcurrentRequestsPerGuild: 2,
      logPrivacy: true,
      models: {
        agent: {
          provider: "openai",
          model: "gpt-5.6-terra",
          reasoningEffort: "low",
        },
        summarizer: {
          provider: "openai",
          model: "gpt-5.4-nano",
          reasoningEffort: "low",
        },
        web: {
          enabled: true,
          provider: "google",
          model: "gemini-2.5-flash",
        },
      },
      providers: {},
      updates: {
        enabled: true,
        githubRepo: "aripabot/aripa",
        autoInstall: {
          enabled: false,
          preset: "weekly-sunday-4am",
          cronExpression: "0 4 * * 0",
        },
      },
      memory: DEFAULT_RUNTIME_CONFIG.memory,
    });
  });

  test("writes custom update settings", () => {
    expect(
      buildRuntimeConfig({
        allowlistedServerIds: ["123456789012345678"],
        updates: {
          enabled: true,
          githubRepo: " fork-owner/aripa-fork ",
          releasePublicKeyPemBase64: " public-key ",
          autoInstall: {
            enabled: true,
            preset: "daily-4am",
            cronExpression: "0 4 * * *",
          },
        },
      }),
    ).toMatchObject({
      updates: {
        enabled: true,
        githubRepo: "fork-owner/aripa-fork",
        releasePublicKeyPemBase64: "public-key",
        autoInstall: {
          enabled: true,
          preset: "daily-4am",
          cronExpression: "0 4 * * *",
        },
      },
    });
  });

  test("preserves runtime fields outside onboarding ownership", () => {
    const config = buildRuntimeConfig(
      {
        allowlistedServerIds: ["123456789012345678"],
      },
      {
        agentTimeoutMs: 90_000,
        agentMaxConcurrentRequests: 9,
        agentMaxConcurrentRequestsPerGuild: 4,
        memory: {
          ...DEFAULT_RUNTIME_CONFIG.memory,
          maxChannels: 750,
        },
      },
    );

    expect(config).toMatchObject({
      agentTimeoutMs: 90_000,
      agentMaxConcurrentRequests: 9,
      agentMaxConcurrentRequestsPerGuild: 4,
      memory: { maxChannels: 750 },
    });
  });
});

describe("parseRuntimeOnboardingInput", () => {
  test("rejects malformed nested onboarding values before a config write", () => {
    expect(() => parseRuntimeOnboardingInput({ allowlistedServerIds: [] })).toThrow(
      "Enter at least one Discord server ID.",
    );
    expect(() => parseRuntimeOnboardingInput({})).toThrow("allowlistedServerIds");
    expect(() =>
      parseRuntimeOnboardingInput({
        allowlistedServerIds: ["123456789012345678"],
        models: {},
      }),
    ).toThrow();
    expect(() =>
      parseRuntimeOnboardingInput({
        allowlistedServerIds: ["123456789012345678"],
        updates: { enabled: true },
      }),
    ).toThrow();
  });
});

describe("writeRuntimeConfig", () => {
  test("writes config.json and protects existing files unless overwrite is enabled", async () => {
    const path = tempConfigPath("new-config");

    const created = await writeRuntimeConfig({
      pathOrUrl: path,
      input: {
        name: "Test Aripa",
        operatorUserId: "123456789012345678",
        stylePrompt: "friendly",
        allowlistedServerIds: ["123456789012345678"],
        agentRateLimitMessagesPerMinute: 20,
        logPrivacy: true,
      },
    });

    expect(created.existed).toBe(false);
    await expect(
      writeRuntimeConfig({
        pathOrUrl: path,
        input: {
          allowlistedServerIds: ["234567890123456789"],
          agentRateLimitMessagesPerMinute: 5,
          logPrivacy: false,
        },
      }),
    ).rejects.toThrow("already exists");

    const updated = await writeRuntimeConfig({
      pathOrUrl: path,
      input: {
        allowlistedServerIds: ["234567890123456789"],
        agentRateLimitMessagesPerMinute: 5,
        logPrivacy: false,
      },
      overwrite: true,
    });

    expect(updated.existed).toBe(true);
    expect(await Bun.file(path).json()).toEqual({
      name: "Test Aripa",
      operatorUserId: "123456789012345678",
      stylePrompt: "friendly",
      allowlistedServerIds: ["234567890123456789"],
      agentRateLimitMessagesPerMinute: 5,
      agentTimeoutMs: 60_000,
      agentMaxConcurrentRequests: 4,
      agentMaxConcurrentRequestsPerGuild: 2,
      logPrivacy: false,
      models: {
        agent: {
          provider: "openai",
          model: "gpt-5.6-terra",
          reasoningEffort: "low",
        },
        summarizer: {
          provider: "openai",
          model: "gpt-5.4-nano",
          reasoningEffort: "low",
        },
        web: {
          enabled: true,
          provider: "google",
          model: "gemini-2.5-flash",
        },
      },
      providers: {},
      updates: {
        enabled: true,
        githubRepo: "aripabot/aripa",
        autoInstall: {
          enabled: false,
          preset: "weekly-sunday-4am",
          cronExpression: "0 4 * * 0",
        },
      },
      memory: DEFAULT_RUNTIME_CONFIG.memory,
    });
  });

  test("preserves unknown keys while overwriting known onboarding fields", async () => {
    const path = tempConfigPath("existing-config");
    await Bun.write(
      path,
      JSON.stringify({
        futureFeature: {
          enabled: true,
        },
        name: "Old",
        operatorUserId: "111111111111111111",
        stylePrompt: "formal",
        agentRateLimitMessagesPerMinute: 10,
        logPrivacy: true,
        allowlistedServerIds: ["111111111111111111"],
      }),
    );

    await writeRuntimeConfig({
      pathOrUrl: path,
      input: {
        name: "New",
        operatorUserId: null,
        stylePrompt: "playful",
        agentRateLimitMessagesPerMinute: 3,
        logPrivacy: false,
        allowlistedServerIds: ["123456789012345678"],
      },
      overwrite: true,
    });

    expect(await Bun.file(path).json()).toEqual({
      futureFeature: {
        enabled: true,
      },
      name: "New",
      operatorUserId: "111111111111111111",
      stylePrompt: "playful",
      agentRateLimitMessagesPerMinute: 3,
      agentTimeoutMs: 60_000,
      agentMaxConcurrentRequests: 4,
      agentMaxConcurrentRequestsPerGuild: 2,
      logPrivacy: false,
      allowlistedServerIds: ["123456789012345678"],
      models: {
        agent: {
          provider: "openai",
          model: "gpt-5.6-terra",
          reasoningEffort: "low",
        },
        summarizer: {
          provider: "openai",
          model: "gpt-5.4-nano",
          reasoningEffort: "low",
        },
        web: {
          enabled: true,
          provider: "google",
          model: "gemini-2.5-flash",
        },
      },
      providers: {},
      updates: {
        enabled: true,
        githubRepo: "aripabot/aripa",
        autoInstall: {
          enabled: false,
          preset: "weekly-sunday-4am",
          cronExpression: "0 4 * * 0",
        },
      },
      memory: DEFAULT_RUNTIME_CONFIG.memory,
    });
  });
});

function tempConfigPath(name: string): string {
  return `${Bun.env.TMPDIR || "/tmp"}/aripa-${name}-${crypto.randomUUID()}.json`;
}
