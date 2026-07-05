import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { AUTO_UPDATE_CRON_PRESETS } from "@aripabot/core/update/auto-update-cron.ts";
import {
  buildAutoUpdateCronEntry,
  removeManagedAutoUpdateCronContent,
  updateManagedAutoUpdateCronContent,
} from "@aripabot/core/update/auto-update-cron-content.ts";
import {
  fetchGitHubReleaseByTagName,
  fetchGitHubReleases,
  githubHeaders,
  type FetchLike,
  type FetchReleasesOptions,
  type GitHubRelease,
  type GitHubReleaseAsset,
} from "@aripabot/core/update/github-releases.ts";

export {
  AUTO_UPDATE_CRON_PRESETS,
  type AutoUpdateCronExpression,
  type AutoUpdateCronPresetId,
} from "@aripabot/core/update/auto-update-cron.ts";
export {
  AUTO_UPDATE_CRON_BEGIN,
  AUTO_UPDATE_CRON_END,
  buildAutoUpdateCronEntry,
  removeManagedAutoUpdateCronContent,
  shellQuote,
  updateManagedAutoUpdateCronContent,
  type AutoUpdateCronEntryOptions,
} from "@aripabot/core/update/auto-update-cron-content.ts";
export {
  DEFAULT_GITHUB_REPO,
  fetchGitHubReleaseByTagName,
  fetchGitHubReleases,
  githubHeaders,
  toGitHubRelease,
  type FetchLike,
  type FetchReleasesOptions,
  type GitHubRelease,
  type GitHubReleaseAsset,
} from "@aripabot/core/update/github-releases.ts";

export const DEFAULT_RELEASE_PUBLIC_KEY_PEM_B64 =
  "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQVY4d2JnNEZXYzV5YTQ3VXFhalJ2L3Y3Qm1xd253WjlpREtzTm1uNXNwdzg9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=";
export const RELEASE_MANIFEST_ASSET_NAME = "aripa-release.json";
export const RELEASE_MANIFEST_SIGNATURE_ASSET_NAME = "aripa-release.json.sig";
export const RELEASE_PUBLIC_KEY_ENV = "ARIPA_RELEASE_PUBLIC_KEY_PEM";
export const RELEASE_PUBLIC_KEY_BASE64_ENV = "ARIPA_RELEASE_PUBLIC_KEY_PEM_B64";

interface ReleaseManifest {
  schemaVersion: 1;
  tagName: string;
  commitSha: string;
  archive: {
    name: string;
    sha256: string;
  };
  generatedAt: string;
}

export interface CompareCurrentVersionOptions extends FetchReleasesOptions {
  cwd?: string;
}

export interface ApplyReleaseOptions {
  cwd?: string;
  release: GitHubRelease;
  fetchImpl?: FetchLike;
  token?: string | null;
  installDependencies?: boolean;
  releasePublicKeyPem?: string;
  releasePublicKeyPemBase64?: string;
  onProgress?: (message: string) => void;
}

export interface ApplyLatestReleaseUpdateOptions
  extends Omit<ApplyReleaseOptions, "release">, FetchReleasesOptions {}

export interface AutoUpdateCronInstallOptions {
  cwd?: string;
  configPath?: string | URL;
  cronExpression: string;
  bunExecutable?: string;
  logPath?: string;
  crontabRead?: () => Promise<string>;
  crontabWrite?: (content: string) => Promise<void>;
}

export interface AutoUpdateCronRemoveOptions {
  crontabRead?: () => Promise<string>;
  crontabWrite?: (content: string) => Promise<void>;
}

export interface ApplyReleaseResult {
  release: GitHubRelease;
  updatedPath: string;
  installedDependencies: boolean;
}

export async function compareCurrentPackageVersionWithLatestReleaseVersion(
  options: CompareCurrentVersionOptions = {},
): Promise<{
  isLatest: boolean;
  latestVersion: string;
  currentVersion: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const currentVersion = await readCurrentPackageVersion(cwd);
  const [currentRelease, releases] = await Promise.all([
    fetchGitHubReleaseByTagName(currentVersion, options),
    fetchGitHubReleases(options),
  ]);
  const latestRelease = releases[0];

  if (!latestRelease) {
    throw new Error("No published releases were found.");
  }

  return {
    isLatest: currentRelease.id === latestRelease.id,
    latestVersion: latestRelease.tagName,
    currentVersion,
  };
}

async function readCurrentPackageVersion(cwd: string): Promise<string> {
  const packageJson = (await Bun.file(join(cwd, "package.json")).json()) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("package.json must contain a non-empty version string.");
  }

  return packageJson.version.trim();
}

export function formatReleaseDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "unknown date";
  }

  return date.toISOString().slice(0, 10);
}

export function formatReleaseName(release: GitHubRelease): string {
  return `${release.tagName}${release.prerelease ? " [pre-release]" : ""}`;
}

export async function applyReleaseUpdate(
  options: ApplyReleaseOptions,
): Promise<ApplyReleaseResult> {
  const cwd = options.cwd ?? process.cwd();
  const installDependencies = options.installDependencies ?? true;
  const tempDir = await mkdtemp(join(tmpdir(), "aripa-update-"));
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    options.onProgress?.(`Verifying ${options.release.tagName}...`);
    const manifest = await fetchAndVerifyReleaseManifest({
      release: options.release,
      fetchImpl,
      token: options.token,
      releasePublicKeyPem: options.releasePublicKeyPem,
      releasePublicKeyPemBase64: options.releasePublicKeyPemBase64,
    });

    options.onProgress?.(`Downloading ${options.release.tagName}...`);
    const archivePath = await downloadVerifiedReleaseArchive({
      release: options.release,
      manifest,
      destinationDirectory: tempDir,
      fetchImpl,
      token: options.token,
    });

    options.onProgress?.("Extracting source archive...");
    await Bun.$`tar -xzf ${archivePath} -C ${tempDir}`.quiet();
    const sourceRoot = await findExtractedSourceRoot(tempDir);

    options.onProgress?.("Applying release files...");
    await syncSourceTree(sourceRoot, cwd);

    if (installDependencies) {
      options.onProgress?.("Installing dependencies...");
      await Bun.$`bun install --ignore-scripts --frozen-lockfile`.cwd(cwd).quiet();
    }

    return {
      release: options.release,
      updatedPath: cwd,
      installedDependencies: installDependencies,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function applyLatestReleaseUpdate(
  options: ApplyLatestReleaseUpdateOptions = {},
): Promise<ApplyReleaseResult> {
  const releases = await fetchGitHubReleases(options);
  const latestRelease = releases[0];
  if (!latestRelease) {
    throw new Error("No published releases were found.");
  }

  return applyReleaseUpdate({
    ...options,
    release: latestRelease,
  });
}

export function findAutoUpdateCronPreset(
  presetId: string | undefined,
): (typeof AUTO_UPDATE_CRON_PRESETS)[number] | null {
  return AUTO_UPDATE_CRON_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export async function installAutoUpdateCron(options: AutoUpdateCronInstallOptions): Promise<void> {
  const read = options.crontabRead ?? readUserCrontab;
  const write = options.crontabWrite ?? writeUserCrontab;
  const existingCrontab = await read();
  const cronEntry = buildAutoUpdateCronEntry(options);
  await write(updateManagedAutoUpdateCronContent(existingCrontab, cronEntry));
}

export async function removeAutoUpdateCron(
  options: AutoUpdateCronRemoveOptions = {},
): Promise<void> {
  const read = options.crontabRead ?? readUserCrontab;
  const write = options.crontabWrite ?? writeUserCrontab;
  const existingCrontab = await read();
  const updatedCrontab = removeManagedAutoUpdateCronContent(existingCrontab);
  if (updatedCrontab !== existingCrontab) {
    await write(updatedCrontab);
  }
}

export async function syncSourceTree(sourceRoot: string, destinationRoot: string): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  await syncDirectory(sourceRoot, destinationRoot, "");
}

export function shouldPreserveUpdatePath(relativePath: string): boolean {
  const normalized = relativePath.split(/[\\/]+/).filter(Boolean);
  if (normalized.length === 0) {
    return false;
  }

  if (normalized.includes(".git") || normalized.includes("node_modules")) {
    return true;
  }

  const fileName = normalized.at(-1) ?? "";
  return (
    fileName === "config.json" ||
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName === "aripa.sqlite" ||
    fileName.endsWith(".sqlite") ||
    fileName.endsWith(".sqlite-shm") ||
    fileName.endsWith(".sqlite-wal")
  );
}

async function fetchAndVerifyReleaseManifest(options: {
  release: GitHubRelease;
  fetchImpl: FetchLike;
  token?: string | null;
  releasePublicKeyPem?: string;
  releasePublicKeyPemBase64?: string;
}): Promise<ReleaseManifest> {
  const manifestText = await fetchReleaseAssetText({
    release: options.release,
    assetName: RELEASE_MANIFEST_ASSET_NAME,
    fetchImpl: options.fetchImpl,
    token: options.token,
  });
  const signatureText = await fetchReleaseAssetText({
    release: options.release,
    assetName: RELEASE_MANIFEST_SIGNATURE_ASSET_NAME,
    fetchImpl: options.fetchImpl,
    token: options.token,
  });
  const publicKeyPem = resolveReleasePublicKeyPem(
    options.releasePublicKeyPem,
    options.releasePublicKeyPemBase64,
  );

  if (!verifyReleaseManifestSignature(manifestText, signatureText, publicKeyPem)) {
    throw new Error(
      `Release manifest signature verification failed for ${options.release.tagName}.`,
    );
  }

  const manifest = parseReleaseManifest(manifestText);
  if (manifest.tagName !== options.release.tagName) {
    throw new Error(
      `Release manifest tag ${manifest.tagName} does not match selected release ${options.release.tagName}.`,
    );
  }

  return manifest;
}

async function fetchReleaseAssetText(options: {
  release: GitHubRelease;
  assetName: string;
  fetchImpl: FetchLike;
  token?: string | null;
}): Promise<string> {
  const response = await fetchReleaseAsset({
    release: options.release,
    assetName: options.assetName,
    fetchImpl: options.fetchImpl,
    token: options.token,
  });
  return response.text();
}

async function downloadVerifiedReleaseArchive(options: {
  release: GitHubRelease;
  manifest: ReleaseManifest;
  destinationDirectory: string;
  fetchImpl: FetchLike;
  token?: string | null;
}): Promise<string> {
  const response = await fetchReleaseAsset({
    release: options.release,
    assetName: options.manifest.archive.name,
    fetchImpl: options.fetchImpl,
    token: options.token,
  });
  const archiveBytes = await response.arrayBuffer();
  const archiveHash = createHash("sha256").update(new Uint8Array(archiveBytes)).digest("hex");

  if (archiveHash !== options.manifest.archive.sha256) {
    throw new Error(`Release archive hash verification failed for ${options.release.tagName}.`);
  }

  const archivePath = join(
    options.destinationDirectory,
    sanitizeFileName(options.manifest.archive.name),
  );
  await Bun.write(archivePath, archiveBytes);
  return archivePath;
}

async function fetchReleaseAsset(options: {
  release: GitHubRelease;
  assetName: string;
  fetchImpl: FetchLike;
  token?: string | null;
}): Promise<Response> {
  const asset = findReleaseAsset(options.release, options.assetName);
  const response = await options.fetchImpl(asset.downloadUrl, {
    headers: githubHeaders(options.token, "application/octet-stream"),
  });

  if (!response.ok) {
    throw new Error(
      `Release asset ${options.assetName} download failed: ${response.status} ${response.statusText}`,
    );
  }

  return response;
}

function findReleaseAsset(release: GitHubRelease, assetName: string): GitHubReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === assetName);
  if (!asset) {
    throw new Error(`Release ${release.tagName} is missing required asset ${assetName}.`);
  }

  return asset;
}

function verifyReleaseManifestSignature(
  manifestText: string,
  signatureText: string,
  publicKeyPem: string,
): boolean {
  const signature = Uint8Array.from(Buffer.from(signatureText.trim(), "base64"));
  if (signature.length === 0) {
    return false;
  }

  return verifySignature(
    null,
    new TextEncoder().encode(manifestText),
    createPublicKey(publicKeyPem),
    signature,
  );
}

function parseReleaseManifest(manifestText: string): ReleaseManifest {
  const parsed = JSON.parse(manifestText) as Partial<ReleaseManifest>;

  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.tagName !== "string" ||
    typeof parsed.commitSha !== "string" ||
    typeof parsed.generatedAt !== "string" ||
    typeof parsed.archive !== "object" ||
    parsed.archive === null ||
    typeof parsed.archive.name !== "string" ||
    typeof parsed.archive.sha256 !== "string"
  ) {
    throw new Error("Release manifest is malformed.");
  }

  if (!/^[0-9a-f]{40}$/i.test(parsed.commitSha)) {
    throw new Error("Release manifest commit SHA is malformed.");
  }

  if (!/^[0-9a-f]{64}$/i.test(parsed.archive.sha256)) {
    throw new Error("Release manifest archive SHA-256 is malformed.");
  }

  if (parsed.archive.name !== basename(parsed.archive.name)) {
    throw new Error("Release manifest archive name must be a file name.");
  }

  return {
    schemaVersion: 1,
    tagName: parsed.tagName,
    commitSha: parsed.commitSha,
    archive: {
      name: parsed.archive.name,
      sha256: parsed.archive.sha256.toLowerCase(),
    },
    generatedAt: parsed.generatedAt,
  };
}

function resolveReleasePublicKeyPem(publicKeyPem?: string, publicKeyPemBase64?: string): string {
  const configuredKey =
    Bun.env[RELEASE_PUBLIC_KEY_ENV]?.replaceAll("\\n", "\n").trim() ||
    decodeBase64Pem(Bun.env[RELEASE_PUBLIC_KEY_BASE64_ENV]) ||
    publicKeyPem?.trim() ||
    decodeBase64Pem(publicKeyPemBase64);

  if (!configuredKey) {
    throw new Error(
      `Release verification public key is not configured. Set ${RELEASE_PUBLIC_KEY_ENV} or ${RELEASE_PUBLIC_KEY_BASE64_ENV}.`,
    );
  }

  return `${configuredKey}\n`;
}

function decodeBase64Pem(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  return Buffer.from(value.trim(), "base64").toString("utf8").trim();
}

async function findExtractedSourceRoot(tempDir: string): Promise<string> {
  const entries = await readdir(tempDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    throw new Error("Release archive did not contain exactly one source directory.");
  }

  return join(tempDir, directories[0]!.name);
}

async function syncDirectory(
  sourceDirectory: string,
  destinationDirectory: string,
  relativeBase: string,
): Promise<void> {
  await mkdir(destinationDirectory, { recursive: true });

  const sourceEntries = await readdir(sourceDirectory, { withFileTypes: true });
  const sourceEntryNames = new Set(sourceEntries.map((entry) => entry.name));
  const destinationEntries = await readdir(destinationDirectory, { withFileTypes: true }).catch(
    () => [],
  );

  if (relativeBase) {
    for (const entry of destinationEntries) {
      const entryRelativePath = join(relativeBase, entry.name);
      if (!sourceEntryNames.has(entry.name) && !shouldPreserveUpdatePath(entryRelativePath)) {
        await rm(join(destinationDirectory, entry.name), { recursive: true, force: true });
      }
    }
  }

  for (const entry of sourceEntries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    const entryRelativePath = join(relativeBase, entry.name);

    if (shouldPreserveUpdatePath(entryRelativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await syncDirectory(sourcePath, destinationPath, entryRelativePath);
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(`Release archive contains unsupported file type: ${entryRelativePath}`);
    }

    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { force: true, recursive: true });
  }
}

async function readUserCrontab(): Promise<string> {
  const subprocess = Bun.spawn(["crontab", "-l"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode === 0) {
    return stdout;
  }

  if (/no crontab/i.test(stderr)) {
    return "";
  }

  throw new Error(stderr.trim() || `crontab -l failed with exit code ${exitCode}.`);
}

async function writeUserCrontab(content: string): Promise<void> {
  const subprocess = Bun.spawn(["crontab", "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  subprocess.stdin.write(content);
  subprocess.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    throw new Error(output || `crontab update failed with exit code ${exitCode}.`);
  }
}

function sanitizeFileName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "_") || "release";
}
