import type { ConfigurableRuntimeModelProvider, RuntimeJsonConfig } from "@/config/config.ts";

export type Step =
  | "existing-config"
  | "name"
  | "style"
  | "servers"
  | "rate-limit"
  | "rate-limit-custom"
  | "log-privacy"
  | "models"
  | "agent-provider"
  | "agent-model"
  | "summarizer-provider"
  | "summarizer-model"
  | "web-capability"
  | "web-model"
  | "update-source"
  | "update-repo"
  | "update-key"
  | "update-key-paste"
  | "update-key-generated"
  | "review"
  | "done";

export type MinimalKeyEvent = {
  name: string;
  ctrl: boolean;
};

export interface OnboardingState extends RuntimeJsonConfig {
  existingConfig: Record<string, unknown> | null;
  shouldWriteExistingConfig: boolean;
  error: string | null;
  configPath: string | URL;
}

export type ConfigurableProvider = ConfigurableRuntimeModelProvider;
