"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import {
  Activity,
  Container,
  Download,
  LogOut,
  Logs,
  Moon,
  Play,
  RefreshCw,
  Save,
  Settings,
  Square,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getDockerDeploymentStatus,
  getLogs,
  getReleases,
  getStatus,
  installUpdate,
  runDockerDeploymentCommand,
  saveConfig,
} from "@/lib/api";
import { readableError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ConfirmActionButton } from "@/components/dashboard/components/confirm-action-button";
import {
  DeploymentMetric,
  DockerCommandOutput,
} from "@/components/dashboard/components/docker-display";
import { Field, SwitchField } from "@/components/dashboard/components/fields";
import { ModelCard } from "@/components/dashboard/components/model-card";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { DashboardOnboardingScreen } from "@/components/dashboard/dashboard-onboarding-screen";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { formatDate, formatDateTime, formatTime } from "@/components/dashboard/lib/format";
import { LogsPage } from "@/components/dashboard/pages/logs";
import { Overview } from "@/components/dashboard/pages/overview";
import type {
  CompleteOnboardingResponse,
  DashboardStatus,
  DockerDeploymentAction,
  DockerDeploymentCommandResponse,
  DockerDeploymentStatus,
  ReleasesResponse,
  SaveConfigResponse,
} from "@/lib/api-types";
import type { DashboardInitialData, LoadState } from "@/server/dashboard-page-data";
import type { RuntimeJsonConfig, RuntimeModelSelection } from "@aripabot/core/config/config.ts";

export type View = "overview" | "logs" | "updates" | "docker-deployments" | "settings";
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const views: Array<{ id: View; label: string; href: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", href: "/", icon: Activity },
  { id: "logs", label: "Logs", href: "/logs", icon: Logs },
  { id: "updates", label: "Updates", href: "/updates", icon: Download },
  {
    id: "docker-deployments",
    label: "Docker Deployments",
    href: "/docker-deployments",
    icon: Container,
  },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
];

export function Dashboard({
  view,
  initialData = {},
}: {
  view: View;
  initialData?: DashboardInitialData;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const {
    state: statusState,
    refresh: refreshStatus,
    setState: setStatusState,
  } = useLoadState(getStatus, initialData.status);
  const { state: logsState, refresh: refreshLogs } = useLoadState(getLogs, initialData.logs);
  const { state: releasesState, refresh: refreshReleases } = useLoadState(
    getReleases,
    initialData.releases,
  );
  const {
    state: dockerState,
    refresh: refreshDockerDeployment,
    setState: setDockerState,
  } = useLoadState(getDockerDeploymentStatus, initialData.dockerDeployment);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");
  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
  const activeHref = pendingHref ?? pathname;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  function markNavigationPending(href: string, event: React.MouseEvent<HTMLAnchorElement>): void {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      href === pathname
    ) {
      return;
    }

    setPendingHref(href);
  }

  function completeFirstRun(result: CompleteOnboardingResponse): void {
    setStatusState((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        error: null,
        data: {
          ...current.data,
          appName: result.config.name,
          configPath: result.path,
          configExists: true,
          config: result.config,
        },
      };
    });
    router.refresh();
  }

  if (statusState.status === "ready" && !statusState.data.configExists) {
    return (
      <DashboardOnboardingScreen
        initialStatus={statusState.data}
        onComplete={completeFirstRun}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[16rem_1fr]">
        <aside
          className="border-b bg-card/70 lg:border-b-0 lg:border-r"
          style={{ viewTransitionName: "dashboard-sidebar" } as React.CSSProperties}
        >
          <div className="flex h-full flex-col gap-5 p-4">
            <div className="flex items-center gap-3">
              <picture>
                <img
                  src={resolvedTheme === "dark" ? "/aripa-mark-dark.svg" : "/aripa-mark-light.svg"}
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="size-10 rounded-lg"
                />
              </picture>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Aripa</p>
                <p className="text-xs text-muted-foreground">Local dashboard (Experimental)</p>
              </div>
            </div>

            <nav
              aria-label="Dashboard"
              className="grid grid-cols-2 gap-1 sm:grid-cols-5 lg:flex lg:flex-col"
            >
              {views.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    prefetch={true}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center justify-start gap-2 rounded-md px-4 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active ? "bg-foreground text-background" : "text-foreground",
                    )}
                    onClick={(event) => markNavigationPending(item.href, event)}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto hidden rounded-lg border bg-background p-3 text-sm lg:block">
              <p className="font-medium">Runtime</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {statusState.status === "ready"
                  ? statusState.data.configPath
                  : "Loading config path…"}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </aside>

        <div className="min-w-0">
          <header
            className="sticky top-0 z-20 border-b bg-background/92 backdrop-blur"
            style={{ viewTransitionName: "dashboard-header" } as React.CSSProperties}
          >
            <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="min-w-0">
                <h1 className="truncate text-pretty text-xl font-semibold tracking-normal sm:text-2xl">
                  {viewTitle(view)}
                </h1>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={themeButtonLabel(themeMode, resolvedTheme)}
                title={themeButtonLabel(themeMode, resolvedTheme)}
                onClick={() => setThemeMode(nextThemeMode(themeMode))}
              >
                {resolvedTheme === "dark" ? (
                  <Sun aria-hidden="true" />
                ) : (
                  <Moon aria-hidden="true" />
                )}
              </Button>
            </div>
          </header>

          <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
            {statusState.status === "error" ? (
              <ErrorPanel
                title="Dashboard unavailable"
                message={statusState.error}
                onRetry={refreshStatus}
              />
            ) : (
              <>
                {view === "overview" && <Overview status={statusState} onRefresh={refreshStatus} />}
                {view === "logs" && <LogsPage logs={logsState} onRefresh={refreshLogs} />}
                {view === "updates" && (
                  <UpdatesPage
                    releases={releasesState}
                    status={statusState}
                    currentPackageVersion={
                      statusState.status === "ready" ? statusState.data.botVersion : null
                    }
                    onRefresh={refreshReleases}
                    onStatusRefresh={refreshStatus}
                    onSettingsSaved={() => {
                      void refreshStatus();
                      void refreshReleases();
                    }}
                    onInstalled={() => {
                      void refreshReleases();
                      void refreshStatus();
                    }}
                  />
                )}
                {view === "docker-deployments" && (
                  <DockerDeploymentsPage
                    deployment={dockerState}
                    onRefresh={() => {
                      void refreshDockerDeployment();
                      void refreshStatus();
                    }}
                    onStatusChange={(nextStatus) => {
                      setDockerState({ status: "ready", data: nextStatus, error: null });
                      void refreshStatus();
                    }}
                  />
                )}
                {view === "settings" && statusState.status === "ready" && (
                  <SettingsPage
                    status={statusState.data}
                    onSaved={(result) => {
                      setStatusState({
                        status: "ready",
                        data: {
                          ...statusState.data,
                          appName: result.config.name,
                          config: result.config,
                        },
                        error: null,
                      });
                    }}
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function UpdatesPage({
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

function DockerDeploymentsPage({
  deployment,
  onRefresh,
  onStatusChange,
}: {
  deployment: LoadState<DockerDeploymentStatus>;
  onRefresh: () => void;
  onStatusChange: (status: DockerDeploymentStatus) => void;
}) {
  const [runningAction, setRunningAction] = useState<DockerDeploymentAction | null>(null);
  const [commandResult, setCommandResult] = useState<DockerDeploymentCommandResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runAction(action: DockerDeploymentAction) {
    setRunningAction(action);
    setMessage(null);
    setCommandResult(null);
    try {
      const result = await runDockerDeploymentCommand({ action });
      setCommandResult(result);
      onStatusChange(result.status);
      setMessage(
        result.exitCode === 0
          ? `${dockerActionLabel(action)} completed.`
          : `${dockerActionLabel(action)} exited with code ${result.exitCode}.`,
      );
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setRunningAction(null);
    }
  }

  if (deployment.status === "loading") {
    return <LoadingPanel label="Loading Docker deployment" />;
  }

  if (deployment.status === "error") {
    return (
      <ErrorPanel
        title="Docker deployment unavailable"
        message={deployment.error}
        onRetry={onRefresh}
      />
    );
  }

  const startScript = deployment.data.scripts.find((script) => script.action === "start");
  const stopScript = deployment.data.scripts.find((script) => script.action === "stop");
  const running = deployment.data.state === "running";

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-medium ${dockerStateClass(
                  deployment.data.state,
                )}`}
              >
                <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                {deployment.data.stateLabel}
              </span>
              <p className="break-words text-sm text-muted-foreground">{deployment.data.detail}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <DeploymentMetric label="Status" value={deployment.data.stateLabel} detail="" />
          <DeploymentMetric
            label="Container"
            value={deployment.data.containerName}
            detail={
              deployment.data.containerId ? `ID ${deployment.data.containerId}` : "Not created"
            }
          />
          <DeploymentMetric
            label="Image"
            value={deployment.data.imageName}
            detail={deployment.data.imageId ? `ID ${deployment.data.imageId}` : "Not built"}
          />
          <DeploymentMetric
            label="Started"
            value={
              deployment.data.startedAt ? formatDateTime(deployment.data.startedAt) : "Not started"
            }
            detail=""
          />
        </div>
      </section>

      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Deployment Controls</CardTitle>
            <CardDescription>Start, restart, or stop the local Docker deployment.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {message ? (
              <p className="rounded-md border bg-background px-3 py-2 text-sm" aria-live="polite">
                {message}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <ConfirmActionButton
                title={running ? "Restart Deployment" : "Start Deployment"}
                description={
                  running
                    ? "Restart the Docker deployment now. The bot may be briefly unavailable."
                    : "Start the Docker deployment now."
                }
                confirmLabel={running ? "Restart Deployment" : "Start Deployment"}
                disabled={runningAction !== null || startScript?.available !== true}
                onConfirm={() => void runAction("start")}
                trigger={
                  <Button
                    type="button"
                    disabled={runningAction !== null || startScript?.available !== true}
                  >
                    <Play aria-hidden="true" />
                    {runningAction === "start"
                      ? "Starting…"
                      : running
                        ? "Restart Deployment"
                        : "Start Deployment"}
                  </Button>
                }
              />
              <ConfirmActionButton
                title="Stop Deployment"
                description="Stop the Docker deployment now. Aripa will be offline until it is started again."
                confirmLabel="Stop Deployment"
                disabled={runningAction !== null || stopScript?.available !== true}
                onConfirm={() => void runAction("stop")}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={runningAction !== null || stopScript?.available !== true}
                  >
                    <Square aria-hidden="true" />
                    {runningAction === "stop" ? "Stopping…" : "Stop Deployment"}
                  </Button>
                }
              />
            </div>
            <div className="grid gap-2">
              {deployment.data.scripts.map((script) => (
                <div
                  key={script.action}
                  className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{script.label}</p>
                  </div>
                  <span
                    className={`w-fit rounded-sm px-1.5 py-0.5 text-xs ${script.available ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {script.available ? "Available" : "Missing"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {commandResult ? <DockerCommandOutput result={commandResult} /> : null}
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

function SettingsPage({
  status,
  onSaved,
}: {
  status: DashboardStatus;
  onSaved: (result: SaveConfigResponse) => void;
}) {
  const [config, setConfig] = useState<RuntimeJsonConfig>(status.config);
  const [allowlistInput, setAllowlistInput] = useState(
    status.config.allowlistedServerIds.join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = useMemo(
    () =>
      JSON.stringify(config) !== JSON.stringify(status.config) ||
      allowlistInput !== status.config.allowlistedServerIds.join("\n"),
    [allowlistInput, config, status.config],
  );

  const hasWebModel = config.models.web.enabled;

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const nextConfig = {
        ...config,
        allowlistedServerIds: allowlistInput
          .split(/[\s,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
      const result = await saveConfig({ config: nextConfig });
      setConfig(result.config);
      setAllowlistInput(result.config.allowlistedServerIds.join("\n"));
      setMessage(`Saved ${formatTime(result.savedAt)}.`);
      onSaved(result);
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setSaving(false);
    }
  }

  function updateModel(role: "agent" | "summarizer", patch: Partial<RuntimeModelSelection>) {
    setConfig((current) => ({
      ...current,
      models: {
        ...current.models,
        [role]: {
          ...current.models[role],
          ...patch,
        },
      },
    }));
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="break-words text-sm text-muted-foreground">
          Changes are written to {status.configPath}.
        </p>
        <Button type="submit" disabled={saving}>
          <Save aria-hidden="true" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
      {message ? (
        <p className="rounded-md border bg-card px-3 py-2 text-sm" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>How Aripa presents itself.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Bot name" htmlFor="name">
              <Input
                id="name"
                name="name"
                autoComplete="off"
                value={config.name}
                onChange={(event) => setConfig({ ...config, name: event.target.value })}
                required
              />
            </Field>
            <Field label="Operator user ID" htmlFor="operator">
              <Input
                id="operator"
                name="operator-user-id"
                autoComplete="off"
                inputMode="numeric"
                value={config.operatorUserId ?? ""}
                onChange={(event) =>
                  setConfig({ ...config, operatorUserId: event.target.value.trim() || null })
                }
                placeholder="Optional Discord user ID…"
                spellCheck={false}
              />
            </Field>
            <Field label="Style" htmlFor="style">
              <Select
                value={config.stylePrompt}
                onValueChange={(value) => setConfig({ ...config, stylePrompt: value })}
              >
                <SelectTrigger id="style">
                  <SelectValue placeholder="Choose a style" />
                </SelectTrigger>
                <SelectContent>
                  {status.styles.map((style) => (
                    <SelectItem key={style.value} value={style.value}>
                      {style.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access Controls</CardTitle>
            <CardDescription>Servers allowed to use Aripa.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Server allowlist" htmlFor="allowlist">
              <Textarea
                id="allowlist"
                name="allowlisted-server-ids"
                autoComplete="off"
                value={allowlistInput}
                onChange={(event) => setAllowlistInput(event.target.value)}
                placeholder="One Discord server ID per line…"
                spellCheck={false}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent Controls</CardTitle>
            <CardDescription>Limits and privacy defaults for agent replies.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Rate limit" htmlFor="rate-limit">
              <Input
                id="rate-limit"
                name="agent-rate-limit"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentRateLimitMessagesPerMinute ?? ""}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    agentRateLimitMessagesPerMinute:
                      event.target.value.trim() === "" ? null : Number(event.target.value),
                  })
                }
                placeholder="Off…"
              />
            </Field>
            <Field label="Timeout" htmlFor="timeout">
              <Input
                id="timeout"
                name="agent-timeout"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentTimeoutMs}
                onChange={(event) =>
                  setConfig({ ...config, agentTimeoutMs: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Global concurrency" htmlFor="global-concurrency">
              <Input
                id="global-concurrency"
                name="agent-global-concurrency"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentMaxConcurrentRequests}
                onChange={(event) =>
                  setConfig({ ...config, agentMaxConcurrentRequests: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Per-server concurrency" htmlFor="guild-concurrency">
              <Input
                id="guild-concurrency"
                name="agent-guild-concurrency"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentMaxConcurrentRequestsPerGuild}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    agentMaxConcurrentRequestsPerGuild: Number(event.target.value),
                  })
                }
              />
            </Field>
            <SwitchField
              label="Private logs"
              checked={config.logPrivacy}
              onCheckedChange={(checked) => setConfig({ ...config, logPrivacy: checked })}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ModelCard
          title="Agent Model"
          model={config.models.agent}
          providers={status.providers.filter((provider) => provider !== "google")}
          reasoningEfforts={status.reasoningEfforts}
          onChange={(patch) => updateModel("agent", patch)}
        />
        <ModelCard
          title="Summarizer Model"
          model={config.models.summarizer}
          providers={status.providers.filter((provider) => provider !== "google")}
          reasoningEfforts={status.reasoningEfforts}
          onChange={(patch) => updateModel("summarizer", patch)}
        />
        <Card>
          <CardHeader>
            <CardTitle>Web Search</CardTitle>
            <CardDescription>Optional search model for recent context.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SwitchField
              label="Enable web search"
              checked={hasWebModel}
              onCheckedChange={(enabled) =>
                setConfig({
                  ...config,
                  models: { ...config.models, web: { ...config.models.web, enabled } },
                })
              }
            />
            <Field label="Model" htmlFor="web-model">
              <Input
                id="web-model"
                name="web-model"
                autoComplete="off"
                value={config.models.web.model}
                disabled={!hasWebModel}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    models: {
                      ...config.models,
                      web: { ...config.models.web, model: event.target.value },
                    },
                  })
                }
              />
            </Field>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

function viewTitle(view: View): string {
  return views.find((item) => item.id === view)?.label ?? "Overview";
}

type BadgeTone = "success" | "danger" | "warning" | "info" | "muted";

const badgeToneClasses: Record<BadgeTone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

function badgeToneClass(tone: BadgeTone): string {
  return badgeToneClasses[tone];
}

function dockerStateClass(state: DockerDeploymentStatus["state"]): string {
  switch (state) {
    case "running":
      return badgeToneClass("success");
    case "stopped":
      return badgeToneClass("danger");
    case "unknown":
      return badgeToneClass("muted");
  }
}

function dockerActionLabel(action: DockerDeploymentAction): string {
  switch (action) {
    case "start":
      return "Start Deployment";
    case "stop":
      return "Stop Deployment";
  }
}

function normalizeVersionTag(value: string | null): string | null {
  return value?.replace(/^v(?=\d)/i, "") ?? null;
}

function nextThemeMode(themeMode: ThemeMode): ThemeMode {
  switch (themeMode) {
    case "system":
      return "dark";
    case "dark":
      return "light";
    case "light":
      return "system";
  }
}

function themeButtonLabel(themeMode: ThemeMode, resolvedTheme: ResolvedTheme): string {
  switch (themeMode) {
    case "system":
      return `Using system appearance (${resolvedTheme}). Use dark appearance`;
    case "dark":
      return "Using dark appearance. Use light appearance";
    case "light":
      return "Using light appearance. Use system appearance";
  }
}
