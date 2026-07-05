"use client";

import { useEffect, useState } from "react";

import { DashboardOnboardingLayout } from "@/components/dashboard/dashboard-onboarding-layout";
import {
  DashboardOnboardingStepContent,
  type DashboardOnboardingStep as Step,
  type UpdateSource,
} from "@/components/dashboard/dashboard-onboarding-step-content";
import { completeOnboarding, generateSigningKey, getOnboardingOptions } from "@/lib/api";
import { readableError } from "@/lib/errors";
import type {
  CompleteOnboardingResponse,
  DashboardStatus,
  OnboardingOptionsResponse,
} from "@/lib/api-types";
import {
  parseAgentRateLimitInput,
  parseAllowlistedServerIds,
  validateAgentRateLimitMessagesPerMinute,
  validateAllowlistedServerIds,
  validateGitHubRepo,
  validateOperatorUserId,
} from "@aripabot/core/config/onboarding-validation.ts";
import {
  stepDescription,
  stepTitle,
  submitButtonLabel,
} from "@aripabot/core/onboarding-wizard/display.ts";
import { previousStepFor, stepIndex } from "@aripabot/core/onboarding-wizard/navigation.ts";
import type { RuntimeJsonConfig, RuntimeModelSelection } from "@aripabot/core/config/config.ts";

export function DashboardOnboardingScreen({
  initialStatus,
  onComplete,
  onSignOut,
}: {
  initialStatus: DashboardStatus;
  onComplete: (result: CompleteOnboardingResponse) => void;
  onSignOut: () => void;
}) {
  const [options, setOptions] = useState<OnboardingOptionsResponse | null>(null);
  const [config, setConfig] = useState<RuntimeJsonConfig>(initialStatus.config);
  const [allowlistInput, setAllowlistInput] = useState(
    initialStatus.config.allowlistedServerIds.join("\n"),
  );
  const [step, setStep] = useState<Step>("name");
  const [modelMode, setModelMode] = useState<"defaults" | "customize">("defaults");
  const [customRateLimitInput, setCustomRateLimitInput] = useState(
    initialStatus.config.agentRateLimitMessagesPerMinute === null
      ? "off"
      : String(initialStatus.config.agentRateLimitMessagesPerMinute),
  );
  const [updateSource, setUpdateSource] = useState<UpdateSource>(
    initialStatus.config.updates.enabled
      ? initialStatus.config.updates.githubRepo === "aripabot/aripa"
        ? "official"
        : "custom"
      : "disabled",
  );
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const loaded = await getOnboardingOptions();
        if (cancelled) {
          return;
        }

        setOptions(loaded);
        setConfig(loaded.config);
        setAllowlistInput(loaded.config.allowlistedServerIds.join("\n"));
        setCustomRateLimitInput(
          loaded.config.agentRateLimitMessagesPerMinute === null
            ? "off"
            : String(loaded.config.agentRateLimitMessagesPerMinute),
        );
        setUpdateSource(
          loaded.config.updates.enabled
            ? loaded.config.updates.githubRepo === loaded.defaultUpdateRepo
              ? "official"
              : "custom"
            : "disabled",
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(readableError(loadError, "Request failed."));
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (submitting) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [submitting]);

  const activeProgressIndex = stepIndex(step);
  const canGoBack = previousStep(step, config) !== null;

  function updateConfig(patch: Partial<RuntimeJsonConfig>): void {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function updateModel(role: "agent" | "summarizer", patch: Partial<RuntimeModelSelection>) {
    setConfig((current) => ({
      ...current,
      models: {
        ...current.models,
        [role]: {
          ...current.models[role],
          ...patch,
        },
      },
    }));
  }

  function setStepWithReset(nextStep: Step): void {
    setError(null);
    setMessage(null);
    setStep(nextStep);
  }

  function goBack(): void {
    const previous = previousStep(step, config);
    if (previous) {
      setStepWithReset(previous);
    }
  }

  async function advance(): Promise<void> {
    setError(null);
    setMessage(null);

    switch (step) {
      case "name":
        updateConfig({ name: config.name.trim() || "Aripa" });
        setStep("operator");
        return;
      case "operator": {
        const operatorUserId = config.operatorUserId?.trim() || null;
        const validationError = validateOperatorUserId(operatorUserId);
        if (validationError) {
          setError(validationError);
          return;
        }
        updateConfig({ operatorUserId });
        setStep("style");
        return;
      }
      case "style":
        setStep("servers");
        return;
      case "servers": {
        const ids = parseAllowlistedServerIds(allowlistInput);
        const validationError = validateAllowlistedServerIds(ids);
        if (validationError) {
          setError(validationError);
          return;
        }
        updateConfig({ allowlistedServerIds: ids });
        setStep("rate-limit");
        return;
      }
      case "rate-limit":
        setStep("log-privacy");
        return;
      case "rate-limit-custom": {
        const parsed = parseAgentRateLimitInput(customRateLimitInput);
        if (parsed === "invalid") {
          setError("Enter a whole number greater than 0, or off.");
          return;
        }
        const validationError = validateAgentRateLimitMessagesPerMinute(parsed);
        if (validationError) {
          setError(validationError);
          return;
        }
        updateConfig({ agentRateLimitMessagesPerMinute: parsed });
        setStep("log-privacy");
        return;
      }
      case "log-privacy":
        setStep("models");
        return;
      case "models":
        setStep(modelMode === "customize" ? "agent-provider" : "update-source");
        return;
      case "agent-provider":
        setStep("agent-model");
        return;
      case "agent-model":
        setStep("summarizer-provider");
        return;
      case "summarizer-provider":
        setStep("summarizer-model");
        return;
      case "summarizer-model":
        setStep("web-capability");
        return;
      case "web-capability":
        setStep(config.models.web.enabled ? "web-model" : "update-source");
        return;
      case "web-model":
        setStep("update-source");
        return;
      case "update-source":
        if (updateSource === "disabled") {
          updateConfig({
            updates: {
              ...config.updates,
              enabled: false,
              autoInstall: { ...config.updates.autoInstall, enabled: false },
            },
          });
          setStep("review");
          return;
        }

        if (updateSource === "official") {
          if (!options) {
            setError("Onboarding options are still loading.");
            return;
          }
          const updates = { ...config.updates };
          delete updates.releasePublicKeyPem;
          delete updates.releasePublicKeyPemBase64;
          updateConfig({
            updates: {
              ...updates,
              enabled: true,
              githubRepo: options.defaultUpdateRepo,
            },
          });
          setGeneratedPrivateKey(null);
          setStep("update-schedule");
          return;
        }

        updateConfig({ updates: { ...config.updates, enabled: true } });
        setStep("update-repo");
        return;
      case "update-repo": {
        const githubRepo = config.updates.githubRepo.trim();
        const validationError = validateGitHubRepo(githubRepo);
        if (validationError) {
          setError(validationError);
          return;
        }
        updateConfig({ updates: { ...config.updates, enabled: true, githubRepo } });
        setStep("update-key");
        return;
      }
      case "update-key":
        return;
      case "update-key-paste":
        setGeneratedPrivateKey(null);
        setStep("update-schedule");
        return;
      case "update-key-generated":
        setStep("update-schedule");
        return;
      case "update-schedule":
        setStep("review");
        return;
      case "review":
        await submit();
        return;
    }
  }

  async function generateKeyPair(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const keyPair = await generateSigningKey();
      const updates = { ...config.updates };
      delete updates.releasePublicKeyPem;
      setConfig({
        ...config,
        updates: {
          ...updates,
          releasePublicKeyPemBase64: keyPair.publicKeyPemBase64,
        },
      });
      setGeneratedPrivateKey(keyPair.privateKeyPemBase64);
      setStep("update-key-generated");
    } catch (generateError) {
      setError(readableError(generateError, "Request failed."));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyGeneratedKey(): Promise<void> {
    if (!generatedPrivateKey) {
      setMessage("No generated private key is available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedPrivateKey);
      setMessage("Copied private key secret value.");
    } catch {
      setMessage("Clipboard copy failed. Use the displayed secret value.");
    }
  }

  async function submit(): Promise<void> {
    const ids = parseAllowlistedServerIds(allowlistInput);
    const validationError =
      validateAllowlistedServerIds(ids) ||
      validateOperatorUserId(config.operatorUserId?.trim() || null) ||
      validateAgentRateLimitMessagesPerMinute(config.agentRateLimitMessagesPerMinute) ||
      validateGitHubRepo(config.updates.githubRepo);

    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await completeOnboarding({
        input: {
          name: config.name,
          operatorUserId: config.operatorUserId,
          stylePrompt: config.stylePrompt,
          allowlistedServerIds: ids,
          agentRateLimitMessagesPerMinute: config.agentRateLimitMessagesPerMinute,
          logPrivacy: config.logPrivacy,
          models: config.models,
          providers: config.providers,
          updates: config.updates,
        },
      });
      onComplete(result);
    } catch (submitError) {
      setError(readableError(submitError, "Request failed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardOnboardingLayout
      activeProgressIndex={activeProgressIndex}
      canGoBack={canGoBack && !submitting && !loadingOptions}
      configPath={initialStatus.configPath}
      description={stepDescription(step)}
      error={error}
      loadingOptions={loadingOptions}
      message={message}
      onBack={goBack}
      onContinue={() => void advance()}
      onSignOut={onSignOut}
      primaryDisabled={submitting || loadingOptions || step === "update-key"}
      primaryLabel={submitButtonLabel(step, submitting)}
      showPrimarySaveIcon={step === "review"}
      stepContent={
        <DashboardOnboardingStepContent
          allowlistInput={allowlistInput}
          config={config}
          customRateLimitInput={customRateLimitInput}
          generatedPrivateKey={generatedPrivateKey}
          modelMode={modelMode}
          options={options}
          setAllowlistInput={setAllowlistInput}
          setConfig={setConfig}
          setCustomRateLimitInput={setCustomRateLimitInput}
          setGeneratedPrivateKey={setGeneratedPrivateKey}
          setModelMode={setModelMode}
          setStepWithReset={setStepWithReset}
          setUpdateSource={setUpdateSource}
          step={step}
          updateConfig={updateConfig}
          updateModel={updateModel}
          updateSource={updateSource}
          onCopyGeneratedKey={() => void copyGeneratedKey()}
          onGenerateKeyPair={() => void generateKeyPair()}
        />
      }
      title={stepTitle(step)}
    />
  );
}

function previousStep(step: Step, config: RuntimeJsonConfig): Step | null {
  const previous = previousStepFor(step, {
    webEnabled: config.models.web.enabled,
    updateKeyRequired: config.updates.githubRepo !== "aripabot/aripa",
    updatesEnabled: config.updates.enabled,
  });

  return previous === "existing-config" || previous === "done" ? null : previous;
}
