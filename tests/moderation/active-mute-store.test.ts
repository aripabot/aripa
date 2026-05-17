import { describe, expect, test } from "vitest";
import { ActiveMuteStore } from "@/moderation/active-mute-store.ts";

describe("ActiveMuteStore", () => {
  test("stores and deletes role mutes", () => {
    const store = new ActiveMuteStore(":memory:");

    try {
      const record = store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: null,
      });

      expect(record).toMatchObject({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: null,
      });
      expect(store.get("guild-1", "user-1")).toMatchObject({
        muteRoleId: "role-1",
      });

      store.delete("guild-1", "user-1");
      expect(store.get("guild-1", "user-1")).toBeNull();
    } finally {
      store.close();
    }
  });
});
