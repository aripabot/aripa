export type CommandQuote = "single" | "double";

export interface CommandToken {
  value: string;
  raw: string;
  start: number;
  end: number;
  quote: CommandQuote | null;
}

export interface CommandTokenizationError {
  code: "unterminated_quote";
  message: string;
  quote: CommandQuote;
  position: number;
}

export type CommandTokenizationResult =
  | { ok: true; tokens: CommandToken[] }
  | { ok: false; tokens: CommandToken[]; error: CommandTokenizationError };

export interface ParsedPrefixedCommand {
  name: string;
  args: string[];
  rawArgs: string;
  input: string;
  tokens: CommandToken[];
}

export type ParsePrefixedCommandResult =
  | { ok: true; command: ParsedPrefixedCommand }
  | { ok: false; error: CommandTokenizationError }
  | null;

const QUOTES = {
  "'": "single",
  '"': "double",
} as const;

export function tokenizeCommandInput(input: string): CommandTokenizationResult {
  const tokens: CommandToken[] = [];
  let index = 0;

  while (index < input.length) {
    while (index < input.length && isWhitespace(input[index])) {
      index += 1;
    }

    if (index >= input.length) {
      break;
    }

    const tokenStart = index;
    let value = "";
    let quote: CommandQuote | null = null;
    let activeQuote: CommandQuote | null = null;
    let activeQuoteChar: keyof typeof QUOTES | null = null;
    let activeQuotePosition = -1;

    while (index < input.length) {
      const char = input[index];

      if (!activeQuote && isWhitespace(char)) {
        break;
      }

      if (char === "\\" && index + 1 < input.length) {
        value += input[index + 1];
        index += 2;
        continue;
      }

      if (activeQuote) {
        if (char === activeQuoteChar) {
          activeQuote = null;
          activeQuoteChar = null;
          index += 1;
          continue;
        }

        value += char;
        index += 1;
        continue;
      }

      if (isQuote(char)) {
        const nextQuote = QUOTES[char];
        quote ??= nextQuote;
        activeQuote = nextQuote;
        activeQuoteChar = char;
        activeQuotePosition = index;
        index += 1;
        continue;
      }

      value += char;
      index += 1;
    }

    if (activeQuote) {
      return {
        ok: false,
        tokens,
        error: {
          code: "unterminated_quote",
          message: `Unterminated ${activeQuote} quote.`,
          quote: activeQuote,
          position: activeQuotePosition,
        },
      };
    }

    tokens.push({
      value,
      raw: input.slice(tokenStart, index),
      start: tokenStart,
      end: index,
      quote,
    });
  }

  return { ok: true, tokens };
}

export function parsePrefixedCommand(content: string, prefix: string): ParsePrefixedCommandResult {
  if (!content.startsWith(prefix)) {
    return null;
  }

  const input = content.slice(prefix.length).trim();

  if (!input) {
    return null;
  }

  const tokenized = tokenizeCommandInput(input);

  if (!tokenized.ok) {
    return { ok: false, error: tokenized.error };
  }

  const [nameToken, ...argTokens] = tokenized.tokens;

  if (!nameToken) {
    return null;
  }

  return {
    ok: true,
    command: {
      name: nameToken.value,
      args: argTokens.map((token) => token.value),
      rawArgs: getRawTailAfterToken(input, tokenized.tokens, 0),
      input,
      tokens: tokenized.tokens,
    },
  };
}

export function getRawTailAfterToken(
  input: string,
  tokens: readonly CommandToken[],
  tokenIndex: number,
): string {
  const token = tokens[tokenIndex];

  if (!token) {
    return input.trim();
  }

  return input.slice(token.end).trimStart();
}

export function findFlagTokenIndex(tokens: readonly CommandToken[], flag: string): number {
  return tokens.findIndex((token) => token.value === flag);
}

export function getRawTailAfterFlag(
  input: string,
  tokens: readonly CommandToken[],
  flag: string,
): string | null {
  const flagIndex = findFlagTokenIndex(tokens, flag);

  if (flagIndex === -1) {
    return null;
  }

  return getRawTailAfterToken(input, tokens, flagIndex);
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

function isQuote(char: string | undefined): char is keyof typeof QUOTES {
  return char === "'" || char === '"';
}
