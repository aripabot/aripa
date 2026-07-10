import { describe, expect, test } from "vitest";
import { ActiveMuteStore } from "@aripabot/core/moderation/active-mute-store.ts";
import { MuteService } from "@aripabot/core/moderation/mute-service.ts";

describe("MuteService", () => {
  test("re-applies a mute after an in-flight expiry without losing the new generation", async () => {
    const store = new ActiveMuteStore(":memory:");
    const service = new MuteService(store);
    const first = store.upsertRoleMute({
      guildId: "guild-1",
      userId: "user-1",
      muteRoleId: "role-1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expiryStarted = createDeferred();
    const releaseExpiry = createDeferred();
    const calls: string[] = [];

    try {
      const expiry = service.expireRoleMute({
        record: first,
        removeRole: async () => {
          calls.push("remove-old-role");
          expiryStarted.resolve();
          await releaseExpiry.promise;
        },
      });
      await expiryStarted.promise;
      const replacement = service.applyRoleMute({
        guildId: first.guildId,
        userId: first.userId,
        muteRoleId: first.muteRoleId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        addRole: async () => {
          calls.push("add-new-role");
        },
        schedule: async () => {},
        rollbackNewRole: async () => {},
      });

      releaseExpiry.resolve();
      await Promise.all([expiry, replacement]);

      expect(calls).toEqual(["remove-old-role", "add-new-role"]);
      expect(store.get(first.guildId, first.userId)).toMatchObject({
        generation: first.generation + 1,
        expiresAt: expect.any(String),
      });
    } finally {
      store.close();
    }
  });

  test("treats duplicate expiry delivery as stale after the first deletion", async () => {
    const store = new ActiveMuteStore(":memory:");
    const service = new MuteService(store);
    const record = store.upsertRoleMute({
      guildId: "guild-1",
      userId: "user-1",
      muteRoleId: "role-1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    let removed = 0;

    try {
      const outcomes = await Promise.all([
        service.expireRoleMute({ record, removeRole: async () => void removed++ }),
        service.expireRoleMute({ record, removeRole: async () => void removed++ }),
      ]);

      expect(outcomes).toEqual(["completed", "stale"]);
      expect(removed).toBe(1);
      expect(store.get(record.guildId, record.userId)).toBeNull();
    } finally {
      store.close();
    }
  });

  test("does not let a manual unmute repeat an in-flight expiry mutation", async () => {
    const store = new ActiveMuteStore(":memory:");
    const service = new MuteService(store);
    const record = store.upsertRoleMute({
      guildId: "guild-1",
      userId: "user-1",
      muteRoleId: "role-1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expiryStarted = createDeferred();
    const releaseExpiry = createDeferred();
    let removedByExpiry = 0;
    let removedByManualUnmute = 0;

    try {
      const expiry = service.expireRoleMute({
        record,
        removeRole: async () => {
          removedByExpiry++;
          expiryStarted.resolve();
          await releaseExpiry.promise;
        },
      });
      await expiryStarted.promise;
      const manualUnmute = service.removeRoleMute({
        record,
        removeRole: async () => {
          removedByManualUnmute++;
        },
        cancelTimer: () => {},
      });

      releaseExpiry.resolve();

      expect(await manualUnmute).toBe("stale");
      await expiry;
      expect(removedByExpiry).toBe(1);
      expect(removedByManualUnmute).toBe(0);
    } finally {
      store.close();
    }
  });
});

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
