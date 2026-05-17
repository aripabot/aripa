import { describe, expect, test } from "vitest";
import {
  getRawTailAfterFlag,
  getRawTailAfterToken,
  parsePrefixedCommand,
  tokenizeCommandInput,
} from "@/commands/command-tokenizer.ts";

describe("tokenizeCommandInput", () => {
  test("splits whitespace-delimited tokens", () => {
    const result = tokenizeCommandInput("ban 123 spamming");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.tokens.map((token) => token.value)).toEqual(["ban", "123", "spamming"]);
  });

  test("preserves quoted phrases as a single token", () => {
    const result = tokenizeCommandInput("mban 111 222 -r 'bad boys'");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.tokens.map((token) => token.value)).toEqual([
      "mban",
      "111",
      "222",
      "-r",
      "bad boys",
    ]);
    expect(result.tokens[4]?.quote).toBe("single");
  });

  test("reports unterminated quotes", () => {
    const result = tokenizeCommandInput("ban 123 'unfinished reason");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected tokenization to fail.");
    }

    expect(result.error.code).toBe("unterminated_quote");
  });
});

describe("parsePrefixedCommand", () => {
  test("returns the action name, args, and raw args", () => {
    const result = parsePrefixedCommand("-ban 123 repeated spam", "-");

    expect(result?.ok).toBe(true);
    if (!result || !result.ok) {
      throw new Error("Expected command to parse.");
    }

    expect(result.command.name).toBe("ban");
    expect(result.command.args).toEqual(["123", "repeated", "spam"]);
    expect(result.command.rawArgs).toBe("123 repeated spam");
  });

  test("returns null when the prefix is absent", () => {
    expect(parsePrefixedCommand("ban 123", "-")).toBeNull();
  });
});

describe("tail helpers", () => {
  test("captures the raw tail after a token", () => {
    const input = "tempban 123 5h repeated spam";
    const result = tokenizeCommandInput(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(getRawTailAfterToken(input, result.tokens, 2)).toBe("repeated spam");
  });

  test("captures the raw tail after a flag", () => {
    const input = "mban 111 222 -r 'bad boys'";
    const result = tokenizeCommandInput(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(getRawTailAfterFlag(input, result.tokens, "-r")).toBe("'bad boys'");
  });
});
