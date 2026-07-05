import type { ConfigurableProvider } from "@aripabot/core/onboarding-wizard/types.ts";

export interface ProviderDisplay {
  name: string;
  description: string;
}

const PROVIDER_DISPLAY = {
  openai: {
    name: "OpenAI",
    description: "Use OPENAI_API_KEY and OpenAI models.",
  },
  openrouter: {
    name: "OpenRouter",
    description: "Use OPENROUTER_API_KEY and OpenRouter model routing.",
  },
  gateway: {
    name: "Vercel AI Gateway",
    description: "Use AI_GATEWAY_API_KEY and Gateway model IDs.",
  },
  ollama: {
    name: "Ollama",
    description: "Use a local OpenAI-compatible Ollama server.",
  },
  lmstudio: {
    name: "LM Studio",
    description: "Use a local LM Studio OpenAI-compatible server.",
  },
  fm: {
    name: "Apple Foundation Models",
    description: "Use fm serve with the system or PCC model.",
  },
} satisfies Record<ConfigurableProvider, ProviderDisplay>;

export function providerDisplayFor(provider: ConfigurableProvider): ProviderDisplay {
  return PROVIDER_DISPLAY[provider];
}
