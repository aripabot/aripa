import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3, SharedV3ProviderOptions } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  RuntimeModelSelection,
  RuntimeProviderConfig,
  RuntimeProviderSettings,
  RuntimeWebModelSelection,
} from "@aripabot/core/config/config.ts";
import { createFmCompatibleFetch, getFmDefaultBaseURL } from "@aripabot/core/agent/fm-compat.ts";

export interface ResolvedTextModel {
  model: LanguageModelV3;
  providerOptions?: SharedV3ProviderOptions;
}

export function resolveAgentTextModel(
  selection: RuntimeModelSelection,
  providers: RuntimeProviderConfig = {},
): ResolvedTextModel {
  return {
    model: resolveLanguageModel(selection, providers),
    providerOptions: createProviderOptions(selection, {
      defaultReasoningEffort: "medium",
    }),
  };
}

export function resolveSummarizerTextModel(
  selection: RuntimeModelSelection,
  providers: RuntimeProviderConfig = {},
): ResolvedTextModel {
  return {
    model: resolveLanguageModel(selection, providers),
    providerOptions: createProviderOptions(selection, {
      defaultReasoningEffort: "low",
    }),
  };
}

export function resolveWebTextModel(
  selection: RuntimeWebModelSelection,
  providers: RuntimeProviderConfig = {},
): LanguageModelV3 {
  const provider = createGoogleGenerativeAI({
    apiKey: readConfiguredApiKey(providers.google),
    ...(providers.google?.baseURL ? { baseURL: providers.google.baseURL } : {}),
  });

  return provider(selection.model);
}

function resolveLanguageModel(
  selection: RuntimeModelSelection,
  providers: RuntimeProviderConfig,
): LanguageModelV3 {
  const providerSettings = providers[selection.provider];

  switch (selection.provider) {
    case "openai":
      return createOpenAI({
        apiKey: readConfiguredApiKey(providerSettings),
        ...(providerSettings?.baseURL ? { baseURL: providerSettings.baseURL } : {}),
      })(selection.model);
    case "openrouter":
      return createOpenRouter({
        apiKey: readConfiguredApiKey(providerSettings, "OPENROUTER_API_KEY"),
        ...(providerSettings?.baseURL ? { baseURL: providerSettings.baseURL } : {}),
      }).chat(selection.model);
    case "gateway":
      return createGateway({
        apiKey: readConfiguredApiKey(providerSettings, "AI_GATEWAY_API_KEY"),
        ...(providerSettings?.baseURL ? { baseURL: providerSettings.baseURL } : {}),
      })(selection.model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: providerSettings?.baseURL ?? "http://localhost:11434/v1",
        ...(readConfiguredApiKey(providerSettings)
          ? { apiKey: readConfiguredApiKey(providerSettings) }
          : {}),
      }).chatModel(selection.model);
    case "lmstudio":
      return createOpenAICompatible({
        name: "lmstudio",
        baseURL: providerSettings?.baseURL ?? "http://localhost:1234/v1",
        ...(readConfiguredApiKey(providerSettings)
          ? { apiKey: readConfiguredApiKey(providerSettings) }
          : {}),
      }).chatModel(selection.model);
    case "fm":
      return createOpenAICompatible({
        name: "fm",
        baseURL: providerSettings?.baseURL ?? getFmDefaultBaseURL(),
        apiKey: readConfiguredApiKey(providerSettings) ?? "sk-local-fm",
        fetch: createFmCompatibleFetch(),
      }).chatModel(selection.model);
    case "google":
      throw new Error("Google is only supported for the web-search model.");
  }
}

function createProviderOptions(
  selection: RuntimeModelSelection,
  {
    defaultReasoningEffort,
  }: { defaultReasoningEffort: NonNullable<RuntimeModelSelection["reasoningEffort"]> },
): SharedV3ProviderOptions | undefined {
  const reasoningEffort = selection.reasoningEffort ?? defaultReasoningEffort;

  if (selection.provider === "openai") {
    return {
      openai: {
        parallelToolCalls: false,
        store: false,
        reasoningEffort,
      } satisfies OpenAILanguageModelResponsesOptions,
    };
  }

  if (selection.provider === "openrouter") {
    return {
      openrouter: {
        parallelToolCalls: false,
      },
    };
  }

  return undefined;
}

function readConfiguredApiKey(
  settings?: RuntimeProviderSettings,
  fallbackEnvName?: string,
): string | undefined {
  const envName = settings?.apiKeyEnv ?? fallbackEnvName;
  return envName ? Bun.env[envName]?.trim() || undefined : undefined;
}
