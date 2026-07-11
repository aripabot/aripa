"use client";

import { RefreshCw, Server, UserRound } from "lucide-react";
import type { AgentTrace } from "@aripabot/core/agent/traces.ts";

import { Button } from "@/components/ui/button";
import { AgentActivityRail } from "@/components/dashboard/components/agent-activity-rail";
import { Metric } from "@/components/dashboard/components/metric";
import { ResponsiveDatum, RuntimeDetail } from "@/components/dashboard/components/overview-display";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { StatusDot, StatusText } from "@/components/dashboard/components/status-dot";
import type { StatusTone } from "@/components/dashboard/components/status-dot";
import { formatCount, formatDateTime } from "@/components/dashboard/lib/format";
import type { DashboardStatus } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";
import type { RuntimeModelSelection } from "@aripabot/core/config/config.ts";
import type { TraceStreamState } from "@/components/dashboard/hooks/use-trace-stream";

export function Overview({
  status,
  traces,
  traceStreamState,
  guildNames,
  onRefresh,
}: {
  status: LoadState<DashboardStatus>;
  traces: readonly AgentTrace[];
  traceStreamState: TraceStreamState;
  guildNames: ReadonlyMap<string, string | null>;
  onRefresh: () => void;
}) {
  if (status.status === "loading") {
    return <LoadingPanel label="Loading" />;
  }

  if (status.status === "error") {
    return <ErrorPanel title="Overview unavailable" message={status.error} onRetry={onRefresh} />;
  }

  const { operations, botRuntime } = status.data;
  const visibleGuilds = operations.guilds.slice(0, 8);
  const visibleMutes = operations.activeMutes.slice(0, 6);

  return (
    <div className="grid gap-10">
      <section className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <StatusText tone={runtimeTone(botRuntime.state)} className="font-medium">
            {botRuntime.label}
          </StatusText>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
        <AgentActivityRail traces={traces} streamState={traceStreamState} guildNames={guildNames} />
        <div className="grid grid-cols-2 gap-6 border-y py-5 sm:grid-cols-4">
          <Metric label="Servers" value={operations.totals.guilds} />
          <Metric
            label="Need attention"
            value={operations.totals.attentionGuilds + operations.totals.expiredMutes}
          />
          <Metric label="Active mutes" value={operations.totals.activeMutes} />
          <Metric label="Tags" value={operations.totals.tags} />
        </div>
      </section>

      {operations.attentionItems.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium">Needs attention</h2>
          <ul className="grid gap-0 divide-y">
            {operations.attentionItems.map((item) => (
              <li key={item.id} className="flex gap-2.5 py-3">
                <StatusDot tone={attentionTone(item.severity)} className="mt-[7px]" />
                <div className="min-w-0">
                  <p className="text-sm">{item.title}</p>
                  <p className="mt-0.5 break-words text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Servers</h2>
          {operations.discordLookup.available ? null : (
            <p className="text-sm text-muted-foreground">Names unavailable while offline</p>
          )}
        </div>
        {visibleGuilds.length === 0 ? (
          <EmptyPanel
            title="No servers yet"
            message="Add a server to the allowlist in Settings to see it here."
          />
        ) : (
          <div>
            <div className="hidden grid-cols-[minmax(15rem,1.4fr)_repeat(4,minmax(6.5rem,1fr))] gap-4 border-b pb-2 text-xs text-muted-foreground lg:grid">
              <span>Server</span>
              <span>Mod logs</span>
              <span>Mutes</span>
              <span>Active</span>
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

      {visibleMutes.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium">Active mutes</h2>
          <div className="divide-y">
            {visibleMutes.map((mute) => (
              <MuteRow key={`${mute.guildId}:${mute.userId}`} mute={mute} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 border-t pt-5 sm:grid-cols-3">
        <RuntimeDetail label="Model" value={formatModel(status.data.config.models.agent)} />
        <RuntimeDetail
          label="Rate limit"
          value={
            status.data.config.agentRateLimitMessagesPerMinute === null
              ? "Off"
              : `${status.data.config.agentRateLimitMessagesPerMinute} per minute`
          }
        />
        <RuntimeDetail label="Version" value={status.data.botVersion} />
      </section>
    </div>
  );
}

function GuildRow({ guild }: { guild: DashboardStatus["operations"]["guilds"][number] }) {
  const logStatus = guild.modLogsEnabled
    ? guild.logChannelName
      ? `#${guild.logChannelName}`
      : guild.logChannelId
        ? `#${guild.logChannelId}`
        : "Channel missing"
    : "Off";
  const muteStatus =
    guild.muteMode === "role"
      ? guild.muteRoleName
        ? `@${guild.muteRoleName}`
        : guild.muteRoleId
          ? `@${guild.muteRoleId}`
          : "Role missing"
      : guild.muteMode === "timeout"
        ? "Timeout"
        : "Off";

  return (
    <div className="grid gap-3 py-3.5 lg:grid-cols-[minmax(15rem,1.4fr)_repeat(4,minmax(6.5rem,1fr))] lg:items-center lg:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {guild.iconUrl ? (
          <img
            src={guild.iconUrl}
            alt=""
            width="32"
            height="32"
            loading="lazy"
            className="size-8 rounded-md"
          />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Server aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            <StatusDot tone={readinessTone(guild.readiness)} />
            <span className="truncate" title={guild.name ?? undefined}>
              {guild.name ?? guild.guildId}
            </span>
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" translate="no">
            {guild.guildId}
          </p>
        </div>
      </div>
      <ResponsiveDatum
        label="Mod logs"
        value={logStatus}
        tone={guild.modLogsEnabled ? "default" : "muted"}
      />
      <ResponsiveDatum
        label="Mutes"
        value={muteStatus}
        tone={guild.muteMode === "none" ? "muted" : "default"}
      />
      <ResponsiveDatum label="Active" value={formatCount(guild.activeMuteCount)} />
      <ResponsiveDatum label="Tags" value={formatCount(guild.tagCount)} />
    </div>
  );
}

function MuteRow({ mute }: { mute: DashboardStatus["operations"]["activeMutes"][number] }) {
  const person = mute.displayName ?? mute.username ?? mute.userId;
  const role = mute.muteRoleName ? `@${mute.muteRoleName}` : `@${mute.muteRoleId}`;

  return (
    <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {mute.avatarUrl ? (
          <img
            src={mute.avatarUrl}
            alt=""
            width="32"
            height="32"
            loading="lazy"
            className="size-8 rounded-full"
          />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <UserRound aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{person}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {mute.guildName ?? mute.guildId} · {role}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
        <StatusText tone={muteTone(mute.status)} className="text-muted-foreground">
          {muteLabel(mute)}
        </StatusText>
      </div>
    </div>
  );
}

function runtimeTone(state: DashboardStatus["botRuntime"]["state"]): StatusTone {
  switch (state) {
    case "running":
    case "docker":
      return "ok";
    case "stopped":
      return "danger";
  }
}

function readinessTone(
  readiness: DashboardStatus["operations"]["guilds"][number]["readiness"],
): StatusTone {
  switch (readiness) {
    case "ready":
      return "ok";
    case "attention":
      return "danger";
    case "quiet":
      return "neutral";
  }
}

function attentionTone(
  severity: DashboardStatus["operations"]["attentionItems"][number]["severity"],
): StatusTone {
  switch (severity) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    case "info":
      return "neutral";
  }
}

function muteLabel(mute: DashboardStatus["operations"]["activeMutes"][number]): string {
  switch (mute.status) {
    case "expired":
      return "Expired";
    case "indefinite":
      return "No expiry";
    case "active":
      return mute.expiresAt ? `Until ${formatDateTime(mute.expiresAt)}` : "Active";
  }
}

function muteTone(
  status: DashboardStatus["operations"]["activeMutes"][number]["status"],
): StatusTone {
  switch (status) {
    case "active":
      return "ok";
    case "expired":
      return "danger";
    case "indefinite":
      return "neutral";
  }
}

function formatModel(model: RuntimeModelSelection): string {
  return model.model;
}
