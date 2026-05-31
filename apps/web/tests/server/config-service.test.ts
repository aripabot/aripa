import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import { parseLogLine, readConfig, saveConfig } from "@/server/config-service";
import { cloneDefaultRuntimeConfig } from "@aripabot/core/config/config.ts";

describe("dashboard config service", () => {
  test("reads missing config files as runtime defaults", async () => {
    await withTempConfig(async (configPath) => {
      Bun.env.CONFIG_PATH = configPath;

      const result = await readConfig();

      expect(result.path).toBe(configPath);
      expect(result.config.name).toBe("Aripa");
      expect(result.config.allowlistedServerIds).toEqual([]);
    });
  });

  test("saves normalized config and preserves unknown keys", async () => {
    await withTempConfig(async (configPath) => {
      Bun.env.CONFIG_PATH = configPath;
      await Bun.write(
        configPath,
        `${JSON.stringify({
          futureFlag: true,
          name: "Old",
          allowlistedServerIds: ["12345678901234567"],
        })}\n`,
      );

      const config = cloneDefaultRuntimeConfig();
      config.name = "Dashboard";
      config.allowlistedServerIds = [];
      config.agentRateLimitMessagesPerMinute = null;

      const result = await saveConfig(config);
      const raw = (await Bun.file(configPath).json()) as Record<string, unknown>;

      expect(result.config.name).toBe("Dashboard");
      expect(result.config.allowlistedServerIds).toEqual([]);
      expect(result.config.agentRateLimitMessagesPerMinute).toBeNull();
      expect(raw.futureFlag).toBe(true);
    });
  });

  test("parses pino log lines into dashboard entries", () => {
    const entry = parseLogLine(
      JSON.stringify({
        level: 30,
        time: 1_735_689_600_000,
        msg: "Action requested.",
        metadata: { action: "ping" },
      }),
      { id: "docker:aripabot-docker", kind: "docker", name: "Docker" },
      0,
    );

    expect(entry.level).toBe("info");
    expect(entry.timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(entry.message).toBe("Action requested.");
    expect(entry.metadata).toEqual({ metadata: { action: "ping" } });
  });

  test("redacts sensitive log fields before returning entries", () => {
    const entry = parseLogLine(
      JSON.stringify({
        level: 50,
        msg: "Request failed with Bearer secret-token-value",
        metadata: {
          token: "secret-token-value",
          nested: { apiKey: "secret-api-key" },
        },
      }),
      { id: "file:/tmp/aripa.log", kind: "file", name: "aripa.log" },
      1,
    );

    expect(entry.message).toContain("Bearer [redacted]");
    expect(entry.raw).not.toContain("secret-token-value");
    expect(entry.metadata).toEqual({
      metadata: {
        token: "[redacted]",
        nested: { apiKey: "[redacted]" },
      },
    });
  });
});

async function withTempConfig(run: (configPath: string) => Promise<void>): Promise<void> {
  const previousConfigPath = Bun.env.CONFIG_PATH;
  const directory = await mkdtemp(join(tmpdir(), "aripa-web-test-"));
  const configPath = join(directory, "config.json");

  try {
    await run(configPath);
  } finally {
    if (previousConfigPath === undefined) {
      delete Bun.env.CONFIG_PATH;
    } else {
      Bun.env.CONFIG_PATH = previousConfigPath;
    }

    await rm(directory, { recursive: true, force: true });
  }
}
