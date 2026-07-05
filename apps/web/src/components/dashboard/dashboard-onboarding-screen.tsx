"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import {
  CheckCircle2,
  Clipboard,
  KeyRound,
  LogOut,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { selectableProvidersFromModelOptions } from "@aripabot/core/onboarding-wizard/model-option-selection.ts";
import {
  previousStepFor,
  rateLimitPresetValue,
  stepIndex,
} from "@aripabot/core/onboarding-wizard/navigation.ts";
import type { Step as WizardStep } from "@aripabot/core/onboarding-wizard/types.ts";
import type {
  ConfigurableRuntimeModelProvider,
  RuntimeJsonConfig,
  RuntimeModelSelection,
} from "@aripabot/core/config/config.ts";

type Step = Exclude<WizardStep, "existing-config" | "done">;

type UpdateSource = "official" | "custom" | "disabled";

const progressSteps: Array<{ step: Step; label: string }> = [
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
        return (
          <Field label="Bot Name" htmlFor="onboarding-name">
            <Input
              id="onboarding-name"
              name="name"
              autoComplete="off"
              value={config.name}
              onChange={(event) => updateConfig({ name: event.target.value })}
              placeholder="Aripa…"
              required
            />
          </Field>
        );
      case "operator":
        return (
          <Field label="Operator User ID" htmlFor="onboarding-operator">
            <Input
              id="onboarding-operator"
              name="operator-user-id"
              autoComplete="off"
              inputMode="numeric"
              value={config.operatorUserId ?? ""}
              onChange={(event) =>
                updateConfig({ operatorUserId: event.target.value.trim() || null })
              }
              placeholder="Optional Discord user ID…"
              spellCheck={false}
            />
          </Field>
        );
      case "style":
        return (
          <Field label="Agent Style" htmlFor="onboarding-style">
            <Select
              value={config.stylePrompt}
              onValueChange={(value) => updateConfig({ stylePrompt: value })}
            >
              <SelectTrigger id="onboarding-style">
                <SelectValue placeholder="Choose a style" />
              </SelectTrigger>
              <SelectContent>
                {options.styles.map((style) => (
                  <SelectItem key={style.value} value={style.value}>
                    {style.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      case "servers":
        return (
          <Field label="Server Allowlist" htmlFor="onboarding-servers">
            <Textarea
              id="onboarding-servers"
              name="allowlisted-server-ids"
              autoComplete="off"
              value={allowlistInput}
              onChange={(event) => setAllowlistInput(event.target.value)}
              placeholder="123456789012345678…"
              spellCheck={false}
            />
          </Field>
        );
      case "rate-limit":
        return (
          <ChoiceList
            value={rateLimitPresetValue(config.agentRateLimitMessagesPerMinute)}
            onChange={(value) => {
              if (value === "custom") {
                setStepWithReset("rate-limit-custom");
                return;
              }
              updateConfig({
                agentRateLimitMessagesPerMinute: value === "off" ? null : Number(value),
              });
            }}
            options={[
              ["10", "Standard - 10/min", "Good default for regular server use."],
              ["20", "Relaxed - 20/min", "Most permissive preset before turning limits off."],
              ["5", "Moderate - 5/min", "Lower spend and less spam tolerance."],
              ["3", "Strict - 3/min", "Tightest preset for careful rollout."],
              ["custom", "Custom", "Enter any whole number of messages per minute."],
              ["off", "Off", "Disable agent mention rate limiting."],
            ]}
          />
        );
      case "rate-limit-custom":
        return (
          <Field label="Messages Per Minute" htmlFor="onboarding-rate-limit-custom">
            <Input
              id="onboarding-rate-limit-custom"
              name="agent-rate-limit-custom"
              autoComplete="off"
              inputMode="numeric"
              value={customRateLimitInput}
              onChange={(event) => setCustomRateLimitInput(event.target.value)}
              placeholder="12…"
            />
          </Field>
        );
      case "log-privacy":
        return (
          <SwitchField
            label="Private Logs"
            description="Hide channel context and tool payloads from logs."
            checked={config.logPrivacy}
            onCheckedChange={(logPrivacy) => updateConfig({ logPrivacy })}
          />
        );
      case "models":
        return (
          <ChoiceList
            value={modelMode}
            onChange={(value) => setModelMode(value as "defaults" | "customize")}
            options={[
              ["defaults", "Keep Defaults", defaultModelSummary(config)],
              ["customize", "Customize", "Pick providers, models, and web search behavior."],
            ]}
          />
        );
      case "agent-provider":
        return (
          <ProviderSelect
            id="onboarding-agent-provider"
            label="Agent Provider"
            providers={selectableProvidersFromModelOptions(
              options.modelOptions,
              config.models.agent.provider as ConfigurableRuntimeModelProvider,
            )}
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
          <ModelSelect
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
          <ProviderSelect
            id="onboarding-summarizer-provider"
            label="Summarizer Provider"
            providers={selectableProvidersFromModelOptions(
              options.modelOptions,
              config.models.summarizer.provider as ConfigurableRuntimeModelProvider,
            )}
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
          <ModelSelect
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
          <SwitchField
            label="Web Search"
            description="Register the search tool and use Gemini grounding."
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
          <ModelSelect
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
          <ChoiceList
            value={updateSource}
            onChange={(value) => setUpdateSource(value as UpdateSource)}
            options={[
              ["official", "Official Aripa", `Use ${options.defaultUpdateRepo}.`],
              ["custom", "Custom Repository", "Enter an owner/repo release source for this fork."],
              ["disabled", "Disabled", "Keep manual and automatic updater commands unavailable."],
            ]}
          />
        );
      case "update-repo":
        return (
          <Field label="GitHub Repository" htmlFor="onboarding-update-repo">
            <Input
              id="onboarding-update-repo"
              name="update-repository"
              autoComplete="off"
              value={config.updates.githubRepo}
              onChange={(event) =>
                setConfig({
                  ...config,
                  updates: { ...config.updates, githubRepo: event.target.value },
                })
              }
              placeholder="owner/repo…"
              spellCheck={false}
            />
          </Field>
        );
      case "update-key":
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            <Button type="button" variant="outline" onClick={() => void generateKeyPair()}>
              <KeyRound aria-hidden="true" />
              Generate Keypair
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStepWithReset("update-key-paste")}
            >
              Paste Public Key
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const updates = { ...config.updates };
                delete updates.releasePublicKeyPem;
                delete updates.releasePublicKeyPemBase64;
                setConfig({ ...config, updates });
                setGeneratedPrivateKey(null);
                setStepWithReset("update-schedule");
              }}
            >
              Use Environment Variable
            </Button>
          </div>
        );
      case "update-key-paste":
        return (
          <Field label="Base64 Public Key" htmlFor="onboarding-release-key">
            <Textarea
              id="onboarding-release-key"
              name="release-public-key"
              autoComplete="off"
              value={config.updates.releasePublicKeyPemBase64 ?? ""}
              onChange={(event) => {
                const updates = { ...config.updates };
                delete updates.releasePublicKeyPem;
                const key = event.target.value.trim();
                setConfig({
                  ...config,
                  updates: {
                    ...updates,
                    ...(key ? { releasePublicKeyPemBase64: key } : {}),
                  },
                });
              }}
              placeholder="Optional base64 public key…"
              spellCheck={false}
            />
          </Field>
        );
      case "update-key-generated":
        return (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border bg-muted p-3">
              <p className="text-sm font-medium">ARIPA_RELEASE_PRIVATE_KEY_PEM_B64</p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {generatedPrivateKey}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => void copyGeneratedKey()}>
                <Clipboard aria-hidden="true" />
                Copy Secret Value
              </Button>
              <Button type="button" variant="outline" onClick={() => void generateKeyPair()}>
                Regenerate Keypair
              </Button>
            </div>
          </div>
        );
      case "update-schedule":
        return (
          <ChoiceList
            value={
              config.updates.autoInstall.enabled ? config.updates.autoInstall.preset : "disabled"
            }
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
            options={[
              [
                "disabled",
                "Disabled",
                "Only install updates when the update command is run manually.",
              ],
              ...options.autoUpdateCronPresets.map(
                (preset) =>
                  [preset.id, preset.name, `${preset.cronExpression} - ${preset.description}`] as [
                    string,
                    string,
                    string,
                  ],
              ),
            ]}
          />
        );
      case "review":
        return (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border bg-muted p-3">
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(
                  {
                    ...config,
                    allowlistedServerIds: parseAllowlistedServerIds(allowlistInput),
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
            <div className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
              <ShieldCheck aria-hidden="true" />
              <p className="text-muted-foreground">
                Saving writes config.json and applies the automatic update schedule.
              </p>
            </div>
          </div>
        );
    }
  }
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useMemo(() => label.toLowerCase().replace(/\s+/g, "-"), [label]);
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <Label htmlFor={id} className="grid gap-1">
        <span>{label}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ChoiceList({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string, string]>;
}) {
  return (
    <div className="grid gap-2">
      {options.map(([optionValue, label, description]) => {
        const active = optionValue === value;
        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={active}
            className="rounded-md border bg-background px-3 py-3 text-left transition-[border-color,background-color] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(optionValue)}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-1 block break-words text-xs text-muted-foreground">
                  {description}
                </span>
              </span>
              {active ? <CheckCircle2 aria-hidden="true" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProviderSelect({
  id,
  label,
  providers,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  providers: ConfigurableRuntimeModelProvider[];
  value: ConfigurableRuntimeModelProvider;
  onValueChange: (value: ConfigurableRuntimeModelProvider) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select
        value={value}
        onValueChange={(provider) => onValueChange(provider as ConfigurableRuntimeModelProvider)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose provider" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectItem key={provider} value={provider}>
              {provider}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function OnboardingProgress({ activeProgressIndex }: { activeProgressIndex: number }) {
  return (
    <nav aria-label="Onboarding progress" className="flex flex-col gap-1">
      {progressSteps.map((item, index) => {
        const itemProgressIndex = stepIndex(item.step);
        const active = itemProgressIndex === activeProgressIndex;
        const completed = itemProgressIndex < activeProgressIndex;
        return (
          <div
            key={item.step}
            aria-current={active ? "step" : undefined}
            className="flex h-10 items-center gap-3 rounded-md px-3 text-sm"
            data-active={active ? "" : undefined}
          >
            <span className="flex size-6 items-center justify-center rounded-md border bg-background text-xs text-muted-foreground">
              {completed ? <CheckCircle2 aria-hidden="true" /> : index + 1}
            </span>
            <span className="min-w-0 truncate font-medium">{item.label}</span>
          </div>
        );
      })}
    </nav>
  );
}

function ModelSelect({
  id,
  label,
  options,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  options: Array<{ name: string; description: string; value: string }>;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose model" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex flex-col gap-1">
                <span>{option.name}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
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

function stepTitle(step: Step): string {
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

function stepDescription(step: Step): string {
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

function submitButtonLabel(step: Step, submitting: boolean): string {
  if (submitting) {
    return step === "review" ? "Saving…" : "Working…";
  }

  return step === "review" ? "Write Config" : "Continue";
}

function defaultModelSummary(config: RuntimeJsonConfig): string {
  return `${config.models.agent.provider}/${config.models.agent.model}, ${config.models.summarizer.provider}/${config.models.summarizer.model}`;
}
