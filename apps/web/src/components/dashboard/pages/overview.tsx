"use client";

import { AlertCircle, CheckCircle2, RefreshCw, Server, Tags, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Metric } from "@/components/dashboard/components/metric";
import {
  EmptyState,
  ResponsiveDatum,
  RuntimeDetail,
} from "@/components/dashboard/components/overview-display";
import { ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { formatCount, formatDateTime } from "@/components/dashboard/lib/format";
import type { DashboardStatus } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";
import type { RuntimeModelSelection } from "@aripabot/core/config/config.ts";

type BadgeTone = "success" | "danger" | "warning" | "info" | "muted";

const badgeToneClasses: Record<BadgeTone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

export function Overview({
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

  const { operations } = status.data;
  const visibleGuilds = operations.guilds.slice(0, 8);
  const visibleMutes = operations.activeMutes.slice(0, 6);
  const runtimeTone = runtimeToneClass(status.data.botRuntime.state);

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-medium ${runtimeTone}`}
              >
                <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                {status.data.botRuntime.label}
              </span>
              <p className="break-words text-sm text-muted-foreground">
                {status.data.botRuntime.detail}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <Metric label="Servers" value={operations.totals.guilds} />
          <Metric
            label="Need Attention"
            value={operations.totals.attentionGuilds + operations.totals.expiredMutes}
          />
          <Metric label="Active Mutes" value={operations.totals.activeMutes} />
          <Metric label="Tags" value={operations.totals.tags} />
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-pretty">Attention</h2>
          <span className="text-sm text-muted-foreground">
            {operations.discordLookup.available ? "" : "Discord names limited"}
          </span>
        </div>
        {operations.attentionItems.length === 0 ? (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="size-5 text-emerald-600 dark:text-emerald-400"
              />
              <p className="text-sm font-medium">No obvious setup issues.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {operations.attentionItems.map((item) => (
              <div key={item.id} className="flex gap-3 p-4">
                <AlertCircle
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${attentionIconClass(item.severity)}`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-base font-semibold text-pretty">Servers</h2>
          <p className="text-sm text-muted-foreground"></p>
        </div>
        {visibleGuilds.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No Servers Tracked"
            message="Allowlist a server or configure guild settings to see operational status here."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="hidden grid-cols-[minmax(16rem,1.4fr)_repeat(4,minmax(8rem,1fr))] gap-4 border-b px-4 py-2 text-xs font-medium uppercase text-muted-foreground lg:grid">
              <span>Server</span>
              <span>Mod Logs</span>
              <span>Mute Mode</span>
              <span>Active Mutes</span>
              <span>Tags</span>
            </div>
            <div className="divide-y">
              {visibleGuilds.map((guild) => (
                <GuildRow key={guild.guildId} guild={guild} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-base font-semibold text-pretty">Active Mutes</h2>
          <p className="text-sm text-muted-foreground">
            Role mutes waiting for manual or scheduled cleanup.
          </p>
        </div>
        {visibleMutes.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="No Active Role Mutes"
            message="Timed role mutes will appear here when they are stored for expiry."
          />
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {visibleMutes.map((mute) => (
              <MuteRow key={`${mute.guildId}:${mute.userId}`} mute={mute} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <RuntimeDetail label="Agent Model" value={formatModel(status.data.config.models.agent)} />
          <RuntimeDetail
            label="Rate Limit"
            value={
              status.data.config.agentRateLimitMessagesPerMinute === null
                ? "Off"
                : `${status.data.config.agentRateLimitMessagesPerMinute}/min`
            }
          />
          <RuntimeDetail label="Version" value={status.data.botVersion} />
        </div>
      </section>
    </div>
  );
}

function GuildRow({ guild }: { guild: DashboardStatus["operations"]["guilds"][number] }) {
  const statusLabel =
    guild.readiness === "attention"
      ? "Needs Attention"
      : guild.readiness === "ready"
        ? "Ready"
        : "Unconfigured";
  const logStatus = guild.modLogsEnabled
    ? guild.logChannelName
      ? `#${guild.logChannelName}`
      : guild.logChannelId
        ? `#${guild.logChannelId}`
        : "Missing Channel"
    : guild.logChannelId
      ? "Disabled"
      : "Not Set";
  const muteStatus =
    guild.muteMode === "role"
      ? guild.muteRoleName
        ? `@${guild.muteRoleName}`
        : guild.muteRoleId
          ? `@${guild.muteRoleId}`
          : "Missing Role"
      : guild.muteMode === "timeout"
        ? "Discord Timeout"
        : "Off";

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(16rem,1.4fr)_repeat(4,minmax(8rem,1fr))] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        {guild.iconUrl ? (
          <img
            src={guild.iconUrl}
            alt=""
            width="36"
            height="36"
            loading="lazy"
            className="size-9 rounded-md"
          />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Server aria-hidden="true" className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{guild.name ?? guild.guildId}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <span className={`rounded-sm px-1.5 py-0.5 text-xs ${readinessClass(guild.readiness)}`}>
              {statusLabel}
            </span>
            <span className="truncate text-xs text-muted-foreground" translate="no">
              {guild.guildId}
            </span>
          </div>
        </div>
      </div>
      <ResponsiveDatum
        label="Mod Logs"
        value={logStatus}
        tone={guild.modLogsEnabled ? "default" : "muted"}
      />
      <ResponsiveDatum
        label="Mute Mode"
        value={muteStatus}
        tone={guild.muteMode === "none" ? "muted" : "default"}
      />
      <ResponsiveDatum label="Active Mutes" value={formatCount(guild.activeMuteCount)} />
      <ResponsiveDatum label="Tags" value={formatCount(guild.tagCount)} icon={Tags} />
    </div>
  );
}

function MuteRow({ mute }: { mute: DashboardStatus["operations"]["activeMutes"][number] }) {
  const person = mute.displayName ?? mute.username ?? mute.userId;
  const role = mute.muteRoleName ? `@${mute.muteRoleName}` : `@${mute.muteRoleId}`;

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {mute.avatarUrl ? (
          <img
            src={mute.avatarUrl}
            alt=""
            width="36"
            height="36"
            loading="lazy"
            className="size-9 rounded-full"
          />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <UserRound aria-hidden="true" className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{person}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {mute.guildName ?? mute.guildId} · {role}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className={`rounded-sm px-1.5 py-0.5 text-xs ${muteStatusClass(mute.status)}`}>
          {mute.status === "expired"
            ? "Expired"
            : mute.status === "indefinite"
              ? "Indefinite"
              : "Active"}
        </span>
        <span className="text-sm text-muted-foreground">
          {mute.expiresAt ? formatDateTime(mute.expiresAt) : "No expiry"}
        </span>
      </div>
    </div>
  );
}

function badgeToneClass(tone: BadgeTone): string {
  return badgeToneClasses[tone];
}

function runtimeToneClass(state: DashboardStatus["botRuntime"]["state"]): string {
  switch (state) {
    case "running":
      return badgeToneClass("success");
    case "docker":
      return badgeToneClass("info");
    case "stopped":
      return badgeToneClass("danger");
  }
}

function readinessClass(readiness: DashboardStatus["operations"]["guilds"][number]["readiness"]) {
  switch (readiness) {
    case "ready":
      return badgeToneClass("success");
    case "attention":
      return badgeToneClass("danger");
    case "quiet":
      return badgeToneClass("muted");
  }
}

function attentionIconClass(
  severity: DashboardStatus["operations"]["attentionItems"][number]["severity"],
) {
  switch (severity) {
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    case "info":
      return "text-sky-600 dark:text-sky-400";
  }
}

function muteStatusClass(status: DashboardStatus["operations"]["activeMutes"][number]["status"]) {
  switch (status) {
    case "active":
      return badgeToneClass("success");
    case "expired":
      return badgeToneClass("danger");
    case "indefinite":
      return badgeToneClass("muted");
  }
}

function formatModel(model: RuntimeModelSelection): string {
  return `${model.provider} / ${model.model}`;
}
