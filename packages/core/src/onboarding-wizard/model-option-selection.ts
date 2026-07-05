import { DEFAULT_RUNTIME_CONFIG } from "@aripabot/core/config/runtime-config.ts";
import {
  DEFAULT_ONBOARDING_MODEL_OPTIONS,
  type OnboardingModelOptions,
  type OnboardingModelRole,
  type WizardModelOption,
} from "@aripabot/core/onboarding-models.ts";
import type { ConfigurableProvider } from "@aripabot/core/onboarding-wizard/types.ts";

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

export function selectableProvidersFromModelOptions(
  options: OnboardingModelOptions,
  currentProvider?: ConfigurableProvider,
): ConfigurableProvider[] {
  const providers = (Object.keys(options.agent) as ConfigurableProvider[]).filter(
    (provider) => options.agent[provider].length > 0 && options.summarizer[provider].length > 0,
  );

  if (currentProvider && !providers.includes(currentProvider)) {
    return [...providers, currentProvider];
  }

  return providers;
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
