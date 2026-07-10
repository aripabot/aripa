import { describe, expect, test } from "vitest";

import { KeyedMutex } from "@aripabot/core/shared/keyed-mutex.ts";

describe("KeyedMutex", () => {
  test("serializes matching keys without blocking other keys", async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = mutex.run("guild:user", async () => {
      events.push("first-start");
      await gate;
      events.push("first-end");
    });
    const second = mutex.run("guild:user", async () => events.push("second"));
    const other = mutex.run("guild:other", async () => events.push("other"));

    await Promise.resolve();
    expect(events).toEqual(["first-start", "other"]);
    release?.();
    await Promise.all([first, second, other]);
    expect(events).toEqual(["first-start", "other", "first-end", "second"]);
  });
});
