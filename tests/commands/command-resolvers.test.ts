import { describe, expect, test } from "vitest";
import {
  resolveChannelReference,
  resolveCount,
  resolveDuration,
  resolveFlaggedReason,
  resolveInfractionId,
  resolveRoleReference,
  resolveUserReference,
  tokensBeforeFlag,
} from "@/commands/command-resolvers.ts";
import { tokenizeCommandInput } from "@/commands/command-tokenizer.ts";

describe("reference resolvers", () => {
  test("resolves common Discord references", () => {
    expect(resolveUserReference("<@123456789012345678>")).toEqual({
      ok: true,
      value: { id: "123456789012345678", raw: "<@123456789012345678>", kind: "mention" },
    });
    expect(resolveChannelReference("<#123456789012345678>")).toEqual({
      ok: true,
      value: { id: "123456789012345678", raw: "<#123456789012345678>", kind: "mention" },
    });
    expect(resolveRoleReference("<@&123456789012345678>")).toEqual({
      ok: true,
      value: { id: "123456789012345678", raw: "<@&123456789012345678>", kind: "mention" },
    });
  });
});

describe("duration and count resolvers", () => {
  test("resolves compact durations", () => {
    expect(resolveDuration("2h5m")).toEqual({
      ok: true,
      value: {
        raw: "2h5m",
        milliseconds: 7_500_000,
        seconds: 7_500,
      },
    });
  });

  test("uses command-specific default units for bare durations", () => {
    expect(resolveDuration("3", { defaultUnit: "days" })).toEqual({
      ok: true,
      value: {
        raw: "3",
        milliseconds: 259_200_000,
        seconds: 259_200,
      },
    });
  });

  test("resolves counts with defaults and bounds", () => {
    expect(resolveCount(undefined, { defaultValue: 25 })).toEqual({ ok: true, value: 25 });
    expect(resolveCount("8", { max: 10 })).toEqual({ ok: true, value: 8 });
    expect(resolveCount("11", { max: 10 }).ok).toBe(false);
  });
});

describe("infraction and reason resolvers", () => {
  test("allows ml as an infraction id when requested", () => {
    expect(resolveInfractionId("ml", { allowMyLast: true })).toEqual({ ok: true, value: "ml" });
    expect(resolveInfractionId("ml").ok).toBe(false);
  });

  test("extracts multi-user flagged reasons", () => {
    const input = "111 222 -r 'bad boys'";
    const tokenized = tokenizeCommandInput(input);

    expect(tokenized.ok).toBe(true);
    if (!tokenized.ok) {
      throw new Error(tokenized.error.message);
    }

    expect(tokensBeforeFlag(tokenized.tokens, "-r").map((token) => token.value)).toEqual([
      "111",
      "222",
    ]);
    expect(resolveFlaggedReason(input, tokenized.tokens, "-r")).toEqual({
      ok: true,
      value: "bad boys",
    });
  });
});
