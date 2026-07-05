import { InputRenderableEvents, type SelectOption } from "@opentui/core";
import { fileURLToPath } from "node:url";

import {
  buildRuntimeConfig,
  generateReleaseSigningKeyPair,
  loadExistingRuntimeConfig,
  parseAgentRateLimitInput,
  parseAllowlistedServerIds,
  validateGitHubRepo,
  validateAgentRateLimitMessagesPerMinute,
  validateAllowlistedServerIds,
  validateOperatorUserId,
  writeRuntimeConfig,
} from "@aripabot/core/config/onboarding.ts";
import { DEFAULT_RUNTIME_CONFIG } from "@aripabot/core/config/config.ts";
import {
  AUTO_UPDATE_CRON_PRESETS,
  installAutoUpdateCron,
  removeAutoUpdateCron,
} from "@aripabot/core/update/release-updater.ts";
import type { OnboardingModelRole } from "@aripabot/core/onboarding-models.ts";
import {
  createInitialOnboardingState,
  initialStepForState,
} from "@aripabot/core/onboarding-wizard/state.ts";
import {
  defaultModelForProvider,
  loadWizardModelOptions,
  modelOptionsForProvider,
  selectableProvidersFromModelOptions,
  selectedModelIndex,
} from "@aripabot/core/onboarding-wizard/model-options.ts";
import { RATE_LIMIT_PRESET_OPTIONS } from "@aripabot/core/onboarding-wizard/display.ts";
import {
  formatRateLimitInputValue,
  previousStepFor,
  rateLimitPresetIndex,
  stepIndex,
} from "@aripabot/core/onboarding-wizard/navigation.ts";
import { providerDisplayFor } from "@aripabot/core/onboarding-wizard/provider-display.ts";
import {
  loadStylePrompts,
  stylePromptDescription,
} from "@aripabot/core/onboarding-wizard/style-prompts.ts";
import { colors } from "@aripabot/core/onboarding-wizard/theme.ts";
import type {
  ConfigurableProvider,
  MinimalKeyEvent,
  OnboardingState,
  Step,
} from "@aripabot/core/onboarding-wizard/types.ts";
import { createSelectControlFactory, createWizardShell, isExitKey } from "./tui/kit.ts";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG_PATH = Bun.env.CONFIG_PATH?.trim() || new URL("../../../config.json", import.meta.url);

const existingConfig = await loadExistingRuntimeConfig(CONFIG_PATH);
const state: OnboardingState = createInitialOnboardingState(CONFIG_PATH, existingConfig);

let step: Step = initialStepForState(state);
let generatedPrivateKeySecret: string | null = null;
let generatedKeyMessage: string | null = null;

const STYLE_PROMPTS = await loadStylePrompts(state.stylePrompt);
const MODEL_OPTIONS = await loadWizardModelOptions();
const SELECTABLE_MODEL_PROVIDERS = selectableProvidersFromModelOptions(MODEL_OPTIONS);
const shell = createWizardShell({
  backgroundColor: colors.background,
  exitOutput: () => "No changes made.",
  rendererName: "Onboarding",
  onKeyPress: handleKeyPress,
});
const { Box, Text, Input, Select, controls } = shell;
const selectControl = createSelectControlFactory({ Select, controls, colors });

try {
  await shell.start(render);
} catch (error) {
  shell.destroy();
  throw error;
}

function render(): void {
  shell.renderFrame(header(), body(), footer());
}

function header() {
  return Box(
    {
      width: "100%",
      height: 4,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.accent,
      backgroundColor: colors.panel,
      paddingX: 2,
      paddingY: 1,
      flexDirection: "column",
    },
    Text({ content: "Configure Aripa", fg: colors.accent, attributes: 1 }),
  );
}

function body() {
  return Box(
    {
      width: "100%",
      flexGrow: 1,
      flexDirection: "row",
      gap: 2,
    },
    stepRail(),
    Box(
      {
        flexGrow: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: colors.border,
        backgroundColor: colors.panelMuted,
        paddingX: 2,
        paddingY: 1,
        flexDirection: "column",
        gap: 1,
      },
      ...stepContent(),
    ),
  );
}

function stepRail() {
  const steps: Array<[Step, string]> = [
    ["name", "Name"],
    ["operator", "Operator"],
    ["style", "Style"],
    ["servers", "Servers"],
    ["rate-limit", "Rate limit"],
    ["log-privacy", "Log privacy"],
    ["models", "Models"],
    ["update-source", "Updates"],
    ["review", "Review"],
  ];

  return Box(
    {
      width: 22,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      backgroundColor: colors.panel,
      paddingX: 1,
      paddingY: 1,
      flexDirection: "column",
      gap: 1,
    },
    Text({ content: "Progress", fg: colors.muted }),
    ...steps.map(([stepName, label], index) => {
      const active = stepName === step;
      const completed = stepIndex(stepName) < stepIndex(step);
      const marker = active ? ">" : completed ? "x" : "-";
      const color = active ? colors.accent : completed ? colors.success : colors.dim;
      return Text({ content: `${marker} ${index + 1}. ${label}`, fg: color });
    }),
  );
}

function stepContent() {
  const errorLine = state.error ? [Text({ content: state.error, fg: colors.danger })] : [];

  switch (step) {
    case "existing-config":
      return [
        Text({ content: "Existing config found", fg: colors.warning, attributes: 1 }),
        selectControl(
          [
            {
              name: "Update config.json",
              description: "Keep unknown fields and replace onboarding fields.",
              value: "update",
            },
            { name: "Exit", description: "Leave the current file untouched.", value: "exit" },
          ],
          (option) => {
            if (option.value === "exit") {
              finish("No changes made.");
              return;
            }

            state.shouldWriteExistingConfig = true;
            step = "name";
            state.error = null;
            render();
          },
          6,
        ),
        ...errorLine,
      ];
    case "name":
      return [
        Text({
          content: "What should this bot instance call itself?",
          fg: colors.text,
          attributes: 1,
        }),
        Text({
          content: "This is injected into agent metadata. Press Enter to keep the default.",
          fg: colors.muted,
        }),
        inputControl(state.name, "Aripa", (value) => {
          state.name = value.trim() || "Aripa";
          state.error = null;
          step = "operator";
          render();
        }),
        ...errorLine,
      ];
    case "operator":
      return [
        Text({
          content: "Set the operator Discord user ID",
          fg: colors.text,
          attributes: 1,
        }),
        Text({
          content:
            "This identifies the person responsible for this bot instance and does not grant server permissions.",
          fg: colors.muted,
        }),
        Text({
          content: "Leave blank if this instance has no operator yet.",
          fg: colors.muted,
        }),
        inputControl(state.operatorUserId ?? "", "123456789012345678", (value) => {
          const operatorUserId = value.trim() || null;
          const validationError = validateOperatorUserId(operatorUserId);
          if (validationError) {
            state.error = validationError;
            render();
            return;
          }

          state.operatorUserId = operatorUserId;
          state.error = null;
          step = "style";
          render();
        }),
        ...errorLine,
      ];
    case "style":
      return [
        Text({ content: "Choose the agent style prompt", fg: colors.text, attributes: 1 }),
        Text({
          content: "Choose the voice Aripa uses when responding as an agent.",
          fg: colors.muted,
        }),
        selectControl(
          STYLE_PROMPTS.map((stylePrompt) => ({
            name: stylePrompt,
            description: stylePromptDescription(stylePrompt),
            value: stylePrompt,
          })),
          (option) => {
            state.stylePrompt = String(option.value || "match");
            state.error = null;
            step = "servers";
            render();
          },
          10,
          STYLE_PROMPTS.indexOf(state.stylePrompt),
        ),
        ...errorLine,
      ];
    case "servers":
      return [
        Text({
          content: "Allowlist at least one Discord server ID",
          fg: colors.text,
          attributes: 1,
        }),
        Text({
          content:
            "Use commas, spaces, or new lines between IDs. Only allowlisted guilds get prefix commands or mentions.",
          fg: colors.muted,
        }),
        inputControl(state.allowlistedServerIds.join(", "), "123456789012345678", (value) => {
          const ids = parseAllowlistedServerIds(value);
          const validationError = validateAllowlistedServerIds(ids);
          if (validationError) {
            state.error = validationError;
            render();
            return;
          }

          state.allowlistedServerIds = ids;
          state.error = null;
          step = "rate-limit";
          render();
        }),
        ...errorLine,
      ];
    case "rate-limit":
      return [
        Text({
          content: "Choose the per-user agent mention rate limit",
          fg: colors.text,
          attributes: 1,
        }),
        Text({
          content:
            "This limits paid AI mention requests per user, per server, in a 60 second window.",
          fg: colors.muted,
        }),
        selectControl(
          RATE_LIMIT_PRESET_OPTIONS.map((option) => ({
            name: option.label,
            description: option.description,
            value: option.value,
          })),
          (option) => {
            const value = String(option.value);

            if (value === "custom") {
              state.error = null;
              step = "rate-limit-custom";
              render();
              return;
            }

            state.agentRateLimitMessagesPerMinute = value === "off" ? null : Number(value);
            state.error = null;
            step = "log-privacy";
            render();
          },
          10,
          rateLimitPresetIndex(state.agentRateLimitMessagesPerMinute),
        ),
        ...errorLine,
      ];
    case "rate-limit-custom":
      return [
        Text({ content: "Enter a custom per-user rate limit", fg: colors.text, attributes: 1 }),
        Text({
          content: "Use a whole number of messages per minute, or type off to disable it.",
          fg: colors.muted,
        }),
        inputControl(
          formatRateLimitInputValue(state.agentRateLimitMessagesPerMinute),
          "12",
          (value) => {
            const parsed = parseAgentRateLimitInput(value);
            if (parsed === "invalid") {
              state.error = "Enter a whole number greater than 0, or off.";
              render();
              return;
            }

            const validationError = validateAgentRateLimitMessagesPerMinute(parsed);
            if (validationError) {
              state.error = validationError;
              render();
              return;
            }

            state.agentRateLimitMessagesPerMinute = parsed;
            state.error = null;
            step = "log-privacy";
            render();
          },
        ),
        ...errorLine,
      ];
    case "log-privacy":
      return [
        Text({ content: "Enable Log Privacy?", fg: colors.text, attributes: 1 }),
        Text({
          content: "When enabled, agent tool inputs and outputs are redacted from logs.",
          fg: colors.muted,
        }),
        Text({
          content: "This is best used when shipping logs to a hosted service.",
          fg: colors.muted,
        }),
        selectControl(
          [
            {
              name: "Off",
              description: "Keep detailed tool logs for local debugging. Default.",
              value: "off",
            },
            {
              name: "On",
              description: "Hide channel context and tool payloads from logs.",
              value: "on",
            },
          ],
          (option) => {
            state.logPrivacy = option.value === "on";
            state.error = null;
            step = "models";
            render();
          },
          6,
          state.logPrivacy ? 1 : 0,
        ),
        ...errorLine,
      ];
    case "models":
      return [
        Text({ content: "Configure AI models", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "Keep defaults or choose providers and models for the agent, summarizer, and web search.",
          fg: colors.muted,
        }),
        selectControl(
          [
            { name: "Keep defaults", description: defaultModelSummary(), value: "defaults" },
            {
              name: "Customize",
              description: "Pick providers, models, and whether web search is enabled.",
              value: "customize",
            },
          ],
          (option) => {
            state.error = null;
            step = option.value === "customize" ? "agent-provider" : "update-source";
            render();
          },
          6,
        ),
        ...errorLine,
      ];
    case "agent-provider":
      return [
        Text({ content: "Choose the main agent provider", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "The main agent must support tool calls for context, web search, and bot actions.",
          fg: colors.muted,
        }),
        selectProviderControl(state.models.agent.provider as ConfigurableProvider, (provider) => {
          state.models.agent.provider = provider;
          state.models.agent.model = defaultModelForProvider(MODEL_OPTIONS, provider, "agent");
          state.error = null;
          step = "agent-model";
          render();
        }),
        ...errorLine,
      ];
    case "agent-model":
      return [
        Text({ content: "Choose the main agent model", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "Listed models are known or discovered tool-call candidates. You can edit config.json later for a custom model.",
          fg: colors.muted,
        }),
        selectModelControl(
          state.models.agent.provider as ConfigurableProvider,
          "agent",
          state.models.agent.model,
          (model) => {
            state.models.agent.model = model;
            state.error = null;
            step = "summarizer-provider";
            render();
          },
        ),
        ...errorLine,
      ];
    case "summarizer-provider":
      return [
        Text({ content: "Choose the context summarizer provider", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "The summarizer handles long Discord context windows and does not need tool calling.",
          fg: colors.muted,
        }),
        selectProviderControl(
          state.models.summarizer.provider as ConfigurableProvider,
          (provider) => {
            state.models.summarizer.provider = provider;
            state.models.summarizer.model = defaultModelForProvider(
              MODEL_OPTIONS,
              provider,
              "summarizer",
            );
            state.error = null;
            step = "summarizer-model";
            render();
          },
        ),
        ...errorLine,
      ];
    case "summarizer-model":
      return [
        Text({ content: "Choose the context summarizer model", fg: colors.text, attributes: 1 }),
        Text({ content: "Smaller, cheaper models usually work well here.", fg: colors.muted }),
        selectModelControl(
          state.models.summarizer.provider as ConfigurableProvider,
          "summarizer",
          state.models.summarizer.model,
          (model) => {
            state.models.summarizer.model = model;
            state.error = null;
            step = "web-capability";
            render();
          },
        ),
        ...errorLine,
      ];
    case "web-capability":
      return [
        Text({ content: "Enable grounded web search?", fg: colors.text, attributes: 1 }),
        Text({
          content: "Web search always uses Google Generative AI with a Gemini model.",
          fg: colors.muted,
        }),
        selectControl(
          [
            {
              name: "On",
              description: "Register search_web and inject web capability instructions.",
              value: "on",
            },
            {
              name: "Off",
              description: "Do not register search_web; inject no-web instructions.",
              value: "off",
            },
          ],
          (option) => {
            state.models.web.enabled = option.value !== "off";
            state.error = null;
            step = state.models.web.enabled ? "web-model" : "update-source";
            render();
          },
          6,
          state.models.web.enabled ? 0 : 1,
        ),
        ...errorLine,
      ];
    case "web-model":
      return [
        Text({ content: "Choose the Gemini web-search model", fg: colors.text, attributes: 1 }),
        Text({
          content: "Only Gemini models that support Grounding with Google Search are listed.",
          fg: colors.muted,
        }),
        selectControl(
          MODEL_OPTIONS.web.map((option) => ({
            name: option.name,
            description: option.description,
            value: option.value,
          })),
          (option) => {
            state.models.web.model = String(
              option.value || DEFAULT_RUNTIME_CONFIG.models.web.model,
            );
            state.error = null;
            step = "update-source";
            render();
          },
          9,
          selectedModelIndex(MODEL_OPTIONS.web, state.models.web.model),
        ),
        ...errorLine,
      ];
    case "update-source":
      return [
        Text({ content: "Choose the update source", fg: colors.text, attributes: 1 }),
        Text({
          content: "Forks should point this at their own GitHub release repository.",
          fg: colors.muted,
        }),
        selectControl(
          [
            {
              name: "Official Aripa",
              description: `Use ${DEFAULT_RUNTIME_CONFIG.updates.githubRepo}.`,
              value: "official",
            },
            {
              name: "Custom repository",
              description: "Enter an owner/repo release source for this fork.",
              value: "custom",
            },
            {
              name: "Disabled",
              description: "Keep bun run update unavailable for this instance.",
              value: "disabled",
            },
          ],
          (option) => {
            const value = String(option.value);

            if (value === "disabled") {
              state.updates.enabled = false;
              state.updates.autoInstall.enabled = false;
              state.error = null;
              step = "review";
              render();
              return;
            }

            state.updates.enabled = true;
            if (value === "official") {
              state.updates.githubRepo = DEFAULT_RUNTIME_CONFIG.updates.githubRepo;
              delete state.updates.releasePublicKeyPem;
              delete state.updates.releasePublicKeyPemBase64;
              generatedPrivateKeySecret = null;
              generatedKeyMessage = null;
              state.error = null;
              step = "update-schedule";
              render();
              return;
            }

            state.error = null;
            step = "update-repo";
            render();
          },
          7,
          updateSourceIndex(),
        ),
        ...errorLine,
      ];
    case "update-repo":
      return [
        Text({ content: "Enter the GitHub update repository", fg: colors.text, attributes: 1 }),
        Text({
          content: "Use owner/repo format. The updater reads published releases from this repo.",
          fg: colors.muted,
        }),
        inputControl(state.updates.githubRepo, "owner/repo", (value) => {
          const githubRepo = value.trim();
          const validationError = validateGitHubRepo(githubRepo);
          if (validationError) {
            state.error = validationError;
            render();
            return;
          }

          state.updates.enabled = true;
          state.updates.githubRepo = githubRepo;
          state.error = null;
          step = "update-key";
          render();
        }),
        ...errorLine,
      ];
    case "update-key":
      return [
        Text({ content: "Set up release signing", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "The updater needs a public key. GitHub Actions needs the matching private key secret.",
          fg: colors.muted,
        }),
        Text({
          content: "The wizard never writes the private key to config.json.",
          fg: colors.muted,
        }),
        selectControl(
          [
            {
              name: "Generate new signing keypair",
              description: "Set the public key in config and show the GitHub Actions secret.",
              value: "generate",
            },
            {
              name: "Paste existing public key",
              description: "Use a base64 public PEM from an existing signing keypair.",
              value: "paste",
            },
            {
              name: "Use environment variable",
              description: "Leave config empty and require ARIPA_RELEASE_PUBLIC_KEY_PEM_B64.",
              value: "env",
            },
          ],
          (option) => {
            const value = String(option.value);

            if (value === "generate") {
              const keyPair = generateReleaseSigningKeyPair();
              state.updates.releasePublicKeyPemBase64 = keyPair.publicKeyPemBase64;
              delete state.updates.releasePublicKeyPem;
              generatedPrivateKeySecret = keyPair.privateKeyPemBase64;
              generatedKeyMessage = null;
              state.error = null;
              step = "update-key-generated";
              render();
              return;
            }

            if (value === "paste") {
              state.error = null;
              step = "update-key-paste";
              render();
              return;
            }

            delete state.updates.releasePublicKeyPem;
            delete state.updates.releasePublicKeyPemBase64;
            generatedPrivateKeySecret = null;
            generatedKeyMessage = null;
            state.error = null;
            step = "update-schedule";
            render();
          },
          7,
        ),
        ...errorLine,
      ];
    case "update-key-paste":
      return [
        Text({ content: "Paste release verification public key", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "Use the base64-encoded public PEM. The matching private key belongs in GitHub Actions.",
          fg: colors.muted,
        }),
        Text({
          content: "Leave blank only if this machine sets ARIPA_RELEASE_PUBLIC_KEY_PEM_B64.",
          fg: colors.muted,
        }),
        inputControl(
          state.updates.releasePublicKeyPemBase64 ?? "",
          "optional base64 public key",
          (value) => {
            const key = value.trim();
            delete state.updates.releasePublicKeyPem;
            generatedPrivateKeySecret = null;
            generatedKeyMessage = null;
            if (key) {
              state.updates.releasePublicKeyPemBase64 = key;
            } else {
              delete state.updates.releasePublicKeyPemBase64;
            }

            state.error = null;
            step = "update-schedule";
            render();
          },
        ),
        ...errorLine,
      ];
    case "update-key-generated":
      return [
        Text({ content: "Generated signing keypair", fg: colors.text, attributes: 1 }),
        Text({
          content: "Public key has been added to config.json as updates.releasePublicKeyPemBase64.",
          fg: colors.success,
        }),
        Text({
          content: "Create this GitHub Actions repository secret:",
          fg: colors.muted,
        }),
        Text({
          content: "ARIPA_RELEASE_PRIVATE_KEY_PEM_B64",
          fg: colors.accent,
          attributes: 1,
        }),
        Box(
          {
            width: "100%",
            border: true,
            borderStyle: "rounded",
            borderColor: colors.border,
            backgroundColor: colors.panel,
            paddingX: 1,
            paddingY: 1,
          },
          Text({
            content: generatedPrivateKeySecret ?? "No generated private key is available.",
            fg: colors.text,
            wrapMode: "word",
          }),
        ),
        ...(generatedKeyMessage ? [Text({ content: generatedKeyMessage, fg: colors.muted })] : []),
        selectControl(
          [
            {
              name: "Copy secret value",
              description: "Copy the private key secret value to your clipboard.",
              value: "copy",
            },
            {
              name: "Continue",
              description: "Choose automatic update behavior.",
              value: "continue",
            },
            {
              name: "Regenerate",
              description: "Replace this keypair with a new one.",
              value: "regenerate",
            },
          ],
          (option) => {
            void handleGeneratedKeySelection(String(option.value));
          },
          7,
        ),
        ...errorLine,
      ];
    case "update-schedule":
      return [
        Text({ content: "Choose automatic update installation", fg: colors.text, attributes: 1 }),
        Text({
          content: "These presets are for a cron job that runs bun run update --latest.",
          fg: colors.muted,
        }),
        selectControl(
          [
            {
              name: "Disabled",
              description: "Only install updates when bun run update is run manually.",
              value: "disabled",
            },
            ...AUTO_UPDATE_CRON_PRESETS.map((preset) => ({
              name: preset.name,
              description: `${preset.cronExpression} - ${preset.description}`,
              value: preset.id,
            })),
          ],
          (option) => {
            const value = String(option.value);

            if (value === "disabled") {
              state.updates.autoInstall.enabled = false;
              state.error = null;
              step = "review";
              render();
              return;
            }

            const preset = AUTO_UPDATE_CRON_PRESETS.find((candidate) => candidate.id === value);
            if (!preset) {
              state.error = "Choose a valid automatic update schedule.";
              render();
              return;
            }

            state.updates.autoInstall = {
              enabled: true,
              preset: preset.id,
              cronExpression: preset.cronExpression,
            };
            state.error = null;
            step = "review";
            render();
          },
          8,
          autoUpdateScheduleIndex(),
        ),
        ...errorLine,
      ];
    case "review":
      return [
        Text({ content: "Review config.json", fg: colors.text, attributes: 1 }),
        Box(
          {
            width: "100%",
            border: true,
            borderStyle: "rounded",
            borderColor: colors.border,
            backgroundColor: colors.panel,
            paddingX: 1,
            paddingY: 1,
          },
          Text({
            content: JSON.stringify(buildRuntimeConfig(state, state.existingConfig ?? {}), null, 2),
            fg: colors.text,
            wrapMode: "word",
          }),
        ),
        selectControl(
          [
            {
              name: "Write config.json",
              description: "Save this runtime configuration.",
              value: "write",
            },
            {
              name: "Back to updates",
              description: "Change update source or automatic schedule before writing.",
              value: "back",
            },
            { name: "Exit", description: "Leave without writing.", value: "exit" },
          ],
          (option) => {
            void handleReviewSelection(String(option.value));
          },
          7,
        ),
        ...errorLine,
      ];
    case "done":
      return [Text({ content: "Done.", fg: colors.success })];
  }
}

function footer() {
  return Box(
    {
      width: "100%",
      height: 3,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      backgroundColor: colors.panel,
      paddingX: 2,
    },
    Text({
      content: footerText(),
      fg: colors.muted,
    }),
  );
}

function inputControl(value: string, placeholder: string, onSubmit: (value: string) => void) {
  const input = Input({
    value,
    placeholder,
    width: "100%",
    maxLength: 500,
    backgroundColor: colors.input,
    textColor: colors.text,
    focusedBackgroundColor: colors.input,
    focusedTextColor: colors.text,
    placeholderColor: colors.dim,
  });
  input.on(InputRenderableEvents.ENTER, (submittedValue: string) => onSubmit(submittedValue));
  controls.registerInput(input);

  return Box(
    {
      width: "100%",
      height: 3,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.focus,
      paddingX: 1,
      paddingY: 1,
      backgroundColor: colors.input,
    },
    input,
  );
}

async function handleGeneratedKeySelection(value: string): Promise<void> {
  if (value === "continue") {
    generatedKeyMessage = null;
    state.error = null;
    step = "update-schedule";
    render();
    return;
  }

  if (value === "regenerate") {
    const keyPair = generateReleaseSigningKeyPair();
    state.updates.releasePublicKeyPemBase64 = keyPair.publicKeyPemBase64;
    delete state.updates.releasePublicKeyPem;
    generatedPrivateKeySecret = keyPair.privateKeyPemBase64;
    generatedKeyMessage =
      "Generated a new keypair. The previous private key value is no longer used.";
    state.error = null;
    render();
    return;
  }

  if (value === "copy") {
    if (!generatedPrivateKeySecret) {
      generatedKeyMessage = "No generated private key is available to copy.";
      render();
      return;
    }

    const copied = await copyToClipboard(generatedPrivateKeySecret);
    generatedKeyMessage = copied
      ? "Copied private key secret value to clipboard."
      : "Clipboard copy failed. Use the displayed secret value instead.";
    render();
  }
}

async function handleReviewSelection(value: string): Promise<void> {
  if (value === "back") {
    step = state.updates.enabled ? "update-schedule" : "update-source";
    state.error = null;
    render();
    return;
  }

  if (value === "exit") {
    finish("No changes made.");
    return;
  }

  try {
    const result = await writeRuntimeConfig({
      pathOrUrl: state.configPath,
      input: state,
      overwrite: state.shouldWriteExistingConfig || state.existingConfig === null,
    });
    const cronMessage = await syncAutoUpdateCron();
    finish(`${result.existed ? "Updated" : "Created"} ${result.path}.${cronMessage}`);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function syncAutoUpdateCron(): Promise<string> {
  if (!state.updates.enabled || !state.updates.autoInstall.enabled) {
    await removeAutoUpdateCron();
    return " Automatic update cron is disabled.";
  }

  await installAutoUpdateCron({
    cwd: repositoryRoot,
    configPath: state.configPath,
    cronExpression: state.updates.autoInstall.cronExpression,
  });
  return ` Automatic update cron installed for ${state.updates.autoInstall.cronExpression}.`;
}

function handleKeyPress(key: MinimalKeyEvent): boolean {
  if (isExitKey(key)) {
    finish("No changes made.");
    return true;
  }

  if (key.name === "return" || key.name === "linefeed") {
    return controls.submitCurrent();
  }

  if (key.name === "up") {
    return controls.moveSelectUp();
  }

  if (key.name === "down") {
    return controls.moveSelectDown();
  }

  if (key.name === "left" && controls.currentKind === "select" && step !== "existing-config") {
    goBack();
    return true;
  }

  return false;
}

function goBack(): void {
  state.error = null;
  const previousStep = previousStepFor(step, {
    webEnabled: state.models.web.enabled,
    updateKeyRequired: isUpdateKeyRequired(),
    updatesEnabled: state.updates.enabled,
  });

  if (!previousStep) {
    return;
  }

  step = previousStep;
  render();
}

function finish(message: string): void {
  shell.finish(message);
}

function footerText(): string {
  if (controls.currentKind === "input") {
    return "Enter: continue | Esc/Ctrl+C: quit";
  }

  return "Up/Down: choose | Enter: select | Left: back | Esc/Ctrl+C: quit";
}

function selectProviderControl(
  selectedProvider: ConfigurableProvider,
  onSelected: (provider: ConfigurableProvider) => void,
) {
  const options: SelectOption[] = SELECTABLE_MODEL_PROVIDERS.map((provider) => ({
    ...providerDisplayFor(provider),
    value: provider,
  }));

  return selectControl(
    options,
    (option) => onSelected(String(option.value) as ConfigurableProvider),
    9,
    Math.max(
      0,
      options.findIndex((option) => option.value === selectedProvider),
    ),
  );
}

function selectModelControl(
  provider: ConfigurableProvider,
  role: OnboardingModelRole,
  selectedModel: string,
  onSelected: (model: string) => void,
) {
  const options = modelOptionsForProvider(MODEL_OPTIONS, provider, role, selectedModel);

  return selectControl(
    options.map((option) => ({
      name: option.name,
      description: option.description,
      value: option.value,
    })),
    (option) => onSelected(String(option.value || selectedModel)),
    10,
    selectedModelIndex(options, selectedModel),
  );
}

function defaultModelSummary(): string {
  const { models } = DEFAULT_RUNTIME_CONFIG;
  return `OpenAI ${models.agent.model}, OpenAI ${models.summarizer.model}, Gemini ${models.web.model} web.`;
}

function updateSourceIndex(): number {
  if (!state.updates.enabled) {
    return 2;
  }

  return state.updates.githubRepo === DEFAULT_RUNTIME_CONFIG.updates.githubRepo ? 0 : 1;
}

function autoUpdateScheduleIndex(): number {
  if (!state.updates.autoInstall.enabled) {
    return 0;
  }

  const presetIndex = AUTO_UPDATE_CRON_PRESETS.findIndex(
    (preset) => preset.id === state.updates.autoInstall.preset,
  );
  return presetIndex === -1 ? 0 : presetIndex + 1;
}

function isUpdateKeyRequired(): boolean {
  return (
    state.updates.enabled && state.updates.githubRepo !== DEFAULT_RUNTIME_CONFIG.updates.githubRepo
  );
}

async function copyToClipboard(value: string): Promise<boolean> {
  for (const command of clipboardCommands()) {
    try {
      const subprocess = Bun.spawn(command, {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      subprocess.stdin.write(value);
      subprocess.stdin.end();
      if ((await subprocess.exited) === 0) {
        return true;
      }
    } catch {
      // Try the next clipboard command for this platform.
    }
  }

  return false;
}

function clipboardCommands(): string[][] {
  switch (process.platform) {
    case "darwin":
      return [["pbcopy"]];
    case "win32":
      return [["clip.exe"]];
    default:
      return [["wl-copy"], ["xclip", "-selection", "clipboard"]];
  }
}
