import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { readConfig, saveConfig } from "@/server/config-service";
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
