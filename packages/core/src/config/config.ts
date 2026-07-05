import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cloneDefaultRuntimeConfig,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";

export {
  CONFIGURABLE_MODEL_PROVIDERS,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_RUNTIME_CONFIG,
  REASONING_EFFORTS,
  RUNTIME_MODEL_PROVIDERS,
  cloneDefaultRuntimeConfig,
  cloneRuntimeModelConfig,
  isConfigurableRuntimeModelProvider,
  isRuntimeModelProvider,
  parseRuntimeJsonConfig,
  parseRuntimeModelConfig,
  parseRuntimeProviderConfig,
  type ConfigurableRuntimeModelProvider,
  type RuntimeJsonConfig,
  type RuntimeModelConfig,
  type RuntimeModelProvider,
  type RuntimeModelSelection,
  type RuntimeProviderConfig,
  type RuntimeProviderSettings,
  type RuntimeReasoningEffort,
  type RuntimeUpdateConfig,
  type RuntimeWebModelSelection,
} from "@aripabot/core/config/runtime-config.ts";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const defaultRuntimeConfigPath = join(repositoryRoot, "config.json");
const defaultDatabasePath = join(repositoryRoot, "aripa.sqlite");

const runtimeConfig = await loadRuntimeJsonConfig();

export const config = {
  token: process.env.TOKEN,
  prefix: process.env.PREFIX?.trim() || "-",
  logLevel: process.env.LOG_LEVEL || "info",
  databasePath: process.env.DATABASE_PATH?.trim() || defaultDatabasePath,
  name: runtimeConfig.name,
  operatorUserId: runtimeConfig.operatorUserId,
  stylePrompt: runtimeConfig.stylePrompt,
  allowlistedServerIds: runtimeConfig.allowlistedServerIds,
  agentRateLimitMessagesPerMinute: runtimeConfig.agentRateLimitMessagesPerMinute,
  agentTimeoutMs: runtimeConfig.agentTimeoutMs,
  agentMaxConcurrentRequests: runtimeConfig.agentMaxConcurrentRequests,
  agentMaxConcurrentRequestsPerGuild: runtimeConfig.agentMaxConcurrentRequestsPerGuild,
  logPrivacy: runtimeConfig.logPrivacy,
  models: runtimeConfig.models,
  providers: runtimeConfig.providers,
  updates: runtimeConfig.updates,
} as const;

export function requireToken(): string {
  if (!config.token) {
    throw new Error("TOKEN environment variable is required.");
  }

  return config.token;
}

export function isGuildAllowed(
  guildId: string | null | undefined,
  allowlistedServerIds: readonly string[] = config.allowlistedServerIds,
): boolean {
  return typeof guildId === "string" && allowlistedServerIds.includes(guildId);
}

export async function loadRuntimeJsonConfig(
  pathOrUrl: string | URL = process.env.CONFIG_PATH?.trim() || defaultRuntimeConfigPath,
): Promise<RuntimeJsonConfig> {
  try {
    return parseRuntimeJsonConfig(JSON.parse(await readFile(pathOrUrl, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return cloneDefaultRuntimeConfig();
    }

    throw error;
  }
}
