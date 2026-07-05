import { describe, expect, test } from "vitest";

import { providerDisplayFor } from "@aripabot/core/onboarding-wizard/provider-display.ts";
import type { ConfigurableProvider } from "@aripabot/core/onboarding-wizard/types.ts";

describe("providerDisplayFor", () => {
  test("returns display metadata for every configurable provider", () => {
    const providers: ConfigurableProvider[] = [
      "openai",
      "openrouter",
      "gateway",
      "ollama",
      "lmstudio",
      "fm",
    ];

    for (const provider of providers) {
      const display = providerDisplayFor(provider);

      expect(display.name).not.toBe("");
      expect(display.description).not.toBe("");
    }
  });

  test("keeps existing provider copy stable", () => {
    expect(providerDisplayFor("gateway")).toEqual({
      name: "Vercel AI Gateway",
      description: "Use AI_GATEWAY_API_KEY and Gateway model IDs.",
    });
  });
});
