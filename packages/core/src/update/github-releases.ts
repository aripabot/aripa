export const DEFAULT_GITHUB_REPO = "aripabot/aripa";

export interface GitHubReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface GitHubRelease {
  id: number;
  tagName: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string;
  tarballUrl: string;
  zipballUrl: string;
  htmlUrl: string;
  assets: GitHubReleaseAsset[];
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface GitHubReleaseResponse {
  id: number;
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  created_at: string;
  tarball_url: string;
  zipball_url: string;
  html_url: string;
  assets?: GitHubReleaseAssetResponse[];
}

interface GitHubReleaseAssetResponse {
  name: string;
  browser_download_url: string;
}

export interface FetchReleasesOptions {
  repo?: string;
  fetchImpl?: FetchLike;
  token?: string | null;
  userAgent?: string;
}

export async function fetchGitHubReleases(
  options: FetchReleasesOptions = {},
): Promise<GitHubRelease[]> {
  const repo = options.repo ?? DEFAULT_GITHUB_REPO;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: githubHeaders(options.token, undefined, options.userAgent),
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as GitHubReleaseResponse[];
  return payload
    .filter((release) => !release.draft)
    .map(toGitHubRelease)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export async function fetchGitHubReleaseByTagName(
  tagName: string,
  options: FetchReleasesOptions = {},
): Promise<GitHubRelease> {
  const repo = options.repo ?? DEFAULT_GITHUB_REPO;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tagName)}`,
    {
      headers: githubHeaders(options.token, undefined, options.userAgent),
    },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub release ${tagName} request failed: ${response.status} ${response.statusText}`,
    );
  }

  return toGitHubRelease((await response.json()) as GitHubReleaseResponse);
}

export function toGitHubRelease(release: GitHubReleaseResponse): GitHubRelease {
  return {
    id: release.id,
    tagName: release.tag_name,
    name: release.name?.trim() || release.tag_name,
    prerelease: release.prerelease,
    draft: release.draft,
    publishedAt: release.published_at ?? release.created_at,
    tarballUrl: release.tarball_url,
    zipballUrl: release.zipball_url,
    htmlUrl: release.html_url,
    assets: (release.assets ?? []).map((asset) => ({
      name: asset.name,
      downloadUrl: asset.browser_download_url,
    })),
  };
}

export function githubHeaders(
  token: string | null | undefined,
  accept = "application/vnd.github+json",
  userAgent = "aripa-update",
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
