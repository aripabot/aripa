"use client";

import { useEffect, useState } from "react";
import type * as React from "react";
import { LogOut, Save, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingProgress } from "@/components/dashboard/dashboard-onboarding-controls";
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
import type { Step as WizardStep } from "@aripabot/core/onboarding-wizard/types.ts";
import type {
  ConfigurableRuntimeModelProvider,
  RuntimeJsonConfig,
  RuntimeModelSelection,
} from "@aripabot/core/config/config.ts";

type Step = Exclude<WizardStep, "existing-config" | "done">;

type UpdateSource = "official" | "custom" | "disabled";

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
    <main id="main-content" className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[17rem_1fr]">
        <aside className="border-b bg-card/70 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-5 p-4">
            <div className="flex items-center gap-3">
              <picture>
                <img
                  src="/aripa-mark-light.svg"
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="size-10 rounded-lg dark:hidden"
                />
                <img
                  src="/aripa-mark-dark.svg"
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="hidden size-10 rounded-lg dark:block"
                />
              </picture>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Aripa</p>
                <p className="text-xs text-muted-foreground">First-Run Setup</p>
              </div>
            </div>

            <OnboardingProgress activeProgressIndex={activeProgressIndex} />

            <div className="mt-auto">
              <Button type="button" variant="outline" className="w-full" onClick={onSignOut}>
                <LogOut aria-hidden="true" />
                Sign Out
              </Button>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">No config.json was found.</p>
              <h1 className="text-2xl font-semibold tracking-normal text-pretty">
                Configure Aripa
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty"></p>
            </div>
            <div className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
              <span className="break-all">{initialStatus.configPath}</span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
                <Sparkles aria-hidden="true" />
              </div>
              <CardTitle>{stepTitle(step)}</CardTitle>
              <CardDescription>{stepDescription(step)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {loadingOptions ? (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Loading setup options…
                </p>
              ) : (
                renderStep()
              )}

              {error ? (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm" aria-live="polite">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm" aria-live="polite">
                  {message}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={goBack}
                  disabled={!canGoBack || submitting || loadingOptions}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => void advance()}
                  disabled={submitting || loadingOptions || step === "update-key"}
                >
                  {step === "review" ? <Save aria-hidden="true" /> : null}
                  {submitButtonLabel(step, submitting)}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );

  function renderStep(): React.ReactNode {
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
            onGenerate={() => void generateKeyPair()}
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
            onCopy={() => void copyGeneratedKey()}
            onRegenerate={() => void generateKeyPair()}
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

function previousStep(step: Step, config: RuntimeJsonConfig): Step | null {
  const previous = previousStepFor(step, {
    webEnabled: config.models.web.enabled,
    updateKeyRequired: config.updates.githubRepo !== "aripabot/aripa",
    updatesEnabled: config.updates.enabled,
  });

  return previous === "existing-config" || previous === "done" ? null : previous;
}

function defaultModelSummary(config: RuntimeJsonConfig): string {
  return `${config.models.agent.provider}/${config.models.agent.model}, ${config.models.summarizer.provider}/${config.models.summarizer.model}`;
}
