"use client";

import type * as React from "react";

import {
  CustomRateLimitStep,
  GeneratedUpdateKeyStep,
  LogPrivacyStep,
  ModelModeStep,
  ModelProviderStep,
  ModelSelectionStep,
  NameStep,
  OperatorStep,
  RateLimitPresetStep,
  ReviewStep,
  ServerAllowlistStep,
  StyleStep,
  UpdateScheduleStep,
  UpdateKeyChoiceStep,
  UpdateKeyPasteStep,
  UpdateRepoStep,
  UpdateSourceStep,
  WebCapabilityStep,
} from "@/components/dashboard/dashboard-onboarding-steps";
import type { OnboardingOptionsResponse } from "@/lib/api-types";
import type {
  ConfigurableRuntimeModelProvider,
  RuntimeJsonConfig,
  RuntimeModelSelection,
} from "@aripabot/core/config/config.ts";
import { parseAllowlistedServerIds } from "@aripabot/core/config/onboarding-validation.ts";
import type { Step as WizardStep } from "@aripabot/core/onboarding-wizard/types.ts";

export type DashboardOnboardingStep = Exclude<WizardStep, "existing-config" | "done">;
export type UpdateSource = "official" | "custom" | "disabled";

export interface DashboardOnboardingStepContentProps {
  allowlistInput: string;
  config: RuntimeJsonConfig;
  customRateLimitInput: string;
  generatedPrivateKey: string | null;
  modelMode: "defaults" | "customize";
  onCopyGeneratedKey: () => void;
  onGenerateKeyPair: () => void;
  options: OnboardingOptionsResponse | null;
  setAllowlistInput: React.Dispatch<React.SetStateAction<string>>;
  setConfig: React.Dispatch<React.SetStateAction<RuntimeJsonConfig>>;
  setCustomRateLimitInput: React.Dispatch<React.SetStateAction<string>>;
  setGeneratedPrivateKey: React.Dispatch<React.SetStateAction<string | null>>;
  setModelMode: React.Dispatch<React.SetStateAction<"defaults" | "customize">>;
  setStepWithReset: (nextStep: DashboardOnboardingStep) => void;
  setUpdateSource: React.Dispatch<React.SetStateAction<UpdateSource>>;
  step: DashboardOnboardingStep;
  updateConfig: (patch: Partial<RuntimeJsonConfig>) => void;
  updateModel: (role: "agent" | "summarizer", patch: Partial<RuntimeModelSelection>) => void;
  updateSource: UpdateSource;
}

export function DashboardOnboardingStepContent({
  allowlistInput,
  config,
  customRateLimitInput,
  generatedPrivateKey,
  modelMode,
  onCopyGeneratedKey,
  onGenerateKeyPair,
  options,
  setAllowlistInput,
  setConfig,
  setCustomRateLimitInput,
  setGeneratedPrivateKey,
  setModelMode,
  setStepWithReset,
  setUpdateSource,
  step,
  updateConfig,
  updateModel,
  updateSource,
}: DashboardOnboardingStepContentProps) {
  if (!options) {
    return null;
  }

  switch (step) {
    case "name":
      return <NameStep value={config.name} onChange={(name) => updateConfig({ name })} />;
    case "operator":
      return (
        <OperatorStep
          value={config.operatorUserId}
          onChange={(operatorUserId) => updateConfig({ operatorUserId })}
        />
      );
    case "style":
      return (
        <StyleStep
          styles={options.styles}
          value={config.stylePrompt}
          onChange={(stylePrompt) => updateConfig({ stylePrompt })}
        />
      );
    case "servers":
      return <ServerAllowlistStep value={allowlistInput} onChange={setAllowlistInput} />;
    case "rate-limit":
      return (
        <RateLimitPresetStep
          value={config.agentRateLimitMessagesPerMinute}
          onChange={(value) => {
            if (value === "custom") {
              setStepWithReset("rate-limit-custom");
              return;
            }
            updateConfig({
              agentRateLimitMessagesPerMinute: value === "off" ? null : Number(value),
            });
          }}
        />
      );
    case "rate-limit-custom":
      return (
        <CustomRateLimitStep value={customRateLimitInput} onChange={setCustomRateLimitInput} />
      );
    case "log-privacy":
      return (
        <LogPrivacyStep
          checked={config.logPrivacy}
          onCheckedChange={(logPrivacy) => updateConfig({ logPrivacy })}
        />
      );
    case "models":
      return (
        <ModelModeStep
          value={modelMode}
          defaultSummary={defaultModelSummary(config)}
          onChange={(value) => setModelMode(value as "defaults" | "customize")}
        />
      );
    case "agent-provider":
      return (
        <ModelProviderStep
          id="onboarding-agent-provider"
          label="Agent Provider"
          modelOptions={options.modelOptions}
          value={config.models.agent.provider as ConfigurableRuntimeModelProvider}
          onValueChange={(provider) => {
            updateModel("agent", {
              provider,
              model: defaultModelForProvider(options, provider, "agent"),
            });
          }}
        />
      );
    case "agent-model":
      return (
        <ModelSelectionStep
          id="onboarding-agent-model"
          label="Agent Model"
          options={modelOptionsForProvider(
            options,
            config.models.agent.provider as ConfigurableRuntimeModelProvider,
            "agent",
            config.models.agent.model,
          )}
          value={config.models.agent.model}
          onValueChange={(model) => updateModel("agent", { model })}
        />
      );
    case "summarizer-provider":
      return (
        <ModelProviderStep
          id="onboarding-summarizer-provider"
          label="Summarizer Provider"
          modelOptions={options.modelOptions}
          value={config.models.summarizer.provider as ConfigurableRuntimeModelProvider}
          onValueChange={(provider) => {
            updateModel("summarizer", {
              provider,
              model: defaultModelForProvider(options, provider, "summarizer"),
            });
          }}
        />
      );
    case "summarizer-model":
      return (
        <ModelSelectionStep
          id="onboarding-summarizer-model"
          label="Summarizer Model"
          options={modelOptionsForProvider(
            options,
            config.models.summarizer.provider as ConfigurableRuntimeModelProvider,
            "summarizer",
            config.models.summarizer.model,
          )}
          value={config.models.summarizer.model}
          onValueChange={(model) => updateModel("summarizer", { model })}
        />
      );
    case "web-capability":
      return (
        <WebCapabilityStep
          checked={config.models.web.enabled}
          onCheckedChange={(enabled) =>
            setConfig({
              ...config,
              models: { ...config.models, web: { ...config.models.web, enabled } },
            })
          }
        />
      );
    case "web-model":
      return (
        <ModelSelectionStep
          id="onboarding-web-model"
          label="Web Search Model"
          options={options.modelOptions.web}
          value={config.models.web.model}
          onValueChange={(model) =>
            setConfig({
              ...config,
              models: { ...config.models, web: { ...config.models.web, model } },
            })
          }
        />
      );
    case "update-source":
      return (
        <UpdateSourceStep
          value={updateSource}
          defaultUpdateRepo={options.defaultUpdateRepo}
          onChange={(value) => setUpdateSource(value as UpdateSource)}
        />
      );
    case "update-repo":
      return (
        <UpdateRepoStep
          value={config.updates.githubRepo}
          onChange={(githubRepo) =>
            setConfig({
              ...config,
              updates: { ...config.updates, githubRepo },
            })
          }
        />
      );
    case "update-key":
      return (
        <UpdateKeyChoiceStep
          onGenerate={onGenerateKeyPair}
          onPaste={() => setStepWithReset("update-key-paste")}
          onUseEnvironmentVariable={() => {
            const updates = { ...config.updates };
            delete updates.releasePublicKeyPem;
            delete updates.releasePublicKeyPemBase64;
            setConfig({ ...config, updates });
            setGeneratedPrivateKey(null);
            setStepWithReset("update-schedule");
          }}
        />
      );
    case "update-key-paste":
      return (
        <UpdateKeyPasteStep
          value={config.updates.releasePublicKeyPemBase64 ?? ""}
          onChange={(key) => {
            const updates = { ...config.updates };
            delete updates.releasePublicKeyPem;
            setConfig({
              ...config,
              updates: {
                ...updates,
                ...(key ? { releasePublicKeyPemBase64: key } : {}),
              },
            });
          }}
        />
      );
    case "update-key-generated":
      return (
        <GeneratedUpdateKeyStep
          privateKey={generatedPrivateKey}
          onCopy={onCopyGeneratedKey}
          onRegenerate={onGenerateKeyPair}
        />
      );
    case "update-schedule":
      return (
        <UpdateScheduleStep
          autoInstall={config.updates.autoInstall}
          presets={options.autoUpdateCronPresets}
          onChange={(value) => {
            if (value === "disabled") {
              setConfig({
                ...config,
                updates: {
                  ...config.updates,
                  autoInstall: { ...config.updates.autoInstall, enabled: false },
                },
              });
              return;
            }

            const preset = options.autoUpdateCronPresets.find(
              (candidate) => candidate.id === value,
            );
            if (!preset) {
              return;
            }

            setConfig({
              ...config,
              updates: {
                ...config.updates,
                autoInstall: {
                  enabled: true,
                  preset: preset.id,
                  cronExpression: preset.cronExpression,
                },
              },
            });
          }}
        />
      );
    case "review":
      return (
        <ReviewStep>
          {JSON.stringify(
            {
              ...config,
              allowlistedServerIds: parseAllowlistedServerIds(allowlistInput),
            },
            null,
            2,
          )}
        </ReviewStep>
      );
  }
}

function modelOptionsForProvider(
  options: OnboardingOptionsResponse,
  provider: ConfigurableRuntimeModelProvider,
  role: "agent" | "summarizer",
  selectedModel: string,
) {
  const providerOptions = options.modelOptions[role][provider] ?? [];
  if (providerOptions.some((option) => option.value === selectedModel)) {
    return providerOptions;
  }

  return [
    ...providerOptions,
    {
      name: selectedModel,
      description: "Existing custom model from config.json.",
      value: selectedModel,
    },
  ];
}

function defaultModelForProvider(
  options: OnboardingOptionsResponse,
  provider: ConfigurableRuntimeModelProvider,
  role: "agent" | "summarizer",
): string {
  return options.modelOptions[role][provider]?.[0]?.value ?? "";
}

function defaultModelSummary(config: RuntimeJsonConfig): string {
  return `${config.models.agent.provider}/${config.models.agent.model}, ${config.models.summarizer.provider}/${config.models.summarizer.model}`;
}
