import { describe, expect, test } from "vitest";
import {
  compareDottedVersions,
  getSelectableModelProviders,
  isFmProviderAvailable,
} from "@aripabot/core/onboarding-wizard/provider-availability.ts";

describe("compareDottedVersions", () => {
  test("compares macOS product versions", () => {
    expect(compareDottedVersions("27.0", "27.0")).toBe(0);
    expect(compareDottedVersions("27.1", "27.0")).toBe(1);
    expect(compareDottedVersions("26.9.1", "27.0")).toBe(-1);
  });
});

describe("isFmProviderAvailable", () => {
  test("requires macOS 27 or newer and the fm command", async () => {
    await expect(
      isFmProviderAvailable({
        platform: "darwin",
        macOSVersion: async () => "27.0",
        hasCommand: async () => true,
      }),
    ).resolves.toBe(true);

    await expect(
      isFmProviderAvailable({
        platform: "darwin",
        macOSVersion: async () => "26.9",
        hasCommand: async () => true,
      }),
    ).resolves.toBe(false);

    await expect(
      isFmProviderAvailable({
        platform: "linux",
        macOSVersion: async () => "27.0",
        hasCommand: async () => true,
      }),
    ).resolves.toBe(false);
  });
});

describe("getSelectableModelProviders", () => {
  test("only includes fm when it is available on this host", async () => {
    await expect(
      getSelectableModelProviders({
        platform: "darwin",
        macOSVersion: async () => "27.0",
        hasCommand: async () => true,
      }),
    ).resolves.toContain("fm");

    await expect(
      getSelectableModelProviders({
        platform: "darwin",
        macOSVersion: async () => "26.9",
        hasCommand: async () => true,
      }),
    ).resolves.not.toContain("fm");
  });
});
