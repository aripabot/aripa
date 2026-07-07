"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmActionButton } from "@/components/dashboard/components/confirm-action-button";
import { Field, SettingsSection, SwitchField } from "@/components/dashboard/components/fields";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { formatDate, formatTime } from "@/components/dashboard/lib/format";
import { installUpdate, saveConfig } from "@/lib/api";
import type { DashboardStatus, ReleasesResponse, SaveConfigResponse } from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import type { LoadState } from "@/server/dashboard-page-data";
import type { RuntimeJsonConfig } from "@aripabot/core/config/config.ts";
import type { GitHubRelease } from "@aripabot/core/update/release-updater.ts";

export function UpdatesPage({
  releases,
  status,
  currentPackageVersion,
  onRefresh,
  onStatusRefresh,
  onSettingsSaved,
  onInstalled,
}: {
  releases: LoadState<ReleasesResponse>;
  status: LoadState<DashboardStatus>;
  currentPackageVersion: string | null;
  onRefresh: () => void;
  onStatusRefresh: () => void;
  onSettingsSaved: (result: SaveConfigResponse) => void;
  onInstalled: () => void;
}) {
  const [installingTag, setInstallingTag] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function install(tagName: string) {
    setInstallingTag(tagName);
    setMessage(null);
    try {
      const result = await installUpdate({ tagName });
      setMessage(`${result.tagName} installed`);
      onInstalled();
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setInstallingTag(null);
    }
  }

  if (releases.status === "loading") {
    return <LoadingPanel label="Loading" />;
  }

  if (releases.status === "error") {
    return <ErrorPanel title="Updates unavailable" message={releases.error} onRetry={onRefresh} />;
  }

  return (
    <div className="grid max-w-2xl gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          {message ?? releases.data.repo}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Check for updates"
          title="Check for updates"
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>

      {releases.data.releases.length === 0 ? (
        <EmptyPanel
          title="No releases"
          message="Published releases appear here once updates are enabled."
        />
      ) : (
        <div className="divide-y border-y">
          {releases.data.releases.map((release, index) => (
            <ReleaseRow
              key={release.id}
              release={release}
              isLatest={index === 0}
              isInstalled={
                normalizeVersionTag(release.tagName) === normalizeVersionTag(currentPackageVersion)
              }
              installingTag={installingTag}
              onInstall={(tagName) => void install(tagName)}
            />
          ))}
        </div>
      )}

      <UpdateSettings status={status} onRetry={onStatusRefresh} onSaved={onSettingsSaved} />
    </div>
  );
}

function ReleaseRow({
  release,
  isLatest,
  isInstalled,
  installingTag,
  onInstall,
}: {
  release: GitHubRelease;
  isLatest: boolean;
  isInstalled: boolean;
  installingTag: string | null;
  onInstall: (tagName: string) => void;
}) {
  const meta = [release.tagName, formatDate(release.publishedAt)];
  if (release.prerelease) {
    meta.push("Pre-release");
  }

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{release.name}</p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{meta.join(" · ")}</p>
      </div>
      {isInstalled ? (
        <p className="shrink-0 text-sm text-muted-foreground">Installed</p>
      ) : (
        <ConfirmActionButton
          title={`Install ${release.tagName}`}
          description="Downloads this release and installs it over the current version."
          confirmLabel="Install"
          disabled={installingTag !== null}
          onConfirm={() => onInstall(release.tagName)}
          trigger={
            <Button
              type="button"
              size="sm"
              variant={isLatest ? "default" : "outline"}
              disabled={installingTag !== null}
            >
              {installingTag === release.tagName ? "Installing…" : "Install"}
            </Button>
          }
        />
      )}
    </div>
  );
}

function UpdateSettings({
  status,
  onRetry,
  onSaved,
}: {
  status: LoadState<DashboardStatus>;
  onRetry: () => void;
  onSaved: (result: SaveConfigResponse) => void;
}) {
  const [config, setConfig] = useState<RuntimeJsonConfig | null>(
    status.status === "ready" ? status.data.config : null,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status.status === "ready") {
      setConfig(status.data.config);
    }
  }, [status]);

  const dirty = useMemo(() => {
    if (status.status !== "ready" || config === null) {
      return false;
    }

    return JSON.stringify(config.updates) !== JSON.stringify(status.data.config.updates);
  }, [config, status]);

  if (status.status === "loading" || config === null) {
    return <LoadingPanel label="Loading" />;
  }

  if (status.status === "error") {
    return <ErrorPanel title="Settings unavailable" message={status.error} onRetry={onRetry} />;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (config === null) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await saveConfig({ config });
      setConfig(result.config);
      setMessage(`Saved at ${formatTime(result.savedAt)}`);
      onSaved(result);
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <SettingsSection title="Automatic updates">
        <div className="grid gap-5">
          <SwitchField
            label="Check for releases"
            checked={config.updates.enabled}
            onCheckedChange={(enabled) =>
              setConfig({ ...config, updates: { ...config.updates, enabled } })
            }
          />
          <SwitchField
            label="Install automatically"
            hint="New releases install on the schedule below."
            checked={config.updates.autoInstall.enabled}
            onCheckedChange={(enabled) =>
              setConfig({
                ...config,
                updates: {
                  ...config.updates,
                  autoInstall: { ...config.updates.autoInstall, enabled },
                },
              })
            }
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Repository" htmlFor="update-repo">
              <Input
                id="update-repo"
                name="update-repository"
                autoComplete="off"
                value={config.updates.githubRepo}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    updates: { ...config.updates, githubRepo: event.target.value },
                  })
                }
                spellCheck={false}
              />
            </Field>
            <Field label="Schedule" htmlFor="update-cron" hint="Cron expression.">
              <Input
                id="update-cron"
                name="update-cron-expression"
                autoComplete="off"
                className="font-mono"
                value={config.updates.autoInstall.cronExpression}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    updates: {
                      ...config.updates,
                      autoInstall: {
                        ...config.updates.autoInstall,
                        cronExpression: event.target
                          .value as RuntimeJsonConfig["updates"]["autoInstall"]["cronExpression"],
                      },
                    },
                  })
                }
                spellCheck={false}
              />
            </Field>
          </div>
          <Field
            label="Release signing key"
            htmlFor="release-key"
            hint="Optional. Installs are skipped unless the release matches this public key."
          >
            <Textarea
              id="release-key"
              name="release-public-key"
              autoComplete="off"
              className="font-mono"
              value={config.updates.releasePublicKeyPemBase64 ?? ""}
              onChange={(event) =>
                setConfig({
                  ...config,
                  updates: {
                    ...config.updates,
                    releasePublicKeyPemBase64: event.target.value.trim() || undefined,
                  },
                })
              }
              spellCheck={false}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
            {message ?? (dirty ? "Unsaved changes" : "")}
          </p>
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </SettingsSection>
    </form>
  );
}

function normalizeVersionTag(value: string | null): string | null {
  return value?.replace(/^v(?=\d)/i, "") ?? null;
}
