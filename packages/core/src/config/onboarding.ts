import {
  DEFAULT_RUNTIME_CONFIG,
  cloneRuntimeModelConfig,
  parseRuntimeJsonConfig,
  parseRuntimeJsonConfigForMutation,
  type RuntimeJsonConfig,
  type RuntimeModelConfig,
  type RuntimeProviderConfig,
  type RuntimeUpdateConfig,
} from "@aripabot/core/config/runtime-config.ts";
import {
  validateAgentRateLimitMessagesPerMinute,
  validateAllowlistedServerIds,
  validateGitHubRepo,
  validateOperatorUserId,
} from "@aripabot/core/config/onboarding-validation.ts";
import { generateKeyPairSync } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export {
  parseAgentRateLimitInput,
  parseAllowlistedServerIds,
  validateAgentRateLimitMessagesPerMinute,
  validateAllowlistedServerIds,
  validateGitHubRepo,
  validateOperatorUserId,
} from "@aripabot/core/config/onboarding-validation.ts";

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
  config: RuntimeConfigDocument;
  existed: boolean;
}

export type RuntimeConfigDocument = RuntimeJsonConfig & Record<string, unknown>;

export interface ReleaseSigningKeyPair {
  privateKeyPemBase64: string;
  publicKeyPemBase64: string;
}

export function buildRuntimeConfig(
  input: RuntimeOnboardingInput,
  baseConfig: Record<string, unknown> = {},
): RuntimeConfigDocument {
  const baseRuntimeConfig = parseRuntimeJsonConfig(baseConfig);
  const name = input.name?.trim() || baseRuntimeConfig.name;
  const operatorUserId = input.operatorUserId?.trim() || baseRuntimeConfig.operatorUserId;
  const stylePrompt = input.stylePrompt?.trim() || baseRuntimeConfig.stylePrompt;
  const allowlistedServerIds = [
    ...new Set(input.allowlistedServerIds.map((entry) => entry.trim()).filter(Boolean)),
  ];
  const agentRateLimitMessagesPerMinute =
    input.agentRateLimitMessagesPerMinute === undefined
      ? baseRuntimeConfig.agentRateLimitMessagesPerMinute
      : input.agentRateLimitMessagesPerMinute;
  const logPrivacy = input.logPrivacy ?? baseRuntimeConfig.logPrivacy;
  const updates = input.updates ?? baseRuntimeConfig.updates;
  const githubRepo = updates.githubRepo.trim() || baseRuntimeConfig.updates.githubRepo;
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

  const config = parseRuntimeJsonConfigForMutation({
    ...baseRuntimeConfig,
    name,
    operatorUserId,
    stylePrompt,
    allowlistedServerIds,
    agentRateLimitMessagesPerMinute,
    agentTimeoutMs: baseRuntimeConfig.agentTimeoutMs,
    agentMaxConcurrentRequests: baseRuntimeConfig.agentMaxConcurrentRequests,
    agentMaxConcurrentRequestsPerGuild: baseRuntimeConfig.agentMaxConcurrentRequestsPerGuild,
    logPrivacy,
    models: input.models
      ? cloneRuntimeModelConfig(input.models)
      : cloneRuntimeModelConfig(baseRuntimeConfig.models),
    providers: { ...(input.providers ?? baseRuntimeConfig.providers) },
    updates: updateConfig,
    memory: { ...baseRuntimeConfig.memory },
  });

  return { ...baseConfig, ...config };
}

export async function loadExistingRuntimeConfig(
  pathOrUrl: string | URL,
): Promise<Record<string, unknown> | null> {
  try {
    await access(pathOrUrl);
  } catch {
    return null;
  }

  const rawConfig = JSON.parse(await readFile(pathOrUrl, "utf8")) as unknown;
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("Existing config.json must contain a JSON object.");
  }

  return rawConfig as Record<string, unknown>;
}

export async function writeRuntimeConfig({
  pathOrUrl = getDefaultRuntimeConfigPath(),
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
  await writeFile(pathOrUrl, `${JSON.stringify(config, null, 2)}\n`);

  return {
    path: formatConfigPath(pathOrUrl),
    config,
    existed,
  };
}

function getDefaultRuntimeConfigPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "config.json");
}

export function formatConfigPath(pathOrUrl: string | URL): string {
  if (pathOrUrl instanceof URL) {
    return pathOrUrl.pathname;
  }

  return pathOrUrl;
}

export function generateReleaseSigningKeyPair(): ReleaseSigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  return {
    privateKeyPemBase64: Buffer.from(privateKeyPem, "utf8").toString("base64"),
    publicKeyPemBase64: Buffer.from(publicKeyPem, "utf8").toString("base64"),
  };
}
