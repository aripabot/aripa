const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseAllowlistedServerIds(input: string): string[] {
  const ids = input
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [...new Set(ids)];
}

export function validateAllowlistedServerIds(ids: readonly string[]): string | null {
  if (ids.length === 0) {
    return "Enter at least one Discord server ID.";
  }

  const invalidId = ids.find((id) => !DISCORD_SNOWFLAKE_PATTERN.test(id));
  if (invalidId) {
    return `Server ID "${invalidId}" should be a Discord snowflake with 17-20 digits.`;
  }

  return null;
}

export function validateOperatorUserId(operatorUserId: string | null): string | null {
  if (operatorUserId === null) {
    return null;
  }

  if (!DISCORD_SNOWFLAKE_PATTERN.test(operatorUserId)) {
    return "Operator user ID should be a Discord snowflake with 17-20 digits, or blank.";
  }

  return null;
}

export function validateAgentRateLimitMessagesPerMinute(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    return "Agent rate limit must be a whole number greater than 0, or off.";
  }

  return null;
}

export function validateGitHubRepo(value: string): string | null {
  if (!GITHUB_REPO_PATTERN.test(value.trim())) {
    return "GitHub update repository must use owner/repo format.";
  }

  return null;
}

export function parseAgentRateLimitInput(input: string): number | null | "invalid" {
  const normalizedInput = input.trim().toLowerCase();

  if (
    normalizedInput === "off" ||
    normalizedInput === "none" ||
    normalizedInput === "disabled" ||
    normalizedInput === "0"
  ) {
    return null;
  }

  if (!/^\d+$/.test(normalizedInput)) {
    return "invalid";
  }

  const parsed = Number(normalizedInput);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "invalid";
}
