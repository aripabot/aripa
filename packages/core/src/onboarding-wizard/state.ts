import { cloneDefaultRuntimeConfig, parseRuntimeJsonConfig } from "@aripabot/core/config/config.ts";
import type { OnboardingState, Step } from "@aripabot/core/onboarding-wizard/types.ts";

export function createInitialOnboardingState(
  configPath: string | URL,
  existingConfig: Record<string, unknown> | null,
): OnboardingState {
  const parsedConfig = existingConfig
    ? parseRuntimeJsonConfig(existingConfig)
    : cloneDefaultRuntimeConfig();

  return {
    ...parsedConfig,
    existingConfig,
    shouldWriteExistingConfig: false,
    error: null,
    configPath,
  };
}

export function initialStepForState(state: OnboardingState): Step {
  return state.existingConfig ? "existing-config" : "name";
}
