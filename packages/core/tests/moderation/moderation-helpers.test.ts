import { describe, expect, test } from "vitest";
import { parseTrailingDryRunFlag } from "@aripabot/core/moderation/moderation-helpers.ts";

describe("parseTrailingDryRunFlag", () => {
  test.each(["--dry-run", "--dryrun", "-d"])("accepts %s as a trailing dry-run flag", (flag) => {
    expect(parseTrailingDryRunFlag(["target", "reason", flag])).toEqual({
      args: ["target", "reason"],
      dryRun: true,
    });
  });

  test("leaves arguments unchanged when no trailing dry-run flag is present", () => {
    expect(parseTrailingDryRunFlag(["target", "reason"])).toEqual({
      args: ["target", "reason"],
      dryRun: false,
    });
  });
});
