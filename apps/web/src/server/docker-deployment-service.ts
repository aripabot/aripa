import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  DockerDeploymentAction,
  DockerDeploymentCommandResponse,
  DockerDeploymentScript,
  DockerDeploymentStatus,
} from "@/lib/api-types";

const execFileAsync = promisify(execFile);
const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const packageJsonPath = join(repositoryRoot, "package.json");
const CONTAINER_NAME = "aripabot-docker";
const IMAGE_NAME = "aripa";
const SCRIPT_BY_ACTION: Record<DockerDeploymentAction, { label: string; script: string }> = {
  start: { label: "Start Deployment", script: "docker:deploy" },
  stop: { label: "Stop Deployment", script: "docker:stop" },
};

export async function getDockerDeploymentStatus(): Promise<DockerDeploymentStatus> {
  const [container, image, scripts] = await Promise.all([
    inspectContainer(),
    inspectImage(),
    getDockerDeploymentScripts(),
  ]);

  if (!container.available) {
    return {
      containerName: CONTAINER_NAME,
      imageName: IMAGE_NAME,
      state: "stopped",
      stateLabel: "Not Running",
      detail: container.error ?? "No Docker container was found.",
      containerId: null,
      imageId: image.imageId,
      startedAt: null,
      finishedAt: null,
      scripts,
    };
  }

  return {
    containerName: CONTAINER_NAME,
    imageName: IMAGE_NAME,
    state: container.running ? "running" : "stopped",
    stateLabel: container.running ? "Running" : "Stopped",
    detail: container.running
      ? "The Docker container is active."
      : "The Docker container exists but is not active.",
    containerId: container.containerId,
    imageId: image.imageId,
    startedAt: container.startedAt,
    finishedAt: container.finishedAt,
    scripts,
  };
}

export async function runDockerDeploymentCommand(
  action: DockerDeploymentAction,
): Promise<DockerDeploymentCommandResponse> {
  const script = SCRIPT_BY_ACTION[action];
  if (!script) {
    throw new Error("Choose a supported Docker deployment action.");
  }

  const scripts = await getDockerDeploymentScripts();
  const scriptStatus = scripts.find((item) => item.action === action);
  if (!scriptStatus?.available) {
    throw new Error(`${script.script} is not available in the root package scripts.`);
  }

  const startedAt = new Date().toISOString();

  try {
    const result = await execFileAsync("bun", ["run", script.script], {
      cwd: repositoryRoot,
      env: { ...process.env },
      maxBuffer: 1024 * 1024 * 4,
      timeout: action === "start" ? 300_000 : 60_000,
    });

    return {
      action,
      command: `bun run ${script.script}`,
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      status: await getDockerDeploymentStatus(),
    };
  } catch (error) {
    const output = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      signal?: string;
      message?: string;
    };
    const code = typeof output.code === "number" ? output.code : 1;
    const stderr = [output.stderr, output.signal ? `Signal: ${output.signal}` : null]
      .filter(Boolean)
      .join("\n");

    return {
      action,
      command: `bun run ${script.script}`,
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: code,
      stdout: output.stdout ?? "",
      stderr: stderr || output.message || "Docker command failed.",
      status: await getDockerDeploymentStatus(),
    };
  }
}

async function getDockerDeploymentScripts(): Promise<DockerDeploymentScript[]> {
  const packageJson = await readPackageJson();
  const scripts =
    packageJson && typeof packageJson.scripts === "object" && packageJson.scripts !== null
      ? (packageJson.scripts as Record<string, unknown>)
      : {};

  return (
    Object.entries(SCRIPT_BY_ACTION) as Array<
      [DockerDeploymentAction, (typeof SCRIPT_BY_ACTION)[DockerDeploymentAction]]
    >
  ).map(([action, config]) => ({
    action,
    label: config.label,
    command: `bun run ${config.script}`,
    available: typeof scripts[config.script] === "string",
  }));
}

async function readPackageJson(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function inspectContainer(): Promise<{
  available: boolean;
  running: boolean;
  containerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "inspect",
        "-f",
        "{{.Id}}\n{{.State.Running}}\n{{.State.StartedAt}}\n{{.State.FinishedAt}}",
        CONTAINER_NAME,
      ],
      { timeout: 2_000 },
    );
    const [containerId, running, startedAt, finishedAt] = stdout.trim().split(/\r?\n/);

    return {
      available: true,
      running: running === "true",
      containerId: containerId?.slice(0, 12) ?? null,
      startedAt: normalizeDockerTime(startedAt),
      finishedAt: normalizeDockerTime(finishedAt),
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      running: false,
      containerId: null,
      startedAt: null,
      finishedAt: null,
      error: readableError(error),
    };
  }
}

async function inspectImage(): Promise<{ imageId: string | null }> {
  try {
    await access(packageJsonPath);
    const { stdout } = await execFileAsync(
      "docker",
      ["image", "inspect", "-f", "{{.Id}}", IMAGE_NAME],
      {
        timeout: 2_000,
      },
    );
    return {
      imageId:
        stdout
          .trim()
          .replace(/^sha256:/, "")
          .slice(0, 12) || null,
    };
  } catch {
    return { imageId: null };
  }
}

function normalizeDockerTime(value: string | undefined): string | null {
  if (!value || value.startsWith("0001-01-01")) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Docker is unavailable.";
}
