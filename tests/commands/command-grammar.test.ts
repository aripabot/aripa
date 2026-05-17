import { describe, expect, test } from "vitest";
import { defineCommandRoute, matchCommandRoute } from "@/commands/command-grammar.ts";
import { tokenizeCommandInput } from "@/commands/command-tokenizer.ts";

describe("command grammar", () => {
  test("matches the longest command route", () => {
    const input = "clean user 123 50";
    const tokenized = tokenizeCommandInput(input);

    expect(tokenized.ok).toBe(true);
    if (!tokenized.ok) {
      throw new Error(tokenized.error.message);
    }

    const match = matchCommandRoute(
      tokenized.tokens,
      [
        defineCommandRoute({ path: "clean" }),
        defineCommandRoute({ path: "clean user", pluginName: "admin" }),
      ],
      input,
    );

    expect(match?.route.name).toBe("clean user");
    expect(match?.argValues).toEqual(["123", "50"]);
    expect(match?.rawArgs).toBe("123 50");
  });

  test("matches aliases", () => {
    const input = "clear 20";
    const tokenized = tokenizeCommandInput(input);

    expect(tokenized.ok).toBe(true);
    if (!tokenized.ok) {
      throw new Error(tokenized.error.message);
    }

    const match = matchCommandRoute(
      tokenized.tokens,
      [defineCommandRoute({ path: "clean all", aliases: ["clear"] })],
      input,
    );

    expect(match?.route.name).toBe("clean all");
    expect(match?.usedAlias).toBe(true);
    expect(match?.argValues).toEqual(["20"]);
  });
});
