import { describe, expect, test } from "vitest";
import {
  formatModerationResultForAgent,
  formatModerationResultForUser,
  moderationFailure,
  moderationSuccess,
} from "@/moderation/moderation-result.ts";

describe("moderation results", () => {
  test("formats user-facing success results", () => {
    const result = moderationSuccess({
      action: "tempban",
      message: "Temporary ban applied.",
      target: { id: "123456789012345678", label: "@user" },
      durationMs: 3_600_000,
      reason: "spam",
    });

    expect(formatModerationResultForUser(result)).toBe(
      "Temporary ban applied.\nTarget: @user (123456789012345678)\nDuration: 1h\nReason: spam",
    );
  });

  test("serializes agent-facing results as structured JSON", () => {
    const result = moderationFailure({
      action: "ban",
      message: "Ban failed.",
      errors: ["Missing permissions"],
    });

    expect(JSON.parse(formatModerationResultForAgent(result))).toEqual({
      type: "moderation_result",
      action: "ban",
      ok: false,
      status: "failed",
      message: "Ban failed.",
      errors: ["Missing permissions"],
    });
  });
});
