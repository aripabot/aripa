import { fetchGitHubReleases } from "@aripabot/core/update/release-updater.ts";

import type { ReleasesResponse } from "@/lib/api-types";
import { readConfig } from "@/server/config-store";
import { getEnv } from "@/server/env";

export async function listReleases(): Promise<ReleasesResponse> {
  const { config } = await readConfig();
  const repo = config.updates.githubRepo;
  const releases = config.updates.enabled
    ? await fetchGitHubReleases({
        repo,
        token: getEnv("GITHUB_TOKEN")?.trim() || null,
        userAgent: "aripa-dashboard",
      })
    : [];

  return { repo, releases };
}
