import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { completeOnboarding, readConfig, saveConfig } from "@/server/config-store";
import { cloneDefaultRuntimeConfig } from "@aripabot/core/config/config.ts";

describe("dashboard config store", () => {
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

      const result = await saveConfig(config, successfulMutationDependencies());
      const raw = (await Bun.file(configPath).json()) as Record<string, unknown>;

      expect(result.exists).toBe(true);
      expect(result.config.name).toBe("Dashboard");
      expect(result.config.allowlistedServerIds).toEqual([]);
      expect(result.config.agentRateLimitMessagesPerMinute).toBeNull();
      expect(raw.futureFlag).toBe(true);
    });
  });

  test("restores config and crontab when cron synchronization fails", async () => {
    await withTempConfig(async (configPath) => {
      Bun.env.CONFIG_PATH = configPath;
      const originalCron = "MAILTO=ops@example.com\n";
      const crontabWrites: string[] = [];

      await expect(
        completeOnboarding(
          {
            allowlistedServerIds: ["123456789012345678"],
            updates: {
              enabled: true,
              githubRepo: "aripabot/aripa",
              autoInstall: {
                enabled: true,
                preset: "weekly-sunday-4am",
                cronExpression: "0 4 * * 0",
              },
            },
          },
          {
            readCrontab: async () => originalCron,
            writeCrontab: async (content) => {
              crontabWrites.push(content);
              if (crontabWrites.length === 1) {
                throw new Error("crontab failed");
              }
            },
            requestReload: async () => undefined,
          },
        ),
      ).rejects.toThrow("crontab failed");

      await expect(Bun.file(configPath).exists()).resolves.toBe(false);
      expect(crontabWrites).toEqual([
        expect.stringContaining("BEGIN ARIPA AUTO UPDATE"),
        originalCron,
      ]);
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

function successfulMutationDependencies() {
  return {
    readCrontab: async () => "",
    writeCrontab: async () => undefined,
    requestReload: async () => undefined,
  };
}
