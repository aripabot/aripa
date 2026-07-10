import {
  ActiveMuteStore,
  type ActiveMuteRecord,
} from "@aripabot/core/moderation/active-mute-store.ts";
import { muteMutationKey, muteMutationLock } from "@aripabot/core/moderation/mute-mutation-lock.ts";

export class MuteService {
  constructor(private readonly store: ActiveMuteStore) {}

  async applyRoleMute(options: {
    guildId: string;
    userId: string;
    muteRoleId: string;
    expiresAt: string | null;
    addRole: () => Promise<void>;
    schedule: (record: ActiveMuteRecord) => Promise<void>;
    rollbackNewRole: () => Promise<void>;
  }): Promise<ActiveMuteRecord> {
    return muteMutationLock.run(muteMutationKey(options.guildId, options.userId), async () => {
      await options.addRole();
      let replacement: { previous: ActiveMuteRecord | null; record: ActiveMuteRecord } | null =
        null;

      try {
        replacement = this.store.upsertReturningPrevious(options);
        await options.schedule(replacement.record);
        return replacement.record;
      } catch (error) {
        if (replacement?.previous) {
          this.store.restore(replacement.previous);
          await options.schedule(replacement.previous);
        } else if (replacement) {
          this.store.deleteIfGeneration(
            replacement.record.guildId,
            replacement.record.userId,
            replacement.record.generation,
          );
          await options.rollbackNewRole();
        } else {
          await options.rollbackNewRole();
        }
        throw error;
      }
    });
  }

  async expireRoleMute(options: {
    record: ActiveMuteRecord;
    removeRole: () => Promise<void>;
  }): Promise<"completed" | "stale"> {
    return muteMutationLock.run(
      muteMutationKey(options.record.guildId, options.record.userId),
      async () => {
        if (!this.isCurrent(options.record)) {
          return "stale";
        }

        await options.removeRole();
        this.store.deleteIfGeneration(
          options.record.guildId,
          options.record.userId,
          options.record.generation,
        );
        return "completed";
      },
    );
  }

  async removeRoleMute(options: {
    record: ActiveMuteRecord;
    removeRole: () => Promise<void>;
    cancelTimer: () => void;
  }): Promise<"completed" | "stale"> {
    return muteMutationLock.run(
      muteMutationKey(options.record.guildId, options.record.userId),
      async () => {
        if (!this.isCurrent(options.record)) {
          return "stale";
        }

        await options.removeRole();
        this.store.deleteIfGeneration(
          options.record.guildId,
          options.record.userId,
          options.record.generation,
        );
        options.cancelTimer();
        return "completed";
      },
    );
  }

  async clearRoleMute(options: {
    record: ActiveMuteRecord;
    cancelTimer: () => void;
  }): Promise<"completed" | "stale"> {
    return muteMutationLock.run(
      muteMutationKey(options.record.guildId, options.record.userId),
      async () => {
        if (!this.isCurrent(options.record)) {
          return "stale";
        }

        this.store.deleteIfGeneration(
          options.record.guildId,
          options.record.userId,
          options.record.generation,
        );
        options.cancelTimer();
        return "completed";
      },
    );
  }

  private isCurrent(record: ActiveMuteRecord): boolean {
    return this.store.get(record.guildId, record.userId)?.generation === record.generation;
  }
}
