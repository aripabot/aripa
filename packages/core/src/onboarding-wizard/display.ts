import type { Step } from "@aripabot/core/onboarding-wizard/types.ts";

export type DisplayStep = Exclude<Step, "existing-config" | "done">;

export const ONBOARDING_PROGRESS_STEPS: Array<{ step: DisplayStep; label: string }> = [
  { step: "name", label: "Name" },
  { step: "operator", label: "Operator" },
  { step: "style", label: "Style" },
  { step: "servers", label: "Servers" },
  { step: "rate-limit", label: "Rate Limit" },
  { step: "log-privacy", label: "Log Privacy" },
  { step: "models", label: "Models" },
  { step: "update-source", label: "Updates" },
  { step: "review", label: "Review" },
];

export function stepTitle(step: DisplayStep): string {
  switch (step) {
    case "name":
      return "Name This Bot";
    case "operator":
      return "Set The Operator";
    case "style":
      return "Choose Agent Style";
    case "servers":
      return "Allow Servers";
    case "rate-limit":
    case "rate-limit-custom":
      return "Set Agent Rate Limit";
    case "log-privacy":
      return "Choose Log Privacy";
    case "models":
    case "agent-provider":
    case "agent-model":
    case "summarizer-provider":
    case "summarizer-model":
    case "web-capability":
    case "web-model":
      return "Configure AI Models";
    case "update-source":
    case "update-repo":
    case "update-key":
    case "update-key-paste":
    case "update-key-generated":
    case "update-schedule":
      return "Configure Updates";
    case "review":
      return "Review Config";
  }
}

export function stepDescription(step: DisplayStep): string {
  switch (step) {
    case "name":
      return "This name is injected into agent metadata.";
    case "operator":
      return "The operator is responsible for this installation and does not receive server permissions.";
    case "style":
      return "Choose the voice Aripa uses when responding as an agent.";
    case "servers":
      return "Only allowlisted guilds can use prefix commands or mentions.";
    case "rate-limit":
    case "rate-limit-custom":
      return "Limit paid AI mention requests per user, per server, in a 60 second window.";
    case "log-privacy":
      return "Private logs redact agent tool inputs and outputs.";
    case "models":
      return "Keep defaults or choose providers and models for agent tasks.";
    case "agent-provider":
    case "agent-model":
      return "The main agent model must support tool calls.";
    case "summarizer-provider":
    case "summarizer-model":
      return "The summarizer handles long Discord context windows.";
    case "web-capability":
    case "web-model":
      return "Web search uses Google Generative AI with a Gemini model.";
    case "update-source":
      return "Forks should point this at their own GitHub release repository.";
    case "update-repo":
      return "Use owner/repo format.";
    case "update-key":
    case "update-key-paste":
    case "update-key-generated":
      return "The updater needs a public key. GitHub Actions needs the matching private key secret.";
    case "update-schedule":
      return "Choose whether Aripa installs releases automatically.";
    case "review":
      return "Confirm the runtime configuration before writing config.json.";
  }
}

export function submitButtonLabel(step: DisplayStep, submitting: boolean): string {
  if (submitting) {
    return step === "review" ? "Saving…" : "Working…";
  }

  return step === "review" ? "Write Config" : "Continue";
}
