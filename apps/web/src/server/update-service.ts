import { join } from "node:path";

import { applyReleaseUpdate, fetchGitHubReleases } from "@aripabot/core/update/release-updater.ts";

import type { UpdateInstallResponse } from "@/lib/api-types";
import { readConfig } from "@/server/config-service";

const repositoryRoot = join(/* turbopackIgnore: true */ process.cwd(), "../..");

export async function installRelease(tagName: string): Promise<UpdateInstallResponse> {
  const { config } = await readConfig();
  if (!config.updates.enabled) {
    throw new Error("Updates are disabled.");
  }

  const releases = await fetchGitHubReleases({
    repo: config.updates.githubRepo,
    token: process.env.GITHUB_TOKEN?.trim() || null,
  });
  const release = releases.find((candidate) => candidate.tagName === tagName);
  if (!release) {
    throw new Error(`Release ${tagName} was not found.`);
  }

  const progress: string[] = [];
  const result = await applyReleaseUpdate({
    cwd: repositoryRoot,
    release,
    token: process.env.GITHUB_TOKEN?.trim() || null,
    installDependencies: true,
    releasePublicKeyPem: config.updates.releasePublicKeyPem,
    releasePublicKeyPemBase64: config.updates.releasePublicKeyPemBase64,
    onProgress: (message) => {
      progress.push(message);
    },
  });

  return {
    tagName,
    updatedPath: result.updatedPath,
    installedDependencies: result.installedDependencies,
    progress,
  };
}
