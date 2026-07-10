import { describe, expect, test } from "vitest";

import {
  DEFAULT_ONBOARDING_MODEL_OPTIONS,
  type OnboardingModelOptions,
} from "@aripabot/core/onboarding-models.ts";
import {
  defaultModelForProvider,
  selectableProvidersFromModelOptions,
} from "@aripabot/core/onboarding-wizard/model-option-selection.ts";

describe("OpenAI agent model options", () => {
  test("lists the flagship models in default-first order", () => {
    expect(DEFAULT_ONBOARDING_MODEL_OPTIONS.agent.openai).toEqual([
      {
        name: "gpt-5.6-terra",
        description: "OpenAI's medium-sized flagship model.",
        value: "gpt-5.6-terra",
      },
      {
        name: "gpt-5.6-sol",
        description: "OpenAI's most capable flagship model.",
        value: "gpt-5.6-sol",
      },
      {
        name: "gpt-5.6-luna",
        description: "OpenAI's low cost flagship model.",
        value: "gpt-5.6-luna",
      },
      {
        name: "gpt-5.5",
        description: "OpenAI's previous generation model.",
        value: "gpt-5.5",
      },
    ]);
  });

  test("defaults OpenAI onboarding to Terra", () => {
    expect(defaultModelForProvider(DEFAULT_ONBOARDING_MODEL_OPTIONS, "openai", "agent")).toBe(
      "gpt-5.6-terra",
    );
  });
});

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
