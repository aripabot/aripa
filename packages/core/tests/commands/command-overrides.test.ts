import { describe, expect, test } from "vitest";
import {
  COMMAND_LEVELS,
  commandIdentityFromPath,
  evaluateCommandAccess,
} from "@aripabot/core/commands/command-overrides.ts";

describe("evaluateCommandAccess", () => {
  test("applies name overrides before group and plugin overrides", () => {
    const decision = evaluateCommandAccess({
      identity: { name: "mute", group: "mute", pluginName: "infractions" },
      defaultLevel: COMMAND_LEVELS.moderator,
      subject: { level: 35, roleIds: [] },
      overrides: [
        { pluginName: "infractions", out: { level: 10 } },
        { group: "mute", out: { level: 40 } },
        { name: "mute", out: { level: 30 } },
      ],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiredLevel).toBe(30);
  });

  test("denies disabled commands", () => {
    const decision = evaluateCommandAccess({
      identity: { name: "ban", group: "ban", pluginName: "infractions" },
      defaultLevel: COMMAND_LEVELS.moderator,
      subject: { level: COMMAND_LEVELS.administrator, roleIds: [] },
      overrides: [{ name: "ban", out: { disabled: true } }],
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) {
      throw new Error("Expected command to be denied.");
    }

    expect(decision.reason).toBe("disabled");
  });

  test("lets override roles satisfy a level requirement", () => {
    const decision = evaluateCommandAccess({
      identity: { name: "clean all", group: "clean", pluginName: "admin" },
      defaultLevel: COMMAND_LEVELS.moderator,
      subject: { level: COMMAND_LEVELS.default, roleIds: ["clean-role"] },
      overrides: [
        { group: "clean", out: { level: COMMAND_LEVELS.moderator, roles: ["clean-role"] } },
      ],
    });

    expect(decision.allowed).toBe(true);
  });

  test("enforces lockdown allowlists and denylists", () => {
    const allowed = evaluateCommandAccess({
      identity: { name: "clean all", group: "clean", pluginName: "admin" },
      defaultLevel: COMMAND_LEVELS.moderator,
      subject: { level: COMMAND_LEVELS.moderator, roleIds: ["mod"], channelId: "staff" },
      lockdowns: [{ group: "clean", out: { channels: ["staff"], roles: ["mod"] } }],
    });

    expect(allowed.allowed).toBe(true);

    const denied = evaluateCommandAccess({
      identity: { name: "clean all", group: "clean", pluginName: "admin" },
      defaultLevel: COMMAND_LEVELS.moderator,
      subject: { level: COMMAND_LEVELS.moderator, roleIds: ["mod"], channelId: "staff" },
      lockdowns: [
        {
          group: "clean",
          out: { channels: ["staff"], roles: ["mod"], excludeChannels: ["staff"] },
        },
      ],
    });

    expect(denied.allowed).toBe(false);
    if (denied.allowed) {
      throw new Error("Expected command to be denied.");
    }

    expect(denied.reason).toBe("channel");
  });
});

describe("commandIdentityFromPath", () => {
  test("creates normalized command identity from route path", () => {
    expect(commandIdentityFromPath(["Inf", "Search"], "infractions")).toEqual({
      name: "inf search",
      group: "inf",
      pluginName: "infractions",
    });
  });
});
