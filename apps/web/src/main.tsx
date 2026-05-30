import { StrictMode, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  CheckCircle2,
  Download,
  Logs,
  Moon,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
} from "lucide-react";

import aripaMarkDark from "@/assets/aripa-mark-dark.svg";
import aripaMarkLight from "@/assets/aripa-mark-light.svg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getLogs, getReleases, getStatus, installUpdate, saveConfig } from "@/lib/api";
import type {
  DashboardStatus,
  LocalLogFile,
  ReleasesResponse,
  SaveConfigResponse,
} from "@/lib/api-types";
import type { RuntimeJsonConfig, RuntimeModelSelection } from "@aripabot/core/config/config.ts";
import "./styles.css";

type View = "overview" | "logs" | "updates" | "settings";
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
type LoadState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

const views: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "logs", label: "Logs", icon: Logs },
  { id: "updates", label: "Updates", icon: Download },
  { id: "settings", label: "Settings", icon: Settings },
];

function App() {
  const [view, setView] = useState<View>(() => parseView(window.location.hash));
  const [statusState, setStatusState] = useState<LoadState<DashboardStatus>>(() =>
    initialLoadState(),
  );
  const [logsState, setLogsState] = useState<LoadState<LocalLogFile[]>>(() => initialLoadState());
  const [releasesState, setReleasesState] = useState<LoadState<ReleasesResponse>>(() =>
    initialLoadState(),
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => preferredTheme());
  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    const onHashChange = () => setView(parseView(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (view === "logs" && logsState.status === "loading") {
      void refreshLogs();
    }
    if (view === "updates" && releasesState.status === "loading") {
      void refreshReleases();
    }
  }, [view, logsState.status, releasesState.status]);

  async function refreshStatus() {
    setStatusState(initialLoadState());
    try {
      setStatusState({ status: "ready", data: await getStatus(), error: null });
    } catch (error) {
      setStatusState({ status: "error", data: null, error: readableError(error) });
    }
  }

  async function refreshLogs() {
    setLogsState(initialLoadState());
    try {
      const logs = await getLogs();
      setLogsState({ status: "ready", data: logs.files, error: null });
    } catch (error) {
      setLogsState({ status: "error", data: null, error: readableError(error) });
    }
  }

  async function refreshReleases() {
    setReleasesState(initialLoadState());
    try {
      setReleasesState({ status: "ready", data: await getReleases(), error: null });
    } catch (error) {
      setReleasesState({ status: "error", data: null, error: readableError(error) });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[16rem_1fr]">
        <aside className="border-b bg-card/70 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-5 p-4">
            <div className="flex items-center gap-3">
              <picture>
                <img
                  src={resolvedTheme === "dark" ? aripaMarkDark : aripaMarkLight}
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="size-10 rounded-lg"
                />
              </picture>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Aripa</p>
                <p className="text-xs text-muted-foreground">Local dashboard</p>
              </div>
            </div>

            <nav
              aria-label="Dashboard"
              className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:flex lg:flex-col"
            >
              {views.map((item) => {
                const Icon = item.icon;
                const active = item.id === view;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    aria-current={active ? "page" : undefined}
                    className="inline-flex h-10 items-center justify-start gap-2 rounded-md px-4 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    style={
                      active
                        ? {
                            backgroundColor: "hsl(var(--foreground))",
                            color: "hsl(var(--background))",
                          }
                        : { color: "hsl(var(--foreground))" }
                    }
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </a>
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
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b bg-background/92 backdrop-blur">
            <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Aripa control room
                </p>
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
                    onRefresh={refreshReleases}
                    onInstalled={() => {
                      void refreshReleases();
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

function Overview({
  status,
  onRefresh,
}: {
  status: LoadState<DashboardStatus>;
  onRefresh: () => void;
}) {
  if (status.status === "loading") {
    return <LoadingPanel label="Loading dashboard" />;
  }

  if (status.status === "error") {
    return <ErrorPanel title="Overview unavailable" message={status.error} onRetry={onRefresh} />;
  }

  const config = status.data.config;
  const statCards = [
    { label: "Bot name", value: config.name, icon: Bot },
    { label: "Prefix", value: status.data.prefix, icon: Terminal },
    {
      label: "Token",
      value: status.data.tokenConfigured ? "Configured" : "Missing",
      icon: ShieldCheck,
    },
    { label: "Version", value: status.data.botVersion, icon: CheckCircle2 },
  ];

  return (
    <div className="grid gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm text-muted-foreground">
            A compact view of the bot runtime and local configuration.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="truncate text-2xl font-semibold">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Agent</CardTitle>
            <CardDescription>Current model selection and guardrails.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Detail
              label="Agent model"
              value={`${config.models.agent.provider} / ${config.models.agent.model}`}
            />
            <Detail
              label="Summarizer"
              value={`${config.models.summarizer.provider} / ${config.models.summarizer.model}`}
            />
            <Detail
              label="Web search"
              value={config.models.web.enabled ? config.models.web.model : "Disabled"}
            />
            <Detail
              label="Rate limit"
              value={
                config.agentRateLimitMessagesPerMinute === null
                  ? "Off"
                  : `${config.agentRateLimitMessagesPerMinute} messages per minute`
              }
            />
            <Detail
              label="Concurrent requests"
              value={`${config.agentMaxConcurrentRequests} global, ${config.agentMaxConcurrentRequestsPerGuild} per server`}
            />
            <Detail label="Style" value={config.stylePrompt} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>Server allowlist and privacy posture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Detail
              label="Allowlisted servers"
              value={
                config.allowlistedServerIds.length === 0
                  ? "No servers configured"
                  : `${config.allowlistedServerIds.length} server${config.allowlistedServerIds.length === 1 ? "" : "s"}`
              }
            />
            <Detail label="Log privacy" value={config.logPrivacy ? "Enabled" : "Disabled"} />
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Database</p>
              <p className="mt-1 break-all text-sm">{status.data.databasePath}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LogsPage({ logs, onRefresh }: { logs: LoadState<LocalLogFile[]>; onRefresh: () => void }) {
  const [query, setQuery] = useState("");

  if (logs.status === "loading") {
    return <LoadingPanel label="Loading logs" />;
  }

  if (logs.status === "error") {
    return <ErrorPanel title="Logs unavailable" message={logs.error} onRetry={onRefresh} />;
  }

  const availableFiles = logs.data.filter((file) => file.exists);
  const visibleFiles = availableFiles.map((file) => ({
    ...file,
    lines: file.lines.filter((line) => line.toLowerCase().includes(query.toLowerCase())),
  }));

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-md">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter logs"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter log lines"
          />
        </div>
        <Button type="button" variant="outline" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {availableFiles.length === 0 ? (
        <EmptyPanel
          title="No local log files found"
          message="Start Aripa with file logging enabled to review recent entries here."
        />
      ) : (
        <div className="grid gap-4">
          {visibleFiles.map((file) => (
            <Card key={file.path}>
              <CardHeader>
                <CardTitle>{file.name}</CardTitle>
                <CardDescription>
                  {file.updatedAt
                    ? `Updated ${new Date(file.updatedAt).toLocaleString()}`
                    : "Not available"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[28rem] overflow-auto rounded-md bg-background p-3 text-xs leading-5 text-foreground">
                  {file.lines.length > 0 ? file.lines.join("\n") : "No matching lines."}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdatesPage({
  releases,
  onRefresh,
  onInstalled,
}: {
  releases: LoadState<ReleasesResponse>;
  onRefresh: () => void;
  onInstalled: () => void;
}) {
  const [installingTag, setInstallingTag] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function install(tagName: string) {
    if (!window.confirm(`Install ${tagName}? Aripa will update local release files.`)) {
      return;
    }

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
      {releases.data.releases.length === 0 ? (
        <EmptyPanel
          title="No releases available"
          message="Updates are disabled or no published releases were found."
        />
      ) : (
        <div className="grid gap-3">
          {releases.data.releases.map((release, index) => (
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
                <Button
                  type="button"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={installingTag !== null}
                  onClick={() => void install(release.tagName)}
                >
                  <Download aria-hidden="true" />
                  {installingTag === release.tagName ? "Installing…" : "Install"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>How Aripa presents itself and limits access.</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>Release source and automatic update schedule.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
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
        </CardContent>
      </Card>
    </form>
  );
}

function ModelCard({
  title,
  model,
  providers,
  reasoningEfforts,
  onChange,
}: {
  title: string;
  model: RuntimeModelSelection;
  providers: DashboardStatus["providers"];
  reasoningEfforts: DashboardStatus["reasoningEfforts"];
  onChange: (patch: Partial<RuntimeModelSelection>) => void;
}) {
  const idBase = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Provider, model, and reasoning settings.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Provider" htmlFor={`${idBase}-provider`}>
          <Select
            value={model.provider}
            onValueChange={(provider) =>
              onChange({ provider: provider as RuntimeModelSelection["provider"] })
            }
          >
            <SelectTrigger id={`${idBase}-provider`}>
              <SelectValue placeholder="Choose provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Model" htmlFor={`${idBase}-model`}>
          <Input
            id={`${idBase}-model`}
            name={`${idBase}-model`}
            autoComplete="off"
            value={model.model}
            onChange={(event) => onChange({ model: event.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field label="Reasoning" htmlFor={`${idBase}-reasoning`}>
          <Select
            value={model.reasoningEffort ?? "low"}
            onValueChange={(reasoningEffort) =>
              onChange({
                reasoningEffort: reasoningEffort as RuntimeModelSelection["reasoningEffort"],
              })
            }
          >
            <SelectTrigger id={`${idBase}-reasoning`}>
              <SelectValue placeholder="Choose effort" />
            </SelectTrigger>
            <SelectContent>
              {reasoningEfforts.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useMemo(() => label.toLowerCase().replace(/\s+/g, "-"), [label]);
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm">{value}</p>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-48 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {label}…
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function parseView(hash: string): View {
  const value = hash.replace(/^#/, "");
  return views.some((item) => item.id === value) ? (value as View) : "overview";
}

function viewTitle(view: View): string {
  return views.find((item) => item.id === view)?.label ?? "Overview";
}

function preferredTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

function initialLoadState<T>(): LoadState<T> {
  return { status: "loading", data: null, error: null };
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatDate(input: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(input));
}

function formatTime(input: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(new Date(input));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
