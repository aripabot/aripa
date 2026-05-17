import { findFlagTokenIndex, type CommandToken } from "@/commands/command-tokenizer.ts";

export type Snowflake = string;

export interface ResolverError {
  code: string;
  message: string;
}

export type ResolverResult<T> = { ok: true; value: T } | { ok: false; error: ResolverError };

export interface UserReference {
  id: Snowflake;
  raw: string;
  kind: "snowflake" | "mention";
}

export interface ChannelReference {
  id: Snowflake;
  raw: string;
  kind: "snowflake" | "mention";
}

export interface RoleReference {
  id: Snowflake;
  raw: string;
  kind: "snowflake" | "mention";
}

export interface EmojiReference {
  raw: string;
  id?: Snowflake;
  name: string;
  animated: boolean;
  kind: "custom" | "unicode-or-named";
}

export interface DurationValue {
  raw: string;
  milliseconds: number;
  seconds: number;
}

export interface DurationResolverOptions {
  defaultUnit?: DurationUnit | null;
  minMs?: number;
  maxMs?: number;
}

export type DurationUnit = "milliseconds" | "seconds" | "minutes" | "hours" | "days" | "weeks";

const SNOWFLAKE_PATTERN = /^\d{15,25}$/;
const USER_MENTION_PATTERN = /^<@!?(\d{15,25})>$/;
const CHANNEL_MENTION_PATTERN = /^<#(\d{15,25})>$/;
const ROLE_MENTION_PATTERN = /^<@&(\d{15,25})>$/;
const CUSTOM_EMOJI_PATTERN = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/;
const NAMED_EMOJI_PATTERN = /^:([A-Za-z0-9_+-]{1,64}):$/;

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

const DEFAULT_DURATION_UNIT: DurationUnit = "seconds";

export function resolveUserReference(raw: string): ResolverResult<UserReference> {
  const mention = USER_MENTION_PATTERN.exec(raw);

  if (mention?.[1]) {
    return { ok: true, value: { id: mention[1], raw, kind: "mention" } };
  }

  return resolveSnowflake(raw).ok
    ? { ok: true, value: { id: raw, raw, kind: "snowflake" } }
    : resolverError("invalid_user", `Expected a user mention or ID, got "${raw}".`);
}

export function resolveChannelReference(raw: string): ResolverResult<ChannelReference> {
  const mention = CHANNEL_MENTION_PATTERN.exec(raw);

  if (mention?.[1]) {
    return { ok: true, value: { id: mention[1], raw, kind: "mention" } };
  }

  return resolveSnowflake(raw).ok
    ? { ok: true, value: { id: raw, raw, kind: "snowflake" } }
    : resolverError("invalid_channel", `Expected a channel mention or ID, got "${raw}".`);
}

export function resolveRoleReference(raw: string): ResolverResult<RoleReference> {
  const mention = ROLE_MENTION_PATTERN.exec(raw);

  if (mention?.[1]) {
    return { ok: true, value: { id: mention[1], raw, kind: "mention" } };
  }

  return resolveSnowflake(raw).ok
    ? { ok: true, value: { id: raw, raw, kind: "snowflake" } }
    : resolverError("invalid_role", `Expected a role mention or ID, got "${raw}".`);
}

export function resolveEmojiReference(raw: string): ResolverResult<EmojiReference> {
  const custom = CUSTOM_EMOJI_PATTERN.exec(raw);

  if (custom?.[2] && custom[3]) {
    return {
      ok: true,
      value: {
        raw,
        id: custom[3],
        name: custom[2],
        animated: custom[1] === "a",
        kind: "custom",
      },
    };
  }

  const named = NAMED_EMOJI_PATTERN.exec(raw);

  if (named?.[1]) {
    return {
      ok: true,
      value: {
        raw,
        name: named[1],
        animated: false,
        kind: "unicode-or-named",
      },
    };
  }

  return resolverError("invalid_emoji", `Expected an emoji, got "${raw}".`);
}

export function resolveSnowflake(raw: string): ResolverResult<Snowflake> {
  if (SNOWFLAKE_PATTERN.test(raw)) {
    return { ok: true, value: raw };
  }

  return resolverError("invalid_snowflake", `Expected a Discord snowflake, got "${raw}".`);
}

export function resolveMessageId(raw: string): ResolverResult<Snowflake> {
  const snowflake = resolveSnowflake(raw);

  return snowflake.ok
    ? snowflake
    : resolverError("invalid_message_id", `Expected a message ID, got "${raw}".`);
}

export function resolveInfractionId(
  raw: string,
  options: { allowMyLast?: boolean } = {},
): ResolverResult<number | "ml"> {
  if (options.allowMyLast && raw.toLowerCase() === "ml") {
    return { ok: true, value: "ml" };
  }

  return resolveInteger(raw, { min: 1, label: "infraction ID" });
}

export function resolveCount(
  raw: string | undefined,
  options: { defaultValue?: number; min?: number; max?: number; label?: string } = {},
): ResolverResult<number> {
  if (raw === undefined || raw.trim() === "") {
    if (options.defaultValue !== undefined) {
      return { ok: true, value: options.defaultValue };
    }

    return resolverError("missing_count", `Expected ${options.label ?? "count"}.`);
  }

  return resolveInteger(raw, {
    min: options.min ?? 1,
    max: options.max,
    label: options.label ?? "count",
  });
}

export function resolveDuration(
  raw: string,
  options: DurationResolverOptions = {},
): ResolverResult<DurationValue> {
  const trimmed = raw.trim().toLowerCase();

  if (!trimmed) {
    return resolverError("missing_duration", "Expected a duration.");
  }

  const defaultUnit =
    options.defaultUnit === undefined ? DEFAULT_DURATION_UNIT : options.defaultUnit;
  const milliseconds = /^\d+$/.test(trimmed)
    ? resolveBareDuration(trimmed, defaultUnit)
    : resolveCompoundDuration(trimmed);

  if (milliseconds === null) {
    return resolverError("invalid_duration", `Expected a duration, got "${raw}".`);
  }

  if (options.minMs !== undefined && milliseconds < options.minMs) {
    return resolverError("duration_too_short", `Duration must be at least ${options.minMs}ms.`);
  }

  if (options.maxMs !== undefined && milliseconds > options.maxMs) {
    return resolverError("duration_too_long", `Duration must be at most ${options.maxMs}ms.`);
  }

  return {
    ok: true,
    value: {
      raw,
      milliseconds,
      seconds: Math.ceil(milliseconds / 1_000),
    },
  };
}

export function resolveReasonTail(
  rawTail: string,
  options: { required?: boolean; defaultReason?: string } = {},
): ResolverResult<string | null> {
  const reason = rawTail.trim();

  if (reason) {
    return { ok: true, value: reason };
  }

  if (options.required) {
    return resolverError("missing_reason", "Expected a reason.");
  }

  return { ok: true, value: options.defaultReason ?? null };
}

export function resolveFlaggedReason(
  input: string,
  tokens: readonly CommandToken[],
  flag = "-r",
): ResolverResult<string | null> {
  const flagIndex = findFlagTokenIndex(tokens, flag);

  if (flagIndex === -1) {
    return { ok: true, value: null };
  }

  const reason = tokens
    .slice(flagIndex + 1)
    .map((token) => token.value)
    .join(" ")
    .trim();

  return resolveReasonTail(reason);
}

export function tokensBeforeFlag(tokens: readonly CommandToken[], flag = "-r"): CommandToken[] {
  const index = tokens.findIndex((token) => token.value === flag);
  return index === -1 ? [...tokens] : tokens.slice(0, index);
}

function resolveInteger(
  raw: string,
  options: { min?: number; max?: number; label: string },
): ResolverResult<number> {
  if (!/^\d+$/.test(raw)) {
    return resolverError("invalid_integer", `Expected ${options.label}, got "${raw}".`);
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value)) {
    return resolverError("integer_too_large", `${options.label} is too large.`);
  }

  if (options.min !== undefined && value < options.min) {
    return resolverError("integer_too_small", `${options.label} must be at least ${options.min}.`);
  }

  if (options.max !== undefined && value > options.max) {
    return resolverError("integer_too_large", `${options.label} must be at most ${options.max}.`);
  }

  return { ok: true, value };
}

function resolveBareDuration(raw: string, defaultUnit: DurationUnit | null): number | null {
  if (!defaultUnit) {
    return null;
  }

  const multiplier = DURATION_UNITS[defaultUnit];
  const value = Number(raw);

  if (!multiplier || !Number.isSafeInteger(value)) {
    return null;
  }

  return value * multiplier;
}

function resolveCompoundDuration(raw: string): number | null {
  const partPattern = /(\d+)([a-z]+)/g;
  let total = 0;
  let consumed = "";

  for (const match of raw.matchAll(partPattern)) {
    const [part, amount, unit] = match;
    const multiplier = unit ? DURATION_UNITS[unit] : undefined;

    if (!amount || !multiplier) {
      return null;
    }

    const value = Number(amount);

    if (!Number.isSafeInteger(value)) {
      return null;
    }

    total += value * multiplier;
    consumed += part;
  }

  return consumed === raw && total > 0 ? total : null;
}

function resolverError<T = never>(code: string, message: string): ResolverResult<T> {
  return { ok: false, error: { code, message } };
}
