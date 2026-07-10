import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import {
  applyReleaseUpdate,
  applyLatestReleaseUpdate,
  buildAutoUpdateCronEntry,
  compareCurrentPackageVersionWithLatestReleaseVersion,
  DEFAULT_RELEASE_PUBLIC_KEY_PEM_B64,
  fetchGitHubReleases,
  formatReleaseName,
  removeManagedAutoUpdateCronContent,
  removeAutoUpdateCron,
  resolveReleaseTrustPolicy,
  shouldPreserveUpdatePath,
  syncSourceTree,
  updateManagedAutoUpdateCronContent,
  type GitHubRelease,
} from "@aripabot/core/update/release-updater.ts";

describe("resolveReleaseTrustPolicy", () => {
  test("uses the official release key when no key is configured", () => {
    expect(
      resolveReleaseTrustPolicy({ repo: "aripabot/aripa", env: {} }).releasePublicKeyPemBase64,
    ).toBe(DEFAULT_RELEASE_PUBLIC_KEY_PEM_B64);
  });

  test("rejects custom repositories without a configured key before download", () => {
    expect(() => resolveReleaseTrustPolicy({ repo: "fork/aripa", env: {} })).toThrow(
      "Release verification public key is required",
    );
  });
});

describe("fetchGitHubReleases", () => {
  test("sorts published releases newest first and marks pre-releases", async () => {
    const releases = await fetchGitHubReleases({
      repo: "Owner/repo",
      userAgent: "aripa-dashboard",
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.github.com/repos/Owner/repo/releases?per_page=100");
        expect(init?.headers).toMatchObject({
          Accept: "application/vnd.github+json",
          "User-Agent": "aripa-dashboard",
          "X-GitHub-Api-Version": "2022-11-28",
        });
        return Response.json([
          {
            id: 1,
            tag_name: "v1.0.0",
            name: "Stable",
            prerelease: false,
            draft: false,
            published_at: "2026-01-01T00:00:00Z",
            created_at: "2026-01-01T00:00:00Z",
            tarball_url: "https://example.com/v1.tar.gz",
            zipball_url: "https://example.com/v1.zip",
            html_url: "https://example.com/v1",
            assets: [],
          },
          {
            id: 2,
            tag_name: "v2.0.0-beta.1",
            name: null,
            prerelease: true,
            draft: false,
            published_at: "2026-02-01T00:00:00Z",
            created_at: "2026-02-01T00:00:00Z",
            tarball_url: "https://example.com/v2.tar.gz",
            zipball_url: "https://example.com/v2.zip",
            html_url: "https://example.com/v2",
            assets: [
              {
                name: "aripa-release.json",
                browser_download_url: "https://example.com/v2/aripa-release.json",
              },
            ],
          },
          {
            id: 3,
            tag_name: "v3.0.0",
            name: "Draft",
            prerelease: false,
            draft: true,
            published_at: "2026-03-01T00:00:00Z",
            created_at: "2026-03-01T00:00:00Z",
            tarball_url: "https://example.com/v3.tar.gz",
            zipball_url: "https://example.com/v3.zip",
            html_url: "https://example.com/v3",
            assets: [],
          },
        ]);
      },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v2.0.0-beta.1", "v1.0.0"]);
    expect(formatReleaseName(releases[0]!)).toBe("v2.0.0-beta.1 [pre-release]");
    expect(releases[0]!.assets).toEqual([
      {
        name: "aripa-release.json",
        downloadUrl: "https://example.com/v2/aripa-release.json",
      },
    ]);
  });
});

describe("release version comparison", () => {
  test("reports the current package version as latest when release ids match", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-version-current-test-"));

    try {
      await Bun.write(join(root, "package.json"), '{"version":"v2.0.0"}\n');

      const result = await compareCurrentPackageVersionWithLatestReleaseVersion({
        cwd: root,
        repo: "Owner/repo",
        fetchImpl: createVersionFetch({
          currentTagName: "v2.0.0",
          latestTagName: "v2.0.0",
        }),
      });

      expect(result).toEqual({
        isLatest: true,
        latestVersion: "v2.0.0",
        currentVersion: "v2.0.0",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports the current package version as behind when a newer release exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-version-behind-test-"));

    try {
      await Bun.write(join(root, "package.json"), '{"version":"v1.0.0"}\n');

      const result = await compareCurrentPackageVersionWithLatestReleaseVersion({
        cwd: root,
        repo: "Owner/repo",
        fetchImpl: createVersionFetch({
          currentTagName: "v1.0.0",
          latestTagName: "v2.0.0",
        }),
      });

      expect(result).toEqual({
        isLatest: false,
        latestVersion: "v2.0.0",
        currentVersion: "v1.0.0",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createVersionFetch(options: {
  currentTagName: string;
  latestTagName: string;
}): (url: string | URL | Request) => Promise<Response> {
  return async (url) => {
    const urlText = String(url);

    if (urlText === "https://api.github.com/repos/Owner/repo/releases?per_page=100") {
      return Response.json([
        githubReleaseResponse({
          id: 2,
          tagName: options.latestTagName,
          publishedAt: "2026-02-01T00:00:00Z",
        }),
        githubReleaseResponse({
          id: options.currentTagName === options.latestTagName ? 2 : 1,
          tagName: options.currentTagName,
          publishedAt: "2026-01-01T00:00:00Z",
        }),
      ]);
    }

    const tagName = decodeURIComponent(urlText.split("/").at(-1) ?? "");
    if (urlText.startsWith("https://api.github.com/repos/Owner/repo/releases/tags/")) {
      return Response.json(
        githubReleaseResponse({
          id: tagName === options.latestTagName ? 2 : 1,
          tagName,
          publishedAt:
            tagName === options.latestTagName ? "2026-02-01T00:00:00Z" : "2026-01-01T00:00:00Z",
        }),
      );
    }

    return new Response("not found", { status: 404, statusText: "Not Found" });
  };
}

function githubReleaseResponse(options: {
  id: number;
  tagName: string;
  publishedAt: string;
}): Record<string, unknown> {
  return {
    id: options.id,
    tag_name: options.tagName,
    name: options.tagName,
    prerelease: false,
    draft: false,
    published_at: options.publishedAt,
    created_at: options.publishedAt,
    tarball_url: `https://example.com/${options.tagName}.tar.gz`,
    zipball_url: `https://example.com/${options.tagName}.zip`,
    html_url: `https://example.com/${options.tagName}`,
    assets: [],
  };
}

describe("syncSourceTree", () => {
  test("mirrors release source directories and preserves local runtime files", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-test-"));
    const source = join(root, "source");
    const destination = join(root, "destination");

    try {
      await mkdir(join(source, "src"), { recursive: true });
      await mkdir(join(destination, "src"), { recursive: true });
      await Bun.write(join(source, "src", "current.ts"), "export const value = 2;\n");
      await Bun.write(join(source, "package.json"), '{"version":"2.0.0"}\n');
      await Bun.write(join(destination, "src", "current.ts"), "export const value = 1;\n");
      await Bun.write(join(destination, "src", "removed.ts"), "old\n");
      await Bun.write(join(destination, "config.json"), '{"token":"local"}\n');
      await Bun.write(join(destination, ".env"), "TOKEN=local\n");
      await Bun.write(join(destination, "aripa.sqlite"), "database\n");
      await Bun.write(join(destination, "local-notes.md"), "keep me\n");

      await syncSourceTree(source, destination);

      await expect(Bun.file(join(destination, "src", "current.ts")).text()).resolves.toBe(
        "export const value = 2;\n",
      );
      expect(await Bun.file(join(destination, "src", "removed.ts")).exists()).toBe(false);
      await expect(Bun.file(join(destination, "package.json")).text()).resolves.toBe(
        '{"version":"2.0.0"}\n',
      );
      await expect(Bun.file(join(destination, "config.json")).text()).resolves.toBe(
        '{"token":"local"}\n',
      );
      await expect(Bun.file(join(destination, ".env")).text()).resolves.toBe("TOKEN=local\n");
      await expect(Bun.file(join(destination, "aripa.sqlite")).text()).resolves.toBe("database\n");
      await expect(Bun.file(join(destination, "local-notes.md")).text()).resolves.toBe("keep me\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recognizes paths that should survive update application", () => {
    expect(shouldPreserveUpdatePath("config.json")).toBe(true);
    expect(shouldPreserveUpdatePath(".env.local")).toBe(true);
    expect(shouldPreserveUpdatePath("node_modules/pkg/index.js")).toBe(true);
    expect(shouldPreserveUpdatePath("aripa.sqlite-wal")).toBe(true);
    expect(shouldPreserveUpdatePath("src/index.ts")).toBe(false);
  });

  test("rejects symlinks from release archives", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-symlink-test-"));
    const source = join(root, "source");
    const destination = join(root, "destination");

    try {
      await mkdir(join(source, "src"), { recursive: true });
      await symlink("../.env", join(source, "src", "leak.ts"));

      await expect(syncSourceTree(source, destination)).rejects.toThrow(
        "Release archive contains unsupported file type: src/leak.ts",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createSignedReleaseFixture(options: {
  root: string;
  sourceDirectory: string;
  tagName?: string;
  archiveName?: string;
}): Promise<{
  release: GitHubRelease;
  publicKeyPem: string;
  fetchImpl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  seenAcceptHeaders: string[];
}> {
  const tagName = options.tagName ?? "v1.0.0";
  const archiveName = options.archiveName ?? `aripa-${tagName}.tar.gz`;
  const archivePath = join(options.root, archiveName);
  await Bun.$`tar -czf ${archivePath} -C ${options.sourceDirectory} repo`.quiet();

  const archiveBytes = await Bun.file(archivePath).arrayBuffer();
  const archiveSha256 = createHash("sha256").update(new Uint8Array(archiveBytes)).digest("hex");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifestText = `${JSON.stringify(
    {
      schemaVersion: 1,
      tagName,
      commitSha: "a".repeat(40),
      archive: {
        name: archiveName,
        sha256: archiveSha256,
      },
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    null,
    2,
  )}\n`;
  const signatureText = `${sign(null, new TextEncoder().encode(manifestText), privateKey).toString("base64")}\n`;
  const seenAcceptHeaders: string[] = [];
  const assetBodies = new Map<string, string | ArrayBuffer>([
    ["https://example.com/aripa-release.json", manifestText],
    ["https://example.com/aripa-release.json.sig", signatureText],
    [`https://example.com/${archiveName}`, archiveBytes],
  ]);

  return {
    release: {
      id: 1,
      tagName,
      name: tagName,
      prerelease: false,
      draft: false,
      publishedAt: "2026-01-01T00:00:00Z",
      tarballUrl: "https://api.github.com/repos/Owner/repo/tarball/v1.0.0",
      zipballUrl: "https://api.github.com/repos/Owner/repo/zipball/v1.0.0",
      htmlUrl: "https://github.com/Owner/repo/releases/tag/v1.0.0",
      assets: [
        {
          name: "aripa-release.json",
          downloadUrl: "https://example.com/aripa-release.json",
        },
        {
          name: "aripa-release.json.sig",
          downloadUrl: "https://example.com/aripa-release.json.sig",
        },
        {
          name: archiveName,
          downloadUrl: `https://example.com/${archiveName}`,
        },
      ],
    },
    publicKeyPem,
    seenAcceptHeaders,
    fetchImpl: async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      seenAcceptHeaders.push(headers.Accept ?? "");

      const body = assetBodies.get(String(url));
      if (!body) {
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }

      return new Response(body);
    },
  };
}

describe("applyReleaseUpdate", () => {
  test("downloads release assets with GitHub asset accept headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-apply-test-"));
    const source = join(root, "source");

    try {
      await mkdir(join(source, "repo", "src"), { recursive: true });
      await Bun.write(join(source, "repo", "src", "index.ts"), "export const updated = true;\n");
      const fixture = await createSignedReleaseFixture({
        root,
        sourceDirectory: source,
      });

      const destination = join(root, "destination");
      await applyReleaseUpdate({
        cwd: destination,
        release: fixture.release,
        installDependencies: false,
        fetchImpl: fixture.fetchImpl,
        releasePublicKeyPem: fixture.publicKeyPem,
      });

      expect(fixture.seenAcceptHeaders).toEqual([
        "application/octet-stream",
        "application/octet-stream",
        "application/octet-stream",
      ]);
      await expect(Bun.file(join(destination, "src", "index.ts")).text()).resolves.toBe(
        "export const updated = true;\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("installs dependencies without running release package scripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-install-test-"));
    const source = join(root, "source");

    try {
      await mkdir(join(source, "repo"), { recursive: true });
      await Bun.write(
        join(source, "repo", "package.json"),
        '{"scripts":{"preinstall":"touch install-script-ran"}}\n',
      );
      const fixture = await createSignedReleaseFixture({
        root,
        sourceDirectory: source,
      });

      const destination = join(root, "destination");
      await applyReleaseUpdate({
        cwd: destination,
        release: fixture.release,
        fetchImpl: fixture.fetchImpl,
        releasePublicKeyPem: fixture.publicKeyPem,
      });

      expect(await Bun.file(join(destination, "install-script-ran")).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects release archives whose hash does not match the signed manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-hash-test-"));
    const source = join(root, "source");

    try {
      await mkdir(join(source, "repo"), { recursive: true });
      await Bun.write(join(source, "repo", "package.json"), "{}\n");
      const fixture = await createSignedReleaseFixture({
        root,
        sourceDirectory: source,
      });

      const destination = join(root, "destination");
      await expect(
        applyReleaseUpdate({
          cwd: destination,
          release: fixture.release,
          installDependencies: false,
          fetchImpl: async (url, init) => {
            if (String(url).endsWith(".tar.gz")) {
              return new Response("tampered archive");
            }

            return fixture.fetchImpl(url, init);
          },
          releasePublicKeyPem: fixture.publicKeyPem,
        }),
      ).rejects.toThrow("Release archive hash verification failed for v1.0.0.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects release manifests with invalid signatures", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-signature-test-"));
    const source = join(root, "source");

    try {
      await mkdir(join(source, "repo"), { recursive: true });
      await Bun.write(join(source, "repo", "package.json"), "{}\n");
      const fixture = await createSignedReleaseFixture({
        root,
        sourceDirectory: source,
      });
      const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");

      const destination = join(root, "destination");
      await expect(
        applyReleaseUpdate({
          cwd: destination,
          release: fixture.release,
          installDependencies: false,
          fetchImpl: fixture.fetchImpl,
          releasePublicKeyPem: otherPublicKey.export({ type: "spki", format: "pem" }).toString(),
        }),
      ).rejects.toThrow("Release manifest signature verification failed for v1.0.0.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("applyLatestReleaseUpdate", () => {
  test("fetches releases and applies the newest published release", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-latest-test-"));
    const source = join(root, "source");

    try {
      await mkdir(join(source, "repo"), { recursive: true });
      await Bun.write(join(source, "repo", "package.json"), '{"version":"v2.0.0"}\n');
      const fixture = await createSignedReleaseFixture({
        root,
        sourceDirectory: source,
        tagName: "v2.0.0",
      });
      const destination = join(root, "destination");

      const result = await applyLatestReleaseUpdate({
        cwd: destination,
        repo: "Owner/repo",
        installDependencies: false,
        fetchImpl: async (url, init) => {
          if (String(url) === "https://api.github.com/repos/Owner/repo/releases?per_page=100") {
            return Response.json([
              githubReleaseResponse({
                id: 1,
                tagName: "v1.0.0",
                publishedAt: "2025-01-01T00:00:00Z",
              }),
              {
                id: fixture.release.id,
                tag_name: fixture.release.tagName,
                name: fixture.release.name,
                prerelease: fixture.release.prerelease,
                draft: fixture.release.draft,
                published_at: fixture.release.publishedAt,
                created_at: fixture.release.publishedAt,
                tarball_url: fixture.release.tarballUrl,
                zipball_url: fixture.release.zipballUrl,
                html_url: fixture.release.htmlUrl,
                assets: fixture.release.assets.map((asset) => ({
                  name: asset.name,
                  browser_download_url: asset.downloadUrl,
                })),
              },
            ]);
          }

          return fixture.fetchImpl(url, init);
        },
        releasePublicKeyPem: fixture.publicKeyPem,
      });

      expect(result.release.tagName).toBe("v2.0.0");
      await expect(Bun.file(join(destination, "package.json")).text()).resolves.toBe(
        '{"version":"v2.0.0"}\n',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("auto-update cron helpers", () => {
  test("builds a managed cron entry for the latest updater", () => {
    expect(
      buildAutoUpdateCronEntry({
        cwd: "/opt/aripa",
        configPath: "/opt/aripa/config.json",
        cronExpression: "0 4 * * 0",
        bunExecutable: "/usr/local/bin/bun",
        logPath: "/opt/aripa/aripa-update.log",
      }),
    ).toBe(
      "0 4 * * 0 cd '/opt/aripa' && CONFIG_PATH='/opt/aripa/config.json' '/usr/local/bin/bun' run update --latest >> '/opt/aripa/aripa-update.log' 2>&1",
    );
  });

  test("resolves cron paths and defaults to the current Bun executable", () => {
    expect(
      buildAutoUpdateCronEntry({
        cwd: "/opt/aripa",
        configPath: "config.json",
        cronExpression: "0 4 * * 0",
      }),
    ).toBe(
      `0 4 * * 0 cd '/opt/aripa' && CONFIG_PATH='${process.cwd()}/config.json' '${process.execPath}' run update --latest >> '/opt/aripa/aripa-update.log' 2>&1`,
    );
  });

  test("replaces an existing managed cron block without touching other jobs", () => {
    const existing = [
      "15 2 * * * /usr/bin/true",
      "",
      "# BEGIN ARIPA AUTO UPDATE",
      "0 4 * * * old command",
      "# END ARIPA AUTO UPDATE",
      "",
    ].join("\n");

    expect(updateManagedAutoUpdateCronContent(existing, "0 4 * * 0 new command")).toBe(
      [
        "15 2 * * * /usr/bin/true",
        "",
        "# BEGIN ARIPA AUTO UPDATE",
        "0 4 * * 0 new command",
        "# END ARIPA AUTO UPDATE",
        "",
      ].join("\n"),
    );
  });

  test("inserts one managed cron block after unmanaged jobs", () => {
    const existing = "15 2 * * * /usr/bin/true\n";
    const cronEntry = "0 4 * * 0 new command";

    expect(updateManagedAutoUpdateCronContent(existing, cronEntry)).toBe(
      [
        "15 2 * * * /usr/bin/true",
        "",
        "# BEGIN ARIPA AUTO UPDATE",
        cronEntry,
        "# END ARIPA AUTO UPDATE",
        "",
      ].join("\n"),
    );
  });

  test("replacing a managed cron block is idempotent", () => {
    const cronEntry = "0 4 * * 0 new command";
    const updated = updateManagedAutoUpdateCronContent(
      [
        "15 2 * * * /usr/bin/true",
        "",
        "# BEGIN ARIPA AUTO UPDATE",
        "0 4 * * * old command",
        "# END ARIPA AUTO UPDATE",
        "",
      ].join("\n"),
      cronEntry,
    );

    expect(updateManagedAutoUpdateCronContent(updated, cronEntry)).toBe(updated);
  });

  test("removes only the managed cron block", () => {
    const existing = [
      "15 2 * * * /usr/bin/true",
      "",
      "# BEGIN ARIPA AUTO UPDATE",
      "0 4 * * * old command",
      "# END ARIPA AUTO UPDATE",
      "",
    ].join("\n");

    expect(removeManagedAutoUpdateCronContent(existing)).toBe("15 2 * * * /usr/bin/true\n");
  });

  test("skips writing when no managed cron block exists", async () => {
    let writes = 0;

    await removeAutoUpdateCron({
      crontabRead: async () => "15 2 * * * /usr/bin/true\n",
      crontabWrite: async () => {
        writes += 1;
      },
    });

    expect(writes).toBe(0);
  });
});
