import { describe, expect, test } from "vitest";

import {
  formatRateLimitInputValue,
  rateLimitPresetIndex,
  rateLimitPresetValue,
} from "@aripabot/core/onboarding-wizard/navigation.ts";

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
