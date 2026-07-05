import { describe, expect, test } from "vitest";

import {
  DEFAULT_ONBOARDING_MODEL_OPTIONS,
  type OnboardingModelOptions,
} from "@aripabot/core/onboarding-models.ts";
import { selectableProvidersFromModelOptions } from "@aripabot/core/onboarding-wizard/model-option-selection.ts";

describe("selectableProvidersFromModelOptions", () => {
  test("only includes providers with agent and summarizer models", () => {
    const options: OnboardingModelOptions = {
      ...DEFAULT_ONBOARDING_MODEL_OPTIONS,
      agent: {
        ...DEFAULT_ONBOARDING_MODEL_OPTIONS.agent,
        openai: [],
      },
      summarizer: {
        ...DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer,
        ollama: [],
      },
    };

    expect(selectableProvidersFromModelOptions(options)).not.toContain("openai");
    expect(selectableProvidersFromModelOptions(options)).not.toContain("ollama");
    expect(selectableProvidersFromModelOptions(options)).toContain("gateway");
  });

  test("keeps the current provider visible when discovered options are missing", () => {
    const options: OnboardingModelOptions = {
      ...DEFAULT_ONBOARDING_MODEL_OPTIONS,
      agent: {
        ...DEFAULT_ONBOARDING_MODEL_OPTIONS.agent,
        lmstudio: [],
      },
      summarizer: {
        ...DEFAULT_ONBOARDING_MODEL_OPTIONS.summarizer,
        lmstudio: [],
      },
    };

    expect(selectableProvidersFromModelOptions(options, "lmstudio")).toContain("lmstudio");
  });
});
