import { DEFAULT_RUNTIME_CONFIG } from "@aripabot/core/config/config.ts";
import {
  DEFAULT_ONBOARDING_MODEL_OPTIONS,
  type OnboardingModelOptions,
  type OnboardingModelRole,
  type WizardModelOption,
} from "@aripabot/core/onboarding-models.ts";
import type { ConfigurableProvider } from "@aripabot/core/onboarding-wizard/types.ts";

export async function loadWizardModelOptions(): Promise<OnboardingModelOptions> {
  const openRouterModels = await fetchOpenRouterToolModels();
  const gatewayModels = await fetchGatewayModels();
  const ollamaModels = await fetchOpenAICompatibleModels("http://localhost:11434/v1");
  const lmStudioModels = await fetchOpenAICompatibleModels("http://localhost:1234/v1");

  return {
    agent: {
      openai: DEFAULT_ONBOARDING_MODEL_OPTIONS.agent.openai,
      openrouter:
        openRouterModels.length > 0
          ? openRouterModels
          : DEFAULT_ONBOARDING_MODEL_OPTIONS.agent.openrouter,
      gateway:
        gatewayModels.length > 0 ? gatewayModels : DEFAULT_ONBOARDING_MODEL_OPTIONS.agent.gateway,
      ollama:
        ollamaModels.length > 0 ? ollamaModels : DEFAULT_ONBOARDING_MODEL_OPTIONS.agent.ollama,
      lmstudio:
        lmStudioModels.length > 0
          ? lmStudioModels
          : DEFAULT_ONBOARDING_MODEL_OPTIONS.agent.lmstudio,
    },
    summarizer: {
      openai: DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer.openai,
      openrouter:
        openRouterModels.length > 0
          ? openRouterModels
          : DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer.openrouter,
      gateway:
        gatewayModels.length > 0
          ? gatewayModels
          : DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer.gateway,
      ollama:
        ollamaModels.length > 0 ? ollamaModels : DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer.ollama,
      lmstudio:
        lmStudioModels.length > 0
          ? lmStudioModels
          : DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer.lmstudio,
    },
    web: DEFAULT_ONBOARDING_MODEL_OPTIONS.web,
  };
}

export function modelOptionsForProvider(
  options: OnboardingModelOptions,
  provider: ConfigurableProvider,
  role: OnboardingModelRole,
  selectedModel: string,
): WizardModelOption[] {
  const providerOptions = options[role][provider] ?? [];
  if (providerOptions.some((option) => option.value === selectedModel)) {
    return providerOptions;
  }

  return [
    ...providerOptions,
    {
      name: selectedModel,
      description: "Existing custom model from config.json.",
      value: selectedModel,
    },
  ];
}

export function selectedModelIndex(
  options: readonly WizardModelOption[],
  selectedModel: string,
): number {
  const index = options.findIndex((option) => option.value === selectedModel);
  return index >= 0 ? index : 0;
}

export function defaultModelForProvider(
  options: OnboardingModelOptions,
  provider: ConfigurableProvider,
  role: OnboardingModelRole,
): string {
  return (
    options[role][provider]?.[0]?.value ??
    DEFAULT_ONBOARDING_MODEL_OPTIONS[role][provider][0]?.value ??
    DEFAULT_RUNTIME_CONFIG.models[role].model
  );
}

async function fetchOpenRouterToolModels(): Promise<WizardModelOption[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools");
    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as {
      data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown }>;
    };
    return (json.data ?? [])
      .filter(
        (model): model is { id: string; name?: string; context_length?: number } =>
          typeof model.id === "string",
      )
      .slice(0, 30)
      .map((model) => ({
        name: model.name || model.id,
        description:
          typeof model.context_length === "number"
            ? `Tool-capable OpenRouter model, ${model.context_length.toLocaleString()} token context.`
            : "Tool-capable OpenRouter model.",
        value: model.id,
      }));
  } catch {
    return [];
  }
}

async function fetchGatewayModels(): Promise<WizardModelOption[]> {
  try {
    const { createGateway } = await import("@ai-sdk/gateway");
    const models = await createGateway().getAvailableModels();
    return models.models
      .filter((model) => model.modelType === "language" || model.modelType == null)
      .slice(0, 30)
      .map((model) => ({
        name: model.name || model.id,
        description: "Vercel AI Gateway language model. Tool support depends on the routed model.",
        value: model.id,
      }));
  } catch {
    return [];
  }
}

async function fetchOpenAICompatibleModels(baseURL: string): Promise<WizardModelOption[]> {
  try {
    const response = await fetch(`${baseURL.replace(/\/$/, "")}/models`);
    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return (json.data ?? [])
      .filter((model): model is { id: string } => typeof model.id === "string")
      .slice(0, 30)
      .map((model) => ({
        name: model.id,
        description: "Discovered local model. Verify tool calls with your local runtime.",
        value: model.id,
      }));
  } catch {
    return [];
  }
}
