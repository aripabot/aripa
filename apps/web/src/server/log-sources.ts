import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  DashboardLogEntry,
  DashboardLogSource,
  LocalLogFile,
  LogEntryLevel,
  LogsResponse,
} from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import {
  CURRENT_DOCKER_SOURCE_ID,
  DOCKER_CONTAINER_NAME,
  HOST_DOCKER_SOURCE_ID,
  getDockerRuntimeLogPath,
  isInsideDockerRuntime,
} from "@/server/docker-runtime";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const execFileAsync = promisify(execFile);
const LOG_TAIL_LINE_COUNT = 500;
const LOG_FILE_TAIL_LINE_COUNT = 150;
const LOG_FILE_TAIL_BYTES = 256 * 1024;
const LOG_ENTRY_LEVELS = new Set<LogEntryLevel>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "unknown",
]);
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export async function readLocalLogs(): Promise<LogsResponse> {
  const candidates = [
    join(repositoryRoot, "aripa.log"),
    join(repositoryRoot, "aripa-update.log"),
    join(repositoryRoot, "apps", "bot", "aripa.log"),
    join(repositoryRoot, "apps", "bot", "aripa-update.log"),
  ];

  const [dockerSource, processSources, files] = await Promise.all([
    readDockerLogs(),
    readProcessLogs(),
    Promise.all(candidates.map(readLogCandidate)),
  ]);
  const fileSources = files.map(logFileToSource);
  const sources = [dockerSource, ...processSources, ...fileSources];
  const entries = [
    ...dockerSource.entries,
    ...processSources.flatMap((source) => source.entries),
    ...files.flatMap((file) => logFileToEntries(file)),
  ]
    .sort(compareLogEntries)
    .slice(-LOG_TAIL_LINE_COUNT);

  return {
    sources: sources.map(({ entries: _entries, ...source }) => source),
    entries,
    files,
  };
}

async function readDockerLogs(): Promise<LogSourceWithEntries> {
  if (isInsideDockerRuntime()) {
    return readCurrentDockerRuntimeLogs();
  }

  const running = await isDockerContainerRunning(DOCKER_CONTAINER_NAME);
  const source: DashboardLogSource = {
    id: HOST_DOCKER_SOURCE_ID,
    kind: "docker",
    name: "Docker",
    detail: DOCKER_CONTAINER_NAME,
    available: running,
    updatedAt: null,
    sizeBytes: null,
    message: running ? null : "Container logs are available when the Docker runtime is active.",
  };

  if (!running) {
    return { ...source, entries: [] };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--timestamps", "--tail", String(LOG_TAIL_LINE_COUNT), DOCKER_CONTAINER_NAME],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    const lines = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)].filter(Boolean);

    return {
      ...source,
      entries: lines.map((line, index) => parseLogLine(line, source, index)),
    };
  } catch (error) {
    return {
      ...source,
      available: false,
      message: `Docker logs could not be read: ${readableError(error)}`,
      entries: [],
    };
  }
}

async function isDockerContainerRunning(containerName: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["inspect", "-f", "{{.State.Running}}", containerName], {
      timeout: 2_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function readCurrentDockerRuntimeLogs(): Promise<LogSourceWithEntries> {
  const logPath = getDockerRuntimeLogPath();
  const source: DashboardLogSource = {
    id: CURRENT_DOCKER_SOURCE_ID,
    kind: "docker",
    name: "Docker",
    detail: `Current container · ${logPath}`,
    available: false,
    updatedAt: null,
    sizeBytes: null,
    message: "Container runtime logs are not available yet.",
  };

  try {
    const file = await readLogCandidate(logPath);
    return {
      ...source,
      available: file.exists,
      updatedAt: file.updatedAt,
      sizeBytes: file.sizeBytes,
      message: file.exists ? null : `Container runtime log was not found at ${logPath}.`,
      entries: file.lines.map((line, index) => parseLogLine(line, source, index)),
    };
  } catch (error) {
    return {
      ...source,
      message: `Container runtime logs could not be read: ${readableError(error)}`,
      entries: [],
    };
  }
}

async function readProcessLogs(): Promise<LogSourceWithEntries[]> {
  const processIds = await findBotProcessIds();

  if (processIds.length === 0) {
    return [
      {
        id: "process:local",
        kind: "process",
        name: "Local Process",
        detail: "Aripa bot process",
        available: false,
        updatedAt: null,
        sizeBytes: null,
        message: "No local Aripa bot process was found.",
        entries: [],
      },
    ];
  }

  return Promise.all(processIds.map(readProcessLogSource));
}

async function findBotProcessIds(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { timeout: 1_500 });
    return stdout
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match) {
          return null;
        }

        const pid = match[1];
        const command = match[2];
        if (!pid || !command) {
          return null;
        }

        return isBotProcessCommand(command) ? pid : null;
      })
      .filter((pid): pid is string => Boolean(pid));
  } catch {
    return [];
  }
}

function isBotProcessCommand(command: string): boolean {
  if (!command.includes("src/index.ts")) {
    return false;
  }

  return (
    command.includes("apps/bot") ||
    command.includes("--cwd apps/bot") ||
    command.includes("--env-file=../../.env")
  );
}

async function readProcessLogSource(pid: string): Promise<LogSourceWithEntries> {
  const stdoutPath = await getProcessStdoutPath(pid);
  const source: DashboardLogSource = {
    id: `process:${pid}`,
    kind: "process",
    name: "Local Process",
    detail: `PID ${pid}`,
    available: Boolean(stdoutPath),
    updatedAt: null,
    sizeBytes: null,
    message: stdoutPath
      ? null
      : "This process is not writing stdout to a readable file. Start Aripa with file logging or use Docker to view captured history.",
  };

  if (!stdoutPath) {
    return { ...source, entries: [] };
  }

  try {
    const file = await readLogCandidate(stdoutPath);
    return {
      ...source,
      available: file.exists,
      detail: `PID ${pid} · ${file.name}`,
      updatedAt: file.updatedAt,
      sizeBytes: file.sizeBytes,
      message: file.exists
        ? null
        : "This process stdout is not written to a readable file. Start Aripa with file logging or use Docker to view captured history.",
      entries: file.lines.map((line, index) => parseLogLine(line, source, index)),
    };
  } catch (error) {
    return {
      ...source,
      available: false,
      message: `Process logs could not be read: ${readableError(error)}`,
      entries: [],
    };
  }
}

async function getProcessStdoutPath(pid: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", pid, "-d", "1", "-Fn"], {
      timeout: 1_500,
    });
    const stdoutPath = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("n/"))
      ?.slice(1);

    return stdoutPath ?? null;
  } catch {
    return null;
  }
}

function logFileToSource(file: LocalLogFile): LogSourceWithEntries {
  const source = logFileToSourceMetadata(file);

  return {
    ...source,
    entries: logFileToEntries(file),
  };
}

function logFileToEntries(file: LocalLogFile): DashboardLogEntry[] {
  const source = logFileToSourceMetadata(file);
  return file.lines.map((line, index) => parseLogLine(line, source, index));
}

function logFileToSourceMetadata(file: LocalLogFile): DashboardLogSource {
  return {
    id: `file:${file.path}`,
    kind: "file",
    name: file.name,
    detail: file.path,
    available: file.exists,
    updatedAt: file.updatedAt,
    sizeBytes: file.sizeBytes,
    message: file.exists ? null : "File not found.",
  };
}

async function readLogCandidate(path: string): Promise<LocalLogFile> {
  const name = path.replace(`${repositoryRoot}/`, "");

  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      return {
        name,
        path,
        exists: false,
        updatedAt: null,
        sizeBytes: 0,
        lines: [],
      };
    }

    const lines = await readLogTailLines(path, metadata.size);

    return {
      name,
      path,
      exists: true,
      updatedAt: metadata.mtime.toISOString(),
      sizeBytes: metadata.size,
      lines,
    };
  } catch {
    return {
      name,
      path,
      exists: false,
      updatedAt: null,
      sizeBytes: 0,
      lines: [],
    };
  }
}

async function readLogTailLines(path: string, sizeBytes: number): Promise<string[]> {
  const byteLength = Math.min(sizeBytes, LOG_FILE_TAIL_BYTES);
  const start = Math.max(sizeBytes - byteLength, 0);
  const buffer = Buffer.alloc(byteLength);
  const file = await open(path, "r");

  try {
    const { bytesRead } = await file.read(buffer, 0, byteLength, start);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/).filter(Boolean);

    if (start > 0) {
      lines.shift();
    }

    return lines.slice(-LOG_FILE_TAIL_LINE_COUNT);
  } finally {
    await file.close();
  }
}

export function parseLogLine(
  rawLine: string,
  source: Pick<DashboardLogSource, "id" | "kind" | "name">,
  index: number,
): DashboardLogEntry {
  const cleanedLine = redactLogText(stripAnsi(rawLine));
  const { timestamp, body } = splitDockerTimestamp(cleanedLine);
  const parsed = parsePinoJson(body);

  return {
    id: `${source.id}:${index}:${hashString(cleanedLine)}`,
    sourceId: source.id,
    sourceKind: source.kind,
    sourceName: source.name,
    level: parsed.level,
    timestamp: parsed.timestamp ?? timestamp,
    message: parsed.message,
    raw: parsed.raw,
    metadata: parsed.metadata,
  };
}

function splitDockerTimestamp(line: string): { timestamp: string | null; body: string } {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/);
  if (!match) {
    return { timestamp: null, body: line };
  }

  return { timestamp: normalizeTimestamp(match[1] ?? null), body: match[2] ?? "" };
}

function parsePinoJson(line: string): {
  level: LogEntryLevel;
  timestamp: string | null;
  message: string;
  raw: string;
  metadata: Record<string, unknown> | null;
} {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    const message = getString(payload.msg) ?? getString(payload.message) ?? line;
    const timestamp = normalizeTimestamp(payload.time);
    const level = normalizeLogLevel(payload.level);
    const metadata = extractLogMetadata(payload);

    return {
      level,
      timestamp,
      message: redactLogText(message),
      raw: redactLogText(JSON.stringify(payload)),
      metadata: redactLogObject(metadata),
    };
  } catch {
    return {
      level: inferTextLogLevel(line),
      timestamp: null,
      message: line,
      raw: line,
      metadata: null,
    };
  }
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function normalizeLogLevel(value: unknown): LogEntryLevel {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return isLogEntryLevel(lower) ? lower : "unknown";
  }

  if (typeof value !== "number") {
    return "unknown";
  }

  if (value >= 60) {
    return "fatal";
  }
  if (value >= 50) {
    return "error";
  }
  if (value >= 40) {
    return "warn";
  }
  if (value >= 30) {
    return "info";
  }
  if (value >= 20) {
    return "debug";
  }
  if (value >= 10) {
    return "trace";
  }

  return "unknown";
}

function isLogEntryLevel(value: string): value is LogEntryLevel {
  return LOG_ENTRY_LEVELS.has(value as LogEntryLevel);
}

function inferTextLogLevel(line: string): LogEntryLevel {
  const normalized = line.toLowerCase();

  if (/\bfatal\b/.test(normalized)) {
    return "fatal";
  }
  if (/\berror\b/.test(normalized)) {
    return "error";
  }
  if (/\bwarn(?:ing)?\b/.test(normalized)) {
    return "warn";
  }
  if (/\bdebug\b/.test(normalized)) {
    return "debug";
  }
  if (/\btrace\b/.test(normalized)) {
    return "trace";
  }
  if (/\binfo\b/.test(normalized)) {
    return "info";
  }

  return "unknown";
}

function extractLogMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (["level", "time", "timestamp", "msg", "message", "pid", "hostname"].includes(key)) {
      continue;
    }

    metadata[key] = value;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function redactLogObject<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? (redactLogText(value) as T) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactLogObject(entry)) as T;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveLogKey(key) ? "[redacted]" : redactLogObject(entry),
    ]),
  ) as T;
}

function isSensitiveLogKey(key: string): boolean {
  return /token|authorization|api[_-]?key|secret|password/i.test(key);
}

function redactLogText(value: string): string {
  return value
    .replace(/(Bot\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .replace(
      /((?:token|authorization|api[_-]?key|secret|password)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[redacted]",
    );
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function compareLogEntries(left: DashboardLogEntry, right: DashboardLogEntry): number {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

interface LogSourceWithEntries extends DashboardLogSource {
  entries: DashboardLogEntry[];
}
