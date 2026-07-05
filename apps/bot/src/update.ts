import {
  SelectRenderable,
  SelectRenderableEvents,
  createCliRenderer,
  type BoxRenderable,
  type Renderable,
  type SelectOption,
} from "@opentui/core";
import { fileURLToPath } from "node:url";

import { colors } from "@aripabot/core/onboarding-wizard/theme.ts";
import { loadRuntimeJsonConfig } from "@aripabot/core/config/config.ts";
import {
  DEFAULT_GITHUB_REPO,
  DEFAULT_RELEASE_PUBLIC_KEY_PEM_B64,
  applyLatestReleaseUpdate,
  applyReleaseUpdate,
  fetchGitHubReleases,
  formatReleaseDate,
  formatReleaseName,
  type GitHubRelease,
} from "@aripabot/core/update/release-updater.ts";
import type { MinimalKeyEvent } from "@aripabot/core/onboarding-wizard/types.ts";
import {
  clearRendererRoot,
  createRenderableFactories,
  isExitKey,
  parseMinimalKey,
  TuiControlState,
  type CliRenderer,
} from "./tui/kit.ts";

type View = "loading" | "select" | "confirm" | "updating" | "done" | "error";

const dockerContainerName = "aripabot-docker";
const spinnerFrames = ["-", "\\", "|", "/"];
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  version?: string;
};
const currentVersion = packageJson.version ?? "unknown";
const runtimeConfig = await loadRuntimeJsonConfig();
const updateConfig = {
  ...runtimeConfig.updates,
  githubRepo:
    Bun.env.ARIPA_UPDATE_GITHUB_REPO?.trim() ||
    runtimeConfig.updates.githubRepo ||
    DEFAULT_GITHUB_REPO,
};
const isOfficialUpdateRepo = updateConfig.githubRepo === DEFAULT_GITHUB_REPO;
const dryRunUpdates = Bun.env.DRY_RUN_UPDATES?.trim() === "true";
const updateLatest = Bun.argv.slice(2).includes("--latest");

let renderer: CliRenderer | null = null;
const controls = new TuiControlState();
let rawExitHandler: ((chunk: Buffer | string) => void) | null = null;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let finished = false;

let view: View = "loading";
let releases: GitHubRelease[] = [];
let selectedRelease: GitHubRelease | null = null;
let message = "Scanning GitHub releases...";
let errorMessage: string | null = null;
let detectedDefaultDockerContainer = false;
let spinnerIndex = 0;
const { Box, Text, Select } = createRenderableFactories(requireRenderer);

if (updateLatest) {
  await runLatestUpdate();
  process.exit(0);
}

try {
  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    backgroundColor: colors.background,
    openConsoleOnError: false,
    prependInputHandlers: [
      (sequence) => {
        const key = parseMinimalKey(sequence);
        return key ? handleKeyPress(key) : false;
      },
    ],
  });

  rawExitHandler = handleRawExitInput;
  renderer.stdin.prependListener("data", rawExitHandler);
  render();
  void detectDefaultDockerContainer();
  void loadReleases();
} catch (error) {
  renderer?.destroy();
  throw error;
}

async function runLatestUpdate(): Promise<void> {
  try {
    if (!updateConfig.enabled) {
      throw new Error("Updates are disabled in config.json.");
    }

    if (dryRunUpdates) {
      const wouldRedeployDocker = await isDefaultDockerContainerRunning();
      console.log(
        wouldRedeployDocker
          ? "Dry run: would fetch and install the latest release, then redeploy Docker."
          : "Dry run: would fetch and install the latest release.",
      );
      return;
    }

    const result = await applyLatestReleaseUpdate({
      cwd: repositoryRoot,
      repo: updateConfig.githubRepo,
      token: Bun.env.GITHUB_TOKEN?.trim() || null,
      installDependencies: true,
      releasePublicKeyPem: updateConfig.releasePublicKeyPem,
      releasePublicKeyPemBase64:
        updateConfig.releasePublicKeyPemBase64 ||
        (isOfficialUpdateRepo ? DEFAULT_RELEASE_PUBLIC_KEY_PEM_B64 : undefined),
      onProgress: (progress) => {
        console.log(progress);
      },
    });
    const redeployDocker = await isDefaultDockerContainerRunning();
    if (redeployDocker) {
      console.log("Redeploying Docker container...");
      await redeployDockerContainer(result.updatedPath);
    }

    console.log(
      updateSuccessMessage({
        release: result.release,
        redeployDocker,
        updatedPath: result.updatedPath,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function loadReleases(): Promise<void> {
  view = "loading";
  message = "Scanning GitHub releases...";
  errorMessage = null;
  render();

  try {
    if (!updateConfig.enabled) {
      throw new Error("Updates are disabled in config.json.");
    }

    releases = await fetchGitHubReleases({
      repo: updateConfig.githubRepo,
      token: Bun.env.GITHUB_TOKEN?.trim() || null,
    });
    selectedRelease = releases[0] ?? null;
    view = releases.length > 0 ? "select" : "error";
    errorMessage = releases.length > 0 ? null : "No published releases were found.";
  } catch (error) {
    view = "error";
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  render();
}

function render(): void {
  if (!renderer || finished) {
    return;
  }

  clearRendererRoot(renderer);
  controls.reset();

  renderer.root.add(
    Box(
      {
        width: "100%",
        height: "100%",
        backgroundColor: colors.background,
        paddingX: 2,
        paddingY: 1,
        flexDirection: "column",
        gap: 1,
      },
      header(),
      body(),
      footer(),
    ),
  );

  controls.focus();
  renderer.requestRender();
}

function requireRenderer(): CliRenderer {
  if (!renderer) {
    throw new Error("Update renderer has not been created.");
  }

  return renderer;
}

function header() {
  return Box(
    {
      width: "100%",
      height: 6,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.accent,
      backgroundColor: colors.panel,
      paddingX: 2,
      paddingY: 1,
      flexDirection: "column",
    },
    Text({ content: "Update Aripa", fg: colors.accent, attributes: 1 }),
    Text({ content: `Current package version: ${currentVersion}`, fg: colors.muted }),
  );
}

function body(): BoxRenderable {
  return Box(
    {
      width: "100%",
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
    ...viewContent(),
  );
}

function viewContent(): Renderable[] {
  switch (view) {
    case "loading":
      return [
        Text({ content: message, fg: colors.text, attributes: 1 }),
        Text({ content: `Repository: ${updateConfig.githubRepo}`, fg: colors.muted }),
      ];
    case "select":
      return [
        Text({ content: "Choose a release", fg: colors.text, attributes: 1 }),
        Text({
          content:
            "Releases are listed newest to oldest. Pre-releases are marked before confirmation.",
          fg: colors.muted,
        }),
        selectControl(
          releaseOptions(),
          handleReleaseSelection,
          Math.min(16, Math.max(6, releases.length + 2)),
        ),
      ];
    case "confirm":
      return selectedRelease
        ? confirmContent(selectedRelease)
        : errorContent("No release is selected.");
    case "updating":
      return [
        Text({
          content: selectedRelease
            ? `Updating to ${formatReleaseName(selectedRelease)}`
            : "Updating",
          fg: colors.text,
          attributes: 1,
        }),
        Text({ content: `${spinner()} ${message}`, fg: colors.muted }),
        Text({
          content: "Do not stop this process while files are being replaced.",
          fg: colors.warning,
        }),
      ];
    case "done":
      return [
        Text({ content: message, fg: colors.success, attributes: 1 }),
        Text({ content: "Press Enter, Esc, or Ctrl+C to exit.", fg: colors.muted }),
      ];
    case "error":
      return errorContent(errorMessage ?? "Unknown update error.");
  }
}

function confirmContent(release: GitHubRelease): Renderable[] {
  const warning = release.prerelease
    ? [
        Text({
          content: "This is a pre-release. It may be less stable than a normal release.",
          fg: colors.warning,
        }),
      ]
    : [];

  return [
    Text({
      content: `Confirm update to ${formatReleaseName(release)}`,
      fg: colors.text,
      attributes: 1,
    }),
    Text({ content: release.name, fg: colors.text }),
    Text({
      content: `Published ${formatReleaseDate(release.publishedAt)} | ${release.htmlUrl}`,
      fg: colors.muted,
    }),
    ...warning,
    Text({
      content: "Local config, env files, SQLite databases, node_modules, and .git are preserved.",
      fg: colors.muted,
    }),
    selectControl(confirmOptions(), handleConfirmSelection, 7),
  ];
}

function errorContent(error: string): Renderable[] {
  return [
    Text({ content: "Update unavailable", fg: colors.danger, attributes: 1 }),
    Text({ content: error, fg: colors.text, wrapMode: "word" }),
    selectControl(
      [
        { name: "Retry", description: "Scan GitHub releases again.", value: "retry" },
        { name: "Exit", description: "Leave this instance unchanged.", value: "exit" },
      ],
      (option) => {
        if (option.value === "retry") {
          void loadReleases();
          return;
        }

        finish("No changes made.");
      },
      5,
    ),
  ];
}

function footer(): BoxRenderable {
  const content =
    view === "done"
      ? "Enter/Esc/Ctrl+C: exit"
      : controls.hasSelect()
        ? "Up/Down: choose | Enter: select | Esc/Ctrl+C: quit"
        : "Esc/Ctrl+C: quit";

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
    Text({ content, fg: colors.muted }),
  );
}

function releaseOptions(): SelectOption[] {
  return [
    ...releases.map((release) => ({
      name: formatReleaseName(release),
      description: `${formatReleaseDate(release.publishedAt)} - ${release.name}`,
      value: release,
    })),
    { name: "Refresh releases", description: "Scan GitHub again.", value: "refresh" },
    { name: "Exit", description: "Leave this instance unchanged.", value: "exit" },
  ];
}

function confirmOptions(): SelectOption[] {
  const applyOption = {
    name: "Apply update",
    description: "Download the release source, replace source files, then run bun install.",
    value: "apply",
  };
  const dockerOption = {
    name: "Apply update and redeploy Docker",
    description: "Update files, run bun install, then run the Docker deployment script.",
    value: "apply-docker",
  };
  const actionOptions = detectedDefaultDockerContainer
    ? [dockerOption, applyOption]
    : [applyOption, dockerOption];

  return [
    ...actionOptions,
    { name: "Back", description: "Return to the release list.", value: "back" },
    { name: "Exit", description: "Leave this instance unchanged.", value: "exit" },
  ];
}

function selectControl(
  options: SelectOption[],
  onSelected: (option: SelectOption) => void,
  height: number,
  selectedIndex = 0,
): SelectRenderable {
  const select = Select({
    width: "100%",
    height,
    options,
    selectedIndex: Math.max(0, selectedIndex),
    backgroundColor: colors.input,
    textColor: colors.text,
    focusedBackgroundColor: colors.input,
    focusedTextColor: colors.text,
    selectedBackgroundColor: colors.accentMuted,
    selectedTextColor: colors.accent,
    descriptionColor: colors.muted,
    selectedDescriptionColor: colors.text,
    showScrollIndicator: true,
    showDescription: true,
    wrapSelection: true,
  });

  select.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) =>
    onSelected(option),
  );
  controls.registerSelect(select, onSelected);
  return select;
}

function handleReleaseSelection(option: SelectOption): void {
  if (option.value === "refresh") {
    void loadReleases();
    return;
  }

  if (option.value === "exit") {
    finish("No changes made.");
    return;
  }

  selectedRelease = option.value as GitHubRelease;
  view = "confirm";
  render();
}

function handleConfirmSelection(option: SelectOption): void {
  if (option.value === "back") {
    view = "select";
    render();
    return;
  }

  if (option.value === "exit") {
    finish("No changes made.");
    return;
  }

  if ((option.value === "apply" || option.value === "apply-docker") && selectedRelease) {
    void applySelectedRelease(selectedRelease, option.value === "apply-docker");
  }
}

async function applySelectedRelease(
  release: GitHubRelease,
  redeployDocker: boolean,
): Promise<void> {
  view = "updating";
  message = "Starting update...";
  startSpinner();
  render();

  try {
    if (dryRunUpdates) {
      await simulateDryRunUpdate({ release, redeployDocker });
      return;
    }

    const result = await applyReleaseUpdate({
      cwd: repositoryRoot,
      release,
      token: Bun.env.GITHUB_TOKEN?.trim() || null,
      installDependencies: true,
      releasePublicKeyPem: updateConfig.releasePublicKeyPem,
      releasePublicKeyPemBase64:
        updateConfig.releasePublicKeyPemBase64 ||
        (isOfficialUpdateRepo ? DEFAULT_RELEASE_PUBLIC_KEY_PEM_B64 : undefined),
      onProgress: (progress) => {
        message = progress;
        render();
      },
    });

    if (redeployDocker) {
      message = "Redeploying Docker container...";
      render();
      await redeployDockerContainer(result.updatedPath);
    }

    stopSpinner();
    view = "done";
    message = updateSuccessMessage({
      release: result.release,
      redeployDocker,
      updatedPath: result.updatedPath,
    });
  } catch (error) {
    stopSpinner();
    view = "error";
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  render();
}

async function simulateDryRunUpdate(options: {
  release: GitHubRelease;
  redeployDocker: boolean;
}): Promise<void> {
  message = "Preparing release update...";
  render();
  await sleep(400);

  message = "Installing dependencies...";
  render();
  await sleep(400);

  if (options.redeployDocker) {
    message = "Redeploying Docker container...";
    render();
    await sleep(600);
  }

  stopSpinner();
  view = "done";
  message = updateSuccessMessage({
    release: options.release,
    redeployDocker: options.redeployDocker,
    updatedPath: repositoryRoot,
  });
  render();
}

function updateSuccessMessage(options: {
  release: GitHubRelease;
  redeployDocker: boolean;
  updatedPath: string;
}): string {
  return options.redeployDocker
    ? `Updated ${options.updatedPath} to ${formatReleaseName(options.release)} and redeployed Docker.`
    : `Updated ${options.updatedPath} to ${formatReleaseName(options.release)}.`;
}

async function detectDefaultDockerContainer(): Promise<void> {
  detectedDefaultDockerContainer = await isDefaultDockerContainerRunning();
  if (view === "confirm") {
    render();
  }
}

async function isDefaultDockerContainerRunning(): Promise<boolean> {
  try {
    const subprocess = Bun.spawn(
      [
        "docker",
        "ps",
        "--filter",
        `name=^/${dockerContainerName}$`,
        "--filter",
        "status=running",
        "--format",
        "{{.Names}}",
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const [exitCode, stdout] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
    ]);

    return (
      exitCode === 0 && stdout.split(/\r?\n/).some((name) => name.trim() === dockerContainerName)
    );
  } catch {
    return false;
  }
}

async function redeployDockerContainer(cwd: string): Promise<void> {
  const subprocess = Bun.spawn(["bash", "scripts/docker/deploy_docker.sh"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    throw new Error(output || `Docker redeploy failed with exit code ${exitCode}.`);
  }
}

function startSpinner(): void {
  stopSpinner();
  spinnerIndex = 0;
  spinnerTimer = setInterval(() => {
    spinnerIndex += 1;
    render();
  }, 120);
}

function stopSpinner(): void {
  if (!spinnerTimer) {
    return;
  }

  clearInterval(spinnerTimer);
  spinnerTimer = null;
}

function spinner(): string {
  return spinnerFrames[spinnerIndex % spinnerFrames.length] ?? "-";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function handleKeyPress(key: MinimalKeyEvent): boolean {
  if (view === "updating") {
    return true;
  }

  if (view === "done" && (isExitKey(key) || key.name === "return" || key.name === "linefeed")) {
    finish(message);
    return true;
  }

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

  return false;
}

function finish(output: string): void {
  if (finished) {
    return;
  }

  finished = true;
  stopSpinner();
  if (rawExitHandler) {
    renderer?.stdin.off("data", rawExitHandler);
    rawExitHandler = null;
  }
  renderer?.destroy();
  console.log(output);
}

function handleRawExitInput(chunk: Buffer | string): void {
  const sequence = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  if (sequence === "\u0003" || sequence === "\u001B") {
    if (view === "updating") {
      return;
    }

    if (view === "done") {
      finish(message);
      return;
    }

    finish("No changes made.");
    return;
  }

  const key = parseMinimalKey(sequence);
  if (key && isExitKey(key)) {
    if (view === "updating") {
      return;
    }

    if (view === "done") {
      finish(message);
      return;
    }

    finish("No changes made.");
  }
}
