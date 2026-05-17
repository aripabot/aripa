import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@/config/guild-config-store.ts";

describe("GuildConfigStore", () => {
  test("stores and updates a guild log channel without enabling logs", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const created = store.setLogChannel("guild-1", "111111111111111111");

      expect(created).toMatchObject({
        guildId: "guild-1",
        logChannelId: "111111111111111111",
        modLogsEnabled: false,
      });
      expect(store.getLogChannelId("guild-1")).toBe("111111111111111111");
      expect(store.isModLogEnabled("guild-1")).toBe(false);

      const updated = store.setLogChannel("guild-1", "222222222222222222");

      expect(updated).toMatchObject({
        guildId: "guild-1",
        logChannelId: "222222222222222222",
        modLogsEnabled: false,
      });
      expect(store.getLogChannelId("guild-1")).toBe("222222222222222222");
    } finally {
      store.close();
    }
  });

  test("enables and disables guild mod logs", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel("guild-1", "111111111111111111");

      expect(store.setModLogEnabled("guild-1", true)).toMatchObject({
        logChannelId: "111111111111111111",
        modLogsEnabled: true,
      });
      expect(store.isModLogEnabled("guild-1")).toBe(true);

      expect(store.setModLogEnabled("guild-1", false)).toMatchObject({
        logChannelId: "111111111111111111",
        modLogsEnabled: false,
      });
      expect(store.isModLogEnabled("guild-1")).toBe(false);
    } finally {
      store.close();
    }
  });

  test("clearing a log channel also disables logs", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel("guild-1", "111111111111111111");
      store.setModLogEnabled("guild-1", true);

      expect(store.setLogChannel("guild-1", null)).toMatchObject({
        logChannelId: null,
        modLogsEnabled: false,
      });
    } finally {
      store.close();
    }
  });

  test("stores a guild ban message", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      expect(store.setBanMessage("guild-1", "You are banned.")).toMatchObject({
        banMessage: "You are banned.",
      });
      expect(store.getBanMessage("guild-1")).toBe("You are banned.");
      expect(store.setBanMessage("guild-1", null)).toMatchObject({
        banMessage: null,
      });
      expect(store.getBanMessage("guild-1")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("stores mute role and timeout configuration", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      expect(store.setMuteRole("guild-1", "333333333333333333")).toMatchObject({
        muteRoleId: "333333333333333333",
        muteMode: "role",
      });
      expect(store.getMuteRoleId("guild-1")).toBe("333333333333333333");
      expect(store.getMuteMode("guild-1")).toBe("role");

      expect(store.setMuteMode("guild-1", "timeout")).toMatchObject({
        muteRoleId: null,
        muteMode: "timeout",
      });
      expect(store.getMuteRoleId("guild-1")).toBeNull();
      expect(store.getMuteMode("guild-1")).toBe("timeout");

      expect(store.setMuteMode("guild-1", "none")).toMatchObject({
        muteRoleId: null,
        muteMode: "none",
      });
      expect(store.getMuteMode("guild-1")).toBe("none");
    } finally {
      store.close();
    }
  });

  test("stores, lists, and removes guild tags", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      expect(store.upsertTag("guild-1", "Politics", "No politics here.")).toMatchObject({
        guildId: "guild-1",
        name: "politics",
        content: "No politics here.",
      });

      expect(store.getTag("guild-1", "POLITICS")).toMatchObject({
        name: "politics",
        content: "No politics here.",
      });

      expect(store.listTags("guild-1")).toHaveLength(1);
      expect(store.deleteTag("guild-1", "politics")).toBe(true);
      expect(store.getTag("guild-1", "politics")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("returns null when a guild has no stored config", () => {
    const store = new GuildConfigStore(":memory:");

    try {
      expect(store.getGuildConfig("missing-guild")).toBeNull();
      expect(store.getLogChannelId("missing-guild")).toBeNull();
      expect(store.isModLogEnabled("missing-guild")).toBe(false);
      expect(store.getBanMessage("missing-guild")).toBeNull();
      expect(store.getMuteRoleId("missing-guild")).toBeNull();
      expect(store.getMuteMode("missing-guild")).toBe("none");
      expect(store.listTags("missing-guild")).toEqual([]);
      expect(store.getTag("missing-guild", "missing")).toBeNull();
    } finally {
      store.close();
    }
  });
});
