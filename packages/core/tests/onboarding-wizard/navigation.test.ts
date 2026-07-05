import { describe, expect, test } from "vitest";

import {
  formatRateLimitInputValue,
  previousStepFor,
  rateLimitPresetIndex,
  rateLimitPresetValue,
  stepIndex,
} from "@aripabot/core/onboarding-wizard/navigation.ts";

describe("previousStepFor", () => {
  test("follows the custom update repository signing path", () => {
    const options = { webEnabled: true, updateKeyRequired: true, updatesEnabled: true };

    expect(previousStepFor("update-key", options)).toBe("update-repo");
    expect(previousStepFor("update-key-paste", options)).toBe("update-key");
    expect(previousStepFor("update-key-generated", options)).toBe("update-key");
    expect(previousStepFor("update-schedule", options)).toBe("update-key");
  });

  test("skips signing setup for the official update repository", () => {
    const options = { webEnabled: false, updateKeyRequired: false, updatesEnabled: true };

    expect(previousStepFor("update-schedule", options)).toBe("update-source");
    expect(previousStepFor("review", options)).toBe("update-schedule");
  });

  test("skips the update schedule when updates are disabled", () => {
    expect(
      previousStepFor("review", {
        webEnabled: false,
        updateKeyRequired: false,
        updatesEnabled: false,
      }),
    ).toBe("update-source");
  });

  test("returns to the web model before update setup when web search is enabled", () => {
    expect(
      previousStepFor("update-source", {
        webEnabled: true,
        updateKeyRequired: false,
        updatesEnabled: true,
      }),
    ).toBe("web-model");
  });

  test("skips the web model before update setup when web search is disabled", () => {
    expect(
      previousStepFor("update-source", {
        webEnabled: false,
        updateKeyRequired: false,
        updatesEnabled: true,
      }),
    ).toBe("web-capability");
  });
});

describe("stepIndex", () => {
  test("groups detailed wizard branches into shared progress milestones", () => {
    expect(stepIndex("rate-limit-custom")).toBe(stepIndex("rate-limit"));
    expect(stepIndex("agent-provider")).toBe(stepIndex("models"));
    expect(stepIndex("agent-model")).toBe(stepIndex("models"));
    expect(stepIndex("summarizer-provider")).toBe(stepIndex("models"));
    expect(stepIndex("summarizer-model")).toBe(stepIndex("models"));
    expect(stepIndex("web-capability")).toBe(stepIndex("models"));
    expect(stepIndex("web-model")).toBe(stepIndex("models"));
    expect(stepIndex("update-source")).toBe(stepIndex("update-repo"));
    expect(stepIndex("update-key")).toBe(stepIndex("update-repo"));
    expect(stepIndex("update-key-paste")).toBe(stepIndex("update-repo"));
    expect(stepIndex("update-key-generated")).toBe(stepIndex("update-repo"));
    expect(stepIndex("update-schedule")).toBe(stepIndex("update-repo"));
  });
});

describe("rate limit navigation helpers", () => {
  test("maps stored rate limits to preset indexes", () => {
    expect(rateLimitPresetIndex(10)).toBe(0);
    expect(rateLimitPresetIndex(20)).toBe(1);
    expect(rateLimitPresetIndex(5)).toBe(2);
    expect(rateLimitPresetIndex(3)).toBe(3);
    expect(rateLimitPresetIndex(12)).toBe(4);
    expect(rateLimitPresetIndex(null)).toBe(5);
  });

  test("maps stored rate limits to selectable values", () => {
    expect(rateLimitPresetValue(10)).toBe("10");
    expect(rateLimitPresetValue(20)).toBe("20");
    expect(rateLimitPresetValue(5)).toBe("5");
    expect(rateLimitPresetValue(3)).toBe("3");
    expect(rateLimitPresetValue(12)).toBe("custom");
    expect(rateLimitPresetValue(null)).toBe("off");
  });

  test("formats custom input defaults", () => {
    expect(formatRateLimitInputValue(12)).toBe("12");
    expect(formatRateLimitInputValue(null)).toBe("off");
  });
});
