import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import { parseLogLine, readConfig, readLocalLogs, saveConfig } from "@/server/config-service";
import { cloneDefaultRuntimeConfig } from "@aripabot/core/config/config.ts";

describe("dashboard config service", () => {
  test("reads missing config files as runtime defaults", async () => {
    await withTempConfig(async (configPath) => {
      Bun.env.CONFIG_PATH = configPath;

      const result = await readConfig();

      expect(result.path).toBe(configPath);
      expect(result.exists).toBe(false);
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

      expect(result.exists).toBe(true);
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

  test("reads current container logs when running inside Docker", async () => {
    const previousDockerRuntime = process.env.ARIPA_DOCKER_RUNTIME;
    const previousDockerLogPath = process.env.ARIPA_DOCKER_LOG_PATH;
    const directory = await mkdtemp(join(tmpdir(), "aripa-docker-log-test-"));
    const logPath = join(directory, "aripa-docker.log");

    try {
      process.env.ARIPA_DOCKER_RUNTIME = "1";
      process.env.ARIPA_DOCKER_LOG_PATH = logPath;
      await Bun.write(
        logPath,
        `${JSON.stringify({
          level: 30,
          time: 1_735_689_600_000,
          msg: "Container log line.",
        })}\n`,
      );

      const result = await readLocalLogs();
      const dockerSource = result.sources.find((source) => source.id === "docker:current");

      expect(dockerSource?.available).toBe(true);
      expect(result.entries.some((entry) => entry.message === "Container log line.")).toBe(true);
    } finally {
      if (previousDockerRuntime === undefined) {
        delete process.env.ARIPA_DOCKER_RUNTIME;
      } else {
        process.env.ARIPA_DOCKER_RUNTIME = previousDockerRuntime;
      }

      if (previousDockerLogPath === undefined) {
        delete process.env.ARIPA_DOCKER_LOG_PATH;
      } else {
        process.env.ARIPA_DOCKER_LOG_PATH = previousDockerLogPath;
      }

      await rm(directory, { recursive: true, force: true });
    }
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
