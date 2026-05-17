import type { ConfigurableRuntimeModelProvider } from "@/config/config.ts";

export type ConfigurableModelProvider = ConfigurableRuntimeModelProvider;
export type OnboardingModelRole = "agent" | "summarizer";

export interface WizardModelOption {
  name: string;
  description: string;
  value: string;
}

export type OnboardingModelOptions = {
  [role in OnboardingModelRole]: Record<ConfigurableModelProvider, WizardModelOption[]>;
} & {
  web: WizardModelOption[];
};

export const DEFAULT_ONBOARDING_MODEL_OPTIONS: OnboardingModelOptions = {
  agent: {
    openai: [
      {
        name: "gpt-5.5",
        description: "Latest high-capability OpenAI reasoning model.",
        value: "gpt-5.5",
      },
      {
        name: "gpt-5.4",
        description: "Previous generation OpenAI reasoning model.",
        value: "gpt-5.4",
      },
      {
        name: "gpt-5.4-mini",
        description: "Lower cost OpenAI reasoning model.",
        value: "gpt-5.4-mini",
      },
    ],
    openrouter: [
      {
        name: "openai/gpt-5.5",
        description: "Latest high-capability OpenAI reasoning model",
        value: "openai/gpt-5.5",
      },
      {
        name: "openai/gpt-5.4",
        description: "Previous generation OpenAI reasoning model.",
        value: "openai/gpt-5.4",
      },
      {
        name: "anthropic/claude-sonnet-4.6",
        description: "Latest Anthropic medium-cost model.",
        value: "anthropic/claude-sonnet-4.6",
      },
    ],
    gateway: [
      {
        name: "openai/gpt-5.5",
        description: "Latest high-capability OpenAI reasoning model.",
        value: "openai/gpt-5.5",
      },
      {
        name: "anthropic/claude-sonnet-4.6",
        description: "Latest Anthropic medium-cost model.",
        value: "anthropic/claude-sonnet-4.6",
      },
    ],
    ollama: [
      { name: "gemma4:latest", description: "Latest Google Gemma model.", value: "gemma4:latest" },
      {
        name: "qwen3.5:latest",
        description: "High performance per parameter Qwen model.",
        value: "qwen3.5:latest",
      },
    ],
    lmstudio: [
      {
        name: "google/gemma-4-e4b",
        description: "Latest Google Gemma model.",
        value: "google/gemma-4-e4b",
      },
      {
        name: "qwen/qwen3.5-9b",
        description: "High performance per parameter Qwen model.",
        value: "qwen/qwen3.5-9b",
      },
    ],
  },
  summarizer: {
    openai: [
      {
        name: "gpt-5.4-nano",
        description: "Default low-cost OpenAI summarizer.",
        value: "gpt-5.4-nano",
      },
      { name: "gpt-5.4-mini", description: "Stronger OpenAI summarizer.", value: "gpt-5.4-mini" },
      {
        name: "gpt-5-nano",
        description: "Earlier low-cost OpenAI summarizer.",
        value: "gpt-5-nano",
      },
    ],
    openrouter: [
      {
        name: "openai/gpt-5.4-nano",
        description: "OpenRouter low-cost summarizer.",
        value: "openai/gpt-5.4-nano",
      },
    ],
    gateway: [
      {
        name: "openai/gpt-5.4-nano",
        description: "Vercel AI Gateway low-cost summarizer.",
        value: "openai/gpt-5.4-nano",
      },
    ],
    ollama: [
      {
        name: "qwen3.5:latest",
        description: "Local Ollama summarizer candidate.",
        value: "qwen3.5:latest",
      },
    ],
    lmstudio: [
      {
        name: "openai/gpt-oss-20b",
        description: "Local LM Studio summarizer candidate.",
        value: "openai/gpt-oss-20b",
      },
    ],
  },
  web: [
    {
      name: "gemini-2.5-flash",
      description: "Default Gemini web grounding model.",
      value: "gemini-2.5-flash",
    },
    {
      name: "gemini-2.5-flash-lite",
      description: "Lower-cost Gemini web grounding model.",
      value: "gemini-2.5-flash-lite",
    },
    {
      name: "gemini-2.5-pro",
      description: "Stronger Gemini web grounding model.",
      value: "gemini-2.5-pro",
    },
    {
      name: "gemini-2.0-flash",
      description: "Earlier Gemini model with Google Search grounding.",
      value: "gemini-2.0-flash",
    },
  ],
};
