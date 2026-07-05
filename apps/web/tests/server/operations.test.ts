import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { cloneDefaultRuntimeConfig } from "@aripabot/core/config/runtime-config.ts";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { ActiveMuteStore } from "@aripabot/core/moderation/active-mute-store.ts";
import { getDashboardOperations } from "@/server/operations";

describe("dashboard operations", () => {
  const previousToken = process.env.TOKEN;

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env.TOKEN;
    } else {
      process.env.TOKEN = previousToken;
    }
  });

  test("does not create a missing database while reading dashboard state", async () => {
    process.env.TOKEN = "";
    await withTempDatabase(async (databasePath) => {
      const config = cloneDefaultRuntimeConfig();
      const operations = await getDashboardOperations(config, databasePath);

      await expect(access(databasePath)).rejects.toThrow();
      expect(operations.totals).toMatchObject({
        guilds: 0,
        readyGuilds: 0,
        attentionGuilds: 0,
        activeMutes: 0,
        expiredMutes: 0,
        tags: 0,
      });
    });
  });

  test("reads existing guild config, tags, and active mutes", async () => {
    process.env.TOKEN = "";
    await withTempDatabase(async (databasePath) => {
      const guildConfigStore = new GuildConfigStore(databasePath);
      const activeMuteStore = new ActiveMuteStore(databasePath);

      try {
        guildConfigStore.setLogChannel("guild-1", "log-1");
        guildConfigStore.setModLogEnabled("guild-1", true);
        guildConfigStore.setMuteRole("guild-1", "role-1");
        guildConfigStore.upsertTag("guild-1", "rules", "Read the rules.");
        activeMuteStore.upsertRoleMute({
          guildId: "guild-1",
          userId: "user-1",
          muteRoleId: "role-1",
          expiresAt: "2025-01-01T00:00:00.000Z",
        });
      } finally {
        guildConfigStore.close();
        activeMuteStore.close();
      }

      const config = cloneDefaultRuntimeConfig();
      const operations = await getDashboardOperations(config, databasePath);

      expect(operations.totals).toMatchObject({
        guilds: 1,
        readyGuilds: 1,
        activeMutes: 1,
        tags: 1,
      });
      expect(operations.guilds[0]).toMatchObject({
        guildId: "guild-1",
        logChannelId: "log-1",
        modLogsEnabled: true,
        muteRoleId: "role-1",
        muteMode: "role",
        tagCount: 1,
        activeMuteCount: 1,
      });
      expect(operations.activeMutes[0]).toMatchObject({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        status: "expired",
      });
    });
  });
});

async function withTempDatabase(run: (databasePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "aripa-operations-test-"));

  try {
    await run(join(directory, "aripa.sqlite"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
