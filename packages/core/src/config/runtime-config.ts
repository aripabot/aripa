import * as z from "zod";

import {
  AUTO_UPDATE_CRON_PRESETS,
  type AutoUpdateCronExpression,
  type AutoUpdateCronPresetId,
} from "@aripabot/core/update/auto-update-cron.ts";

export const RUNTIME_MODEL_PROVIDERS = [
  "openai",
  "openrouter",
  "gateway",
  "ollama",
  "lmstudio",
  "fm",
  "google",
] as const;
export const CONFIGURABLE_MODEL_PROVIDERS = [
  "openai",
  "openrouter",
  "gateway",
  "ollama",
  "lmstudio",
  "fm",
] as const;
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;

export type RuntimeModelProvider = (typeof RUNTIME_MODEL_PROVIDERS)[number];
export type ConfigurableRuntimeModelProvider = (typeof CONFIGURABLE_MODEL_PROVIDERS)[number];
export type RuntimeReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface RuntimeJsonConfig {
  name: string;
  operatorUserId: string | null;
  stylePrompt: string;
  allowlistedServerIds: string[];
  agentRateLimitMessagesPerMinute: number | null;
  agentTimeoutMs: number;
  agentMaxConcurrentRequests: number;
  agentMaxConcurrentRequestsPerGuild: number;
  logPrivacy: boolean;
  models: RuntimeModelConfig;
  providers: RuntimeProviderConfig;
  updates: RuntimeUpdateConfig;
  memory: RuntimeMemoryConfig;
}

export interface RuntimeModelSelection {
  provider: RuntimeModelProvider;
  model: string;
  reasoningEffort?: RuntimeReasoningEffort;
}

export interface RuntimeWebModelSelection {
  enabled: boolean;
  provider: "google";
  model: string;
}

export interface RuntimeModelConfig {
  agent: RuntimeModelSelection;
  summarizer: RuntimeModelSelection;
  web: RuntimeWebModelSelection;
}

export interface RuntimeProviderSettings {
  baseURL?: string;
  apiKeyEnv?: string;
}

export type RuntimeProviderConfig = Partial<Record<RuntimeModelProvider, RuntimeProviderSettings>>;

export interface RuntimeUpdateConfig {
  enabled: boolean;
  githubRepo: string;
  releasePublicKeyPem?: string;
  releasePublicKeyPemBase64?: string;
  autoInstall: RuntimeAutoUpdateConfig;
}

export interface RuntimeMemoryConfig {
  enabled: boolean;
  idleTtlMinutes: number;
  maxChannels: number;
  maxVerbatimChars: number;
  keepRecentTurns: number;
  gapFillLimit: number;
  coldStartMessageCount: number;
}

export interface RuntimeAutoUpdateConfig {
  enabled: boolean;
  preset: AutoUpdateCronPresetId;
  cronExpression: AutoUpdateCronExpression;
}

export const DEFAULT_MODEL_CONFIG: RuntimeModelConfig = {
  agent: {
    provider: "openai",
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
  },
  summarizer: {
    provider: "openai",
    model: "gpt-5.4-nano",
    reasoningEffort: "low",
  },
  web: {
    enabled: true,
    provider: "google",
    model: "gemini-2.5-flash",
  },
};

export const DEFAULT_RUNTIME_CONFIG: RuntimeJsonConfig = {
  name: "Aripa",
  operatorUserId: null,
  stylePrompt: "match",
  allowlistedServerIds: [],
  agentRateLimitMessagesPerMinute: 10,
  agentTimeoutMs: 60_000,
  agentMaxConcurrentRequests: 4,
  agentMaxConcurrentRequestsPerGuild: 2,
  logPrivacy: true,
  models: DEFAULT_MODEL_CONFIG,
  providers: {},
  updates: {
    enabled: true,
    githubRepo: "aripabot/aripa",
    autoInstall: {
      enabled: false,
      preset: "weekly-sunday-4am",
      cronExpression: "0 4 * * 0",
    },
  },
  memory: {
    enabled: true,
    idleTtlMinutes: 30,
    maxChannels: 500,
    maxVerbatimChars: 6_000,
    keepRecentTurns: 6,
    gapFillLimit: 10,
    coldStartMessageCount: 5,
  },
};

const runtimeModelProviderSchema = z.enum(RUNTIME_MODEL_PROVIDERS);
const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const discordSnowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/);
const optionalDiscordSnowflakeSchema = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? null : value),
    z.union([discordSnowflakeSchema, z.null()]),
  )
  .catch(null);
const trimmedOptionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
  z.string().optional(),
);

const githubRepoSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .catch(DEFAULT_RUNTIME_CONFIG.updates.githubRepo);
const autoUpdateCronPresetSchema = z
  .enum(AUTO_UPDATE_CRON_PRESETS.map((preset) => preset.id))
  .catch(DEFAULT_RUNTIME_CONFIG.updates.autoInstall.preset);
const autoUpdateCronExpressionSchema = z
  .enum(AUTO_UPDATE_CRON_PRESETS.map((preset) => preset.cronExpression))
  .catch(DEFAULT_RUNTIME_CONFIG.updates.autoInstall.cronExpression);

const runtimeProviderSettingsSchema = z.preprocess(
  (value) => (isPlainObject(value) ? value : {}),
  z.object({
    baseURL: trimmedOptionalStringSchema,
    apiKeyEnv: trimmedOptionalStringSchema,
  }),
);

const providerConfigSchema = z
  .preprocess(
    (value) => (isPlainObject(value) ? value : {}),
    z.record(z.string(), runtimeProviderSettingsSchema.catch({})),
  )
  .transform((settingsByProvider): RuntimeProviderConfig => {
    const output: RuntimeProviderConfig = {};

    for (const [provider, settings] of Object.entries(settingsByProvider)) {
      if (isRuntimeModelProvider(provider)) {
        output[provider] = settings;
      }
    }

    return output;
  });

const allowlistedServerIdsSchema = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value
            .filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
            .map((entry) => entry.trim())
        : value,
    z.array(z.string()).catch(DEFAULT_RUNTIME_CONFIG.allowlistedServerIds),
  )
  .transform((ids) => [...new Set(ids)]);

const agentRateLimitSchema = z
  .union([z.number().int().positive(), z.null()])
  .catch(DEFAULT_RUNTIME_CONFIG.agentRateLimitMessagesPerMinute);

const positiveIntegerConfigSchema = (fallback: number) =>
  z.number().int().positive().catch(fallback);

const runtimeConfigSchema = z
  .preprocess(
    (value) => (isPlainObject(value) ? value : {}),
    z.object({
      name: trimmedNonEmptyStringSchema.catch(DEFAULT_RUNTIME_CONFIG.name),
      operatorUserId: optionalDiscordSnowflakeSchema,
      stylePrompt: trimmedNonEmptyStringSchema.catch(DEFAULT_RUNTIME_CONFIG.stylePrompt),
      allowlistedServerIds: allowlistedServerIdsSchema,
      agentRateLimitMessagesPerMinute: agentRateLimitSchema,
      agentTimeoutMs: positiveIntegerConfigSchema(DEFAULT_RUNTIME_CONFIG.agentTimeoutMs),
      agentMaxConcurrentRequests: positiveIntegerConfigSchema(
        DEFAULT_RUNTIME_CONFIG.agentMaxConcurrentRequests,
      ),
      agentMaxConcurrentRequestsPerGuild: positiveIntegerConfigSchema(
        DEFAULT_RUNTIME_CONFIG.agentMaxConcurrentRequestsPerGuild,
      ),
      logPrivacy: z.boolean().catch(DEFAULT_RUNTIME_CONFIG.logPrivacy),
      models: createRuntimeModelConfigSchema(),
      providers: providerConfigSchema.catch({}),
      updates: createRuntimeUpdateConfigSchema(),
      memory: createRuntimeMemoryConfigSchema(),
    }),
  )
  .transform(
    (config): RuntimeJsonConfig => ({
      ...config,
      models: cloneRuntimeModelConfig(config.models),
      providers: { ...config.providers },
      updates: { ...config.updates, autoInstall: { ...config.updates.autoInstall } },
      memory: { ...config.memory },
    }),
  );

export function parseRuntimeJsonConfig(value: unknown): RuntimeJsonConfig {
  return runtimeConfigSchema.parse(value);
}

export function parseRuntimeJsonConfigForMutation(value: unknown): RuntimeJsonConfig {
  return createStrictRuntimeConfigSchema().parse(value);
}

export function cloneDefaultRuntimeConfig(): RuntimeJsonConfig {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    allowlistedServerIds: [...DEFAULT_RUNTIME_CONFIG.allowlistedServerIds],
    models: cloneRuntimeModelConfig(DEFAULT_RUNTIME_CONFIG.models),
    providers: { ...DEFAULT_RUNTIME_CONFIG.providers },
    updates: {
      ...DEFAULT_RUNTIME_CONFIG.updates,
      autoInstall: { ...DEFAULT_RUNTIME_CONFIG.updates.autoInstall },
    },
    memory: { ...DEFAULT_RUNTIME_CONFIG.memory },
  };
}

export function cloneRuntimeModelConfig(config: RuntimeModelConfig): RuntimeModelConfig {
  return {
    agent: { ...config.agent },
    summarizer: { ...config.summarizer },
    web: { ...config.web },
  };
}

export function parseRuntimeModelConfig(value: unknown): RuntimeModelConfig {
  return createRuntimeModelConfigSchema().parse(value);
}

export function parseRuntimeProviderConfig(value: unknown): RuntimeProviderConfig {
  return providerConfigSchema.parse(value);
}

export function isRuntimeModelProvider(value: string): value is RuntimeModelProvider {
  return RUNTIME_MODEL_PROVIDERS.includes(value as RuntimeModelProvider);
}

export function isConfigurableRuntimeModelProvider(
  value: string,
): value is ConfigurableRuntimeModelProvider {
  return CONFIGURABLE_MODEL_PROVIDERS.includes(value as ConfigurableRuntimeModelProvider);
}

function createRuntimeModelConfigSchema() {
  return z.preprocess(
    (value) => (isPlainObject(value) ? value : {}),
    z.object({
      agent: createRuntimeModelSelectionSchema(
        DEFAULT_MODEL_CONFIG.agent,
        CONFIGURABLE_MODEL_PROVIDERS,
      ),
      summarizer: createRuntimeModelSelectionSchema(
        DEFAULT_MODEL_CONFIG.summarizer,
        CONFIGURABLE_MODEL_PROVIDERS,
      ),
      web: createRuntimeWebModelSelectionSchema(),
    }),
  );
}

function createStrictRuntimeConfigSchema() {
  return z
    .object({
      name: trimmedNonEmptyStringSchema,
      operatorUserId: z.union([discordSnowflakeSchema, z.null()]),
      stylePrompt: trimmedNonEmptyStringSchema,
      allowlistedServerIds: z.array(discordSnowflakeSchema).transform((ids) => [...new Set(ids)]),
      agentRateLimitMessagesPerMinute: z.union([z.number().int().positive(), z.null()]),
      agentTimeoutMs: z.number().int().positive(),
      agentMaxConcurrentRequests: z.number().int().positive(),
      agentMaxConcurrentRequestsPerGuild: z.number().int().positive(),
      logPrivacy: z.boolean(),
      models: createStrictRuntimeModelConfigSchema(),
      providers: z
        .record(z.string(), createStrictRuntimeProviderSettingsSchema())
        .refine((providers) => Object.keys(providers).every(isRuntimeModelProvider), {
          message: "Provider is not supported.",
        }),
      updates: createStrictRuntimeUpdateConfigSchema(),
      memory: createStrictRuntimeMemoryConfigSchema(),
    })
    .transform(
      (config): RuntimeJsonConfig => ({
        ...config,
        models: cloneRuntimeModelConfig(config.models),
        providers: { ...config.providers },
        updates: { ...config.updates, autoInstall: { ...config.updates.autoInstall } },
        memory: { ...config.memory },
      }),
    );
}

function createStrictRuntimeModelConfigSchema() {
  return z.object({
    agent: createStrictRuntimeModelSelectionSchema(CONFIGURABLE_MODEL_PROVIDERS),
    summarizer: createStrictRuntimeModelSelectionSchema(CONFIGURABLE_MODEL_PROVIDERS),
    web: z.object({
      enabled: z.boolean(),
      provider: z.literal("google"),
      model: trimmedNonEmptyStringSchema,
    }),
  });
}

function createStrictRuntimeModelSelectionSchema(
  allowedProviders: readonly RuntimeModelProvider[],
) {
  return z
    .object({
      provider: runtimeModelProviderSchema,
      model: trimmedNonEmptyStringSchema,
      reasoningEffort: reasoningEffortSchema.optional(),
    })
    .refine((selection) => allowedProviders.includes(selection.provider), {
      message: "Model provider is not supported for this selection.",
      path: ["provider"],
    })
    .transform(
      (selection): RuntimeModelSelection => ({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      }),
    );
}

function createStrictRuntimeProviderSettingsSchema() {
  return z.object({
    baseURL: trimmedNonEmptyStringSchema.optional(),
    apiKeyEnv: trimmedNonEmptyStringSchema.optional(),
  });
}

function createStrictRuntimeUpdateConfigSchema() {
  return z.object({
    enabled: z.boolean(),
    githubRepo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    releasePublicKeyPem: trimmedNonEmptyStringSchema.optional(),
    releasePublicKeyPemBase64: trimmedNonEmptyStringSchema.optional(),
    autoInstall: z.object({
      enabled: z.boolean(),
      preset: z.enum(AUTO_UPDATE_CRON_PRESETS.map((preset) => preset.id)),
      cronExpression: z.enum(AUTO_UPDATE_CRON_PRESETS.map((preset) => preset.cronExpression)),
    }),
  });
}

function createStrictRuntimeMemoryConfigSchema() {
  return z.object({
    enabled: z.boolean(),
    idleTtlMinutes: z.number().int().positive(),
    maxChannels: z.number().int().positive(),
    maxVerbatimChars: z.number().int().positive(),
    keepRecentTurns: z.number().int().positive(),
    gapFillLimit: z.number().int().positive(),
    coldStartMessageCount: z.number().int().positive(),
  });
}

function createRuntimeModelSelectionSchema(
  fallback: RuntimeModelSelection,
  allowedProviders: readonly RuntimeModelProvider[],
) {
  return z
    .preprocess(
      (value) => (isPlainObject(value) ? value : {}),
      z.object({
        provider: runtimeModelProviderSchema.catch(fallback.provider),
        model: trimmedNonEmptyStringSchema.catch(fallback.model),
        reasoningEffort: reasoningEffortSchema.catch(fallback.reasoningEffort ?? "low"),
      }),
    )
    .transform((selection): RuntimeModelSelection => {
      const provider = allowedProviders.includes(selection.provider)
        ? selection.provider
        : fallback.provider;
      return {
        provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      };
    });
}

function createRuntimeWebModelSelectionSchema() {
  return z
    .preprocess(
      (value) => (isPlainObject(value) ? value : {}),
      z.object({
        enabled: z.boolean().catch(DEFAULT_MODEL_CONFIG.web.enabled),
        model: trimmedNonEmptyStringSchema.catch(DEFAULT_MODEL_CONFIG.web.model),
      }),
    )
    .transform(
      (selection): RuntimeWebModelSelection => ({
        enabled: selection.enabled,
        provider: "google",
        model: selection.model,
      }),
    );
}

function createRuntimeUpdateConfigSchema() {
  return z.preprocess(
    (value) => (isPlainObject(value) ? value : {}),
    z.object({
      enabled: z.boolean().catch(DEFAULT_RUNTIME_CONFIG.updates.enabled),
      githubRepo: githubRepoSchema,
      releasePublicKeyPem: trimmedOptionalStringSchema,
      releasePublicKeyPemBase64: trimmedOptionalStringSchema,
      autoInstall: z
        .preprocess(
          (value) => (isPlainObject(value) ? value : {}),
          z.object({
            enabled: z.boolean().catch(DEFAULT_RUNTIME_CONFIG.updates.autoInstall.enabled),
            preset: autoUpdateCronPresetSchema,
            cronExpression: autoUpdateCronExpressionSchema,
          }),
        )
        .catch(DEFAULT_RUNTIME_CONFIG.updates.autoInstall),
    }),
  );
}

function createRuntimeMemoryConfigSchema() {
  return z.preprocess(
    (value) => (isPlainObject(value) ? value : {}),
    z.object({
      enabled: z.boolean().catch(DEFAULT_RUNTIME_CONFIG.memory.enabled),
      idleTtlMinutes: positiveIntegerConfigSchema(DEFAULT_RUNTIME_CONFIG.memory.idleTtlMinutes),
      maxChannels: positiveIntegerConfigSchema(DEFAULT_RUNTIME_CONFIG.memory.maxChannels),
      maxVerbatimChars: positiveIntegerConfigSchema(DEFAULT_RUNTIME_CONFIG.memory.maxVerbatimChars),
      keepRecentTurns: positiveIntegerConfigSchema(DEFAULT_RUNTIME_CONFIG.memory.keepRecentTurns),
      gapFillLimit: positiveIntegerConfigSchema(DEFAULT_RUNTIME_CONFIG.memory.gapFillLimit),
      coldStartMessageCount: positiveIntegerConfigSchema(
        DEFAULT_RUNTIME_CONFIG.memory.coldStartMessageCount,
      ),
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
