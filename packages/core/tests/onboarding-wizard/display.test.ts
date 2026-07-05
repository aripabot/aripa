import { describe, expect, test } from "vitest";

import {
  ONBOARDING_PROGRESS_STEPS,
  stepDescription,
  stepTitle,
  submitButtonLabel,
} from "@aripabot/core/onboarding-wizard/display.ts";

describe("onboarding display metadata", () => {
  test("keeps progress labels stable", () => {
    expect(ONBOARDING_PROGRESS_STEPS).toEqual([
      { step: "name", label: "Name" },
      { step: "operator", label: "Operator" },
      { step: "style", label: "Style" },
      { step: "servers", label: "Servers" },
      { step: "rate-limit", label: "Rate Limit" },
      { step: "log-privacy", label: "Log Privacy" },
      { step: "models", label: "Models" },
      { step: "update-source", label: "Updates" },
      { step: "review", label: "Review" },
    ]);
  });

  test("groups branch titles by wizard section", () => {
    expect(stepTitle("rate-limit-custom")).toBe("Set Agent Rate Limit");
    expect(stepTitle("agent-provider")).toBe("Configure AI Models");
    expect(stepTitle("web-model")).toBe("Configure AI Models");
    expect(stepTitle("update-key-generated")).toBe("Configure Updates");
  });

  test("keeps existing step descriptions stable", () => {
    expect(stepDescription("operator")).toBe(
      "The operator is responsible for this installation and does not receive server permissions.",
    );
    expect(stepDescription("update-key")).toBe(
      "The updater needs a public key. GitHub Actions needs the matching private key secret.",
    );
    expect(stepDescription("review")).toBe(
      "Confirm the runtime configuration before writing config.json.",
    );
  });

  test("labels submit states", () => {
    expect(submitButtonLabel("name", false)).toBe("Continue");
    expect(submitButtonLabel("name", true)).toBe("Working…");
    expect(submitButtonLabel("review", false)).toBe("Write Config");
    expect(submitButtonLabel("review", true)).toBe("Saving…");
  });
});
