import type { Step } from "@aripabot/core/onboarding-wizard/types.ts";

export function previousStepFor(
  step: Step,
  options: { webEnabled: boolean; updateKeyRequired: boolean; updatesEnabled: boolean },
): Step | null {
  switch (step) {
    case "operator":
      return "name";
    case "style":
      return "operator";
    case "servers":
      return "style";
    case "rate-limit":
      return "servers";
    case "rate-limit-custom":
      return "rate-limit";
    case "models":
      return "log-privacy";
    case "log-privacy":
      return "rate-limit";
    case "agent-provider":
      return "models";
    case "agent-model":
      return "agent-provider";
    case "summarizer-provider":
      return "agent-model";
    case "summarizer-model":
      return "summarizer-provider";
    case "web-capability":
      return "summarizer-model";
    case "web-model":
      return "web-capability";
    case "update-source":
      return options.webEnabled ? "web-model" : "web-capability";
    case "update-repo":
      return "update-source";
    case "update-key":
      return "update-source";
    case "update-key-paste":
      return "update-key";
    case "update-key-generated":
      return "update-key";
    case "update-schedule":
      return options.updateKeyRequired ? "update-key" : "update-source";
    case "review":
      return options.updatesEnabled ? "update-schedule" : "update-source";
    default:
      return null;
  }
}

export function stepIndex(candidate: Step): number {
  const normalizedCandidate =
    candidate === "rate-limit-custom"
      ? "rate-limit"
      : [
            "agent-provider",
            "agent-model",
            "summarizer-provider",
            "summarizer-model",
            "web-capability",
            "web-model",
          ].includes(candidate)
        ? "models"
        : [
              "update-source",
              "update-repo",
              "update-key",
              "update-key-paste",
              "update-key-generated",
              "update-schedule",
            ].includes(candidate)
          ? "updates"
          : candidate;
  return [
    "existing-config",
    "name",
    "operator",
    "style",
    "servers",
    "rate-limit",
    "log-privacy",
    "models",
    "updates",
    "review",
    "done",
  ].indexOf(normalizedCandidate);
}

export function rateLimitPresetIndex(value: number | null): number {
  switch (value) {
    case 10:
      return 0;
    case 20:
      return 1;
    case 5:
      return 2;
    case 3:
      return 3;
    case null:
      return 5;
    default:
      return 4;
  }
}

export function rateLimitPresetValue(value: number | null): string {
  switch (value) {
    case 10:
    case 20:
    case 5:
    case 3:
      return String(value);
    case null:
      return "off";
    default:
      return "custom";
  }
}

export function formatRateLimitInputValue(value: number | null): string {
  return value === null ? "off" : String(value);
}
