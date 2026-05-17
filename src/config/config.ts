import {
  cloneDefaultRuntimeConfig,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@/config/runtime-config.ts";

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
} from "@/config/runtime-config.ts";

const defaultRuntimeConfigUrl = new URL("../../config.json", import.meta.url);

const runtimeConfig = await loadRuntimeJsonConfig();

export const config = {
  token: Bun.env.TOKEN,
  prefix: Bun.env.PREFIX?.trim() || "-",
  logLevel: Bun.env.LOG_LEVEL || "info",
  databasePath: Bun.env.DATABASE_PATH?.trim() || "aripa.sqlite",
  name: runtimeConfig.name,
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
  pathOrUrl: string | URL = Bun.env.CONFIG_PATH?.trim() || defaultRuntimeConfigUrl,
): Promise<RuntimeJsonConfig> {
  const file = Bun.file(pathOrUrl);

  if (!(await file.exists())) {
    return cloneDefaultRuntimeConfig();
  }

  return parseRuntimeJsonConfig(await file.json());
}
