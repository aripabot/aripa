import { describe, expect, test } from "vitest";

import { requestBotRuntimeConfigReload } from "@/server/bot-runtime-control";

describe("requestBotRuntimeConfigReload", () => {
  test("validates the bot pid before writing a restart marker", async () => {
    const events: string[] = [];

    await expect(
      requestBotRuntimeConfigReload({
        isInsideDocker: () => true,
        readPid: async () => "not-a-pid",
        writeRestartMarker: async () => {
          events.push("marker");
        },
      }),
    ).rejects.toThrow("Bot process id is unavailable.");

    expect(events).toEqual([]);
  });

  test("removes the restart marker when signaling the bot fails", async () => {
    const events: string[] = [];

    await expect(
      requestBotRuntimeConfigReload({
        isInsideDocker: () => true,
        readPid: async () => "42",
        writeRestartMarker: async () => {
          events.push("marker");
        },
        removeRestartMarker: async () => {
          events.push("remove-marker");
        },
        signalProcess: () => {
          throw new Error("signal failed");
        },
      }),
    ).rejects.toThrow("signal failed");

    expect(events).toEqual(["marker", "remove-marker"]);
  });
});
