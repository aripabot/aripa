import {
  DEFAULT_RUNTIME_CONFIG,
  cloneRuntimeModelConfig,
  type RuntimeModelConfig,
  type RuntimeProviderConfig,
  type RuntimeUpdateConfig,
} from "@/config/config.ts";

export interface RuntimeOnboardingInput {
  name?: string;
  operatorUserId?: string | null;
  stylePrompt?: string;
  allowlistedServerIds: string[];
  agentRateLimitMessagesPerMinute?: number | null;
  logPrivacy?: boolean;
  models?: RuntimeModelConfig;
  providers?: RuntimeProviderConfig;
  updates?: RuntimeUpdateConfig;
}

export interface WriteRuntimeConfigOptions {
  pathOrUrl?: string | URL;
  input: RuntimeOnboardingInput;
  overwrite?: boolean;
}

export interface WriteRuntimeConfigResult {
  path: string;
  config: Record<string, unknown>;
  existed: boolean;
}

const DEFAULT_ONBOARDING_CONFIG = {
  name: DEFAULT_RUNTIME_CONFIG.name,
  operatorUserId: DEFAULT_RUNTIME_CONFIG.operatorUserId,
  stylePrompt: DEFAULT_RUNTIME_CONFIG.stylePrompt,
  agentRateLimitMessagesPerMinute: DEFAULT_RUNTIME_CONFIG.agentRateLimitMessagesPerMinute,
  logPrivacy: DEFAULT_RUNTIME_CONFIG.logPrivacy,
} as const;

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

export function buildRuntimeConfig(
  input: RuntimeOnboardingInput,
  baseConfig: Record<string, unknown> = {},
): Record<string, unknown> {
  const name = input.name?.trim() || DEFAULT_ONBOARDING_CONFIG.name;
  const operatorUserId = input.operatorUserId?.trim() || null;
  const stylePrompt = input.stylePrompt?.trim() || DEFAULT_ONBOARDING_CONFIG.stylePrompt;
  const allowlistedServerIds = [
    ...new Set(input.allowlistedServerIds.map((entry) => entry.trim()).filter(Boolean)),
  ];
  const agentRateLimitMessagesPerMinute =
    input.agentRateLimitMessagesPerMinute === undefined
      ? DEFAULT_ONBOARDING_CONFIG.agentRateLimitMessagesPerMinute
      : input.agentRateLimitMessagesPerMinute;
  const logPrivacy = input.logPrivacy ?? DEFAULT_ONBOARDING_CONFIG.logPrivacy;
  const updates = input.updates ?? DEFAULT_RUNTIME_CONFIG.updates;
  const githubRepo = updates.githubRepo.trim() || DEFAULT_RUNTIME_CONFIG.updates.githubRepo;
  const updateConfig: RuntimeUpdateConfig = {
    enabled: updates.enabled,
    githubRepo,
    autoInstall: updates.enabled
      ? { ...updates.autoInstall }
      : {
          ...DEFAULT_RUNTIME_CONFIG.updates.autoInstall,
          enabled: false,
        },
    ...(updates.releasePublicKeyPem?.trim()
      ? { releasePublicKeyPem: updates.releasePublicKeyPem.trim() }
      : {}),
    ...(updates.releasePublicKeyPemBase64?.trim()
      ? { releasePublicKeyPemBase64: updates.releasePublicKeyPemBase64.trim() }
      : {}),
  };

  const validationError = validateAllowlistedServerIds(allowlistedServerIds);
  if (validationError) {
    throw new Error(validationError);
  }

  const operatorValidationError = validateOperatorUserId(operatorUserId);
  if (operatorValidationError) {
    throw new Error(operatorValidationError);
  }

  const rateLimitValidationError = validateAgentRateLimitMessagesPerMinute(
    agentRateLimitMessagesPerMinute,
  );
  if (rateLimitValidationError) {
    throw new Error(rateLimitValidationError);
  }

  const githubRepoValidationError = validateGitHubRepo(githubRepo);
  if (githubRepoValidationError) {
    throw new Error(githubRepoValidationError);
  }

  return {
    ...baseConfig,
    name,
    operatorUserId,
    stylePrompt,
    allowlistedServerIds,
    agentRateLimitMessagesPerMinute,
    agentTimeoutMs: DEFAULT_RUNTIME_CONFIG.agentTimeoutMs,
    agentMaxConcurrentRequests: DEFAULT_RUNTIME_CONFIG.agentMaxConcurrentRequests,
    agentMaxConcurrentRequestsPerGuild: DEFAULT_RUNTIME_CONFIG.agentMaxConcurrentRequestsPerGuild,
    logPrivacy,
    models: input.models
      ? cloneRuntimeModelConfig(input.models)
      : cloneRuntimeModelConfig(DEFAULT_RUNTIME_CONFIG.models),
    providers: { ...(input.providers ?? DEFAULT_RUNTIME_CONFIG.providers) },
    updates: updateConfig,
  };
}

export async function loadExistingRuntimeConfig(
  pathOrUrl: string | URL,
): Promise<Record<string, unknown> | null> {
  const file = Bun.file(pathOrUrl);
  if (!(await file.exists())) {
    return null;
  }

  const rawConfig = await file.json();
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("Existing config.json must contain a JSON object.");
  }

  return rawConfig as Record<string, unknown>;
}

export async function writeRuntimeConfig({
  pathOrUrl = new URL("../../config.json", import.meta.url),
  input,
  overwrite = false,
}: WriteRuntimeConfigOptions): Promise<WriteRuntimeConfigResult> {
  const existingConfig = await loadExistingRuntimeConfig(pathOrUrl);
  const existed = existingConfig !== null;

  if (existed && !overwrite) {
    throw new Error(
      `${formatConfigPath(pathOrUrl)} already exists. Pass overwrite: true to update it.`,
    );
  }

  const config = buildRuntimeConfig(input, existingConfig ?? {});
  await Bun.write(pathOrUrl, `${JSON.stringify(config, null, 2)}\n`);

  return {
    path: formatConfigPath(pathOrUrl),
    config,
    existed,
  };
}

export function formatConfigPath(pathOrUrl: string | URL): string {
  if (pathOrUrl instanceof URL) {
    return pathOrUrl.pathname;
  }

  return pathOrUrl;
}
