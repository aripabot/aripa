import { describe, expect, test } from "vitest";

import { ConfigMutationCoordinator } from "@aripabot/core/config/config-mutation-coordinator.ts";

describe("ConfigMutationCoordinator", () => {
  test("serializes overlapping mutations and releases after failure", async () => {
    const coordinator = new ConfigMutationCoordinator();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.run(async () => {
      events.push("first-start");
      await firstCanFinish;
      events.push("first-end");
    });
    const second = coordinator.run(async () => {
      events.push("second-start");
      throw new Error("second failed");
    });
    const third = coordinator.run(async () => {
      events.push("third-start");
      return "done";
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);

    releaseFirst?.();

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow("second failed");
    await expect(third).resolves.toBe("done");
    expect(events).toEqual(["first-start", "first-end", "second-start", "third-start"]);
  });
});
