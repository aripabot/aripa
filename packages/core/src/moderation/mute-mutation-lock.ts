import { KeyedMutex } from "@aripabot/core/shared/keyed-mutex.ts";

export const muteMutationLock = new KeyedMutex();

export function muteMutationKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}
