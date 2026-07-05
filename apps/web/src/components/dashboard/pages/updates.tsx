"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { Download, RefreshCw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmActionButton } from "@/components/dashboard/components/confirm-action-button";
import { Field, SwitchField } from "@/components/dashboard/components/fields";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { formatDate, formatTime } from "@/components/dashboard/lib/format";
import { installUpdate, saveConfig } from "@/lib/api";
import type { DashboardStatus, ReleasesResponse, SaveConfigResponse } from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import type { LoadState } from "@/server/dashboard-page-data";
import type { RuntimeJsonConfig } from "@aripabot/core/config/config.ts";

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
      setMessage(`${result.tagName} installed successfully.`);
      onInstalled();
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setInstallingTag(null);
    }
  }

  if (releases.status === "loading") {
    return <LoadingPanel label="Loading releases" />;
  }

  if (releases.status === "error") {
    return <ErrorPanel title="Updates unavailable" message={releases.error} onRetry={onRefresh} />;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">
          Published releases for {releases.data.repo}.
        </p>
        <Button type="button" variant="outline" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {message ? (
        <p className="rounded-md border bg-card px-3 py-2 text-sm" aria-live="polite">
          {message}
        </p>
      ) : null}
      <UpdateSettingsPanel status={status} onRetry={onStatusRefresh} onSaved={onSettingsSaved} />
      {releases.data.releases.length === 0 ? (
        <EmptyPanel
          title="No releases available"
          message="Updates are disabled or no published releases were found."
        />
      ) : (
        <div className="grid gap-3">
          {releases.data.releases.map((release, index) => {
            const isInstalled =
              normalizeVersionTag(release.tagName) === normalizeVersionTag(currentPackageVersion);

            return (
              <Card key={release.id}>
                <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{release.name}</h2>
                      {index === 0 ? (
                        <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">
                          Latest
                        </span>
                      ) : null}
                      {isInstalled ? (
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                          Installed
                        </span>
                      ) : null}
                      {release.prerelease ? (
                        <span className="rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning">
                          Pre-release
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {release.tagName} · {formatDate(release.publishedAt)}
                    </p>
                  </div>
                  <ConfirmActionButton
                    title="Install Update"
                    description={`Install ${release.tagName}. The dashboard will refresh release and runtime status after the update finishes.`}
                    confirmLabel="Install Update"
                    disabled={installingTag !== null || isInstalled}
                    onConfirm={() => void install(release.tagName)}
                    trigger={
                      <Button
                        type="button"
                        variant={index === 0 ? "default" : "outline"}
                        disabled={installingTag !== null || isInstalled}
                      >
                        <Download aria-hidden="true" />
                        {isInstalled
                          ? "Installed"
                          : installingTag === release.tagName
                            ? "Installing…"
                            : "Install"}
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UpdateSettingsPanel({
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
    return <LoadingPanel label="Loading update settings" />;
  }

  if (status.status === "error") {
    return (
      <ErrorPanel title="Update settings unavailable" message={status.error} onRetry={onRetry} />
    );
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
      setMessage(`Saved ${formatTime(result.savedAt)}.`);
      onSaved(result);
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Update Settings</CardTitle>
          <CardDescription>Release source and automatic install schedule.</CardDescription>
        </div>
        <Button type="submit" form="update-settings-form" disabled={saving || !dirty}>
          <Save aria-hidden="true" />
          {saving ? "Saving…" : "Save Update Settings"}
        </Button>
      </CardHeader>
      <CardContent>
        <form id="update-settings-form" className="grid gap-4" onSubmit={submit}>
          {message ? (
            <p className="rounded-md border bg-background px-3 py-2 text-sm" aria-live="polite">
              {message}
            </p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <SwitchField
              label="Enable updates"
              checked={config.updates.enabled}
              onCheckedChange={(enabled) =>
                setConfig({ ...config, updates: { ...config.updates, enabled } })
              }
            />
            <SwitchField
              label="Automatic installs"
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
              />
            </Field>
            <Field label="Cron expression" htmlFor="update-cron">
              <Input
                id="update-cron"
                name="update-cron-expression"
                autoComplete="off"
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
              />
            </Field>
            <Field label="Release public key" htmlFor="release-key">
              <Textarea
                id="release-key"
                name="release-public-key"
                autoComplete="off"
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
                placeholder="Optional base64 public key…"
                spellCheck={false}
              />
            </Field>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function normalizeVersionTag(value: string | null): string | null {
  return value?.replace(/^v(?=\d)/i, "") ?? null;
}
