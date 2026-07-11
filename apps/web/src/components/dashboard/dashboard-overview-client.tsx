"use client";

import { useCallback, useState } from "react";
import type { AgentTrace } from "@aripabot/core/agent/traces.ts";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useTraceStream } from "@/components/dashboard/hooks/use-trace-stream";
import { upsertTraces } from "@/components/dashboard/lib/trace-utils";
import { Overview } from "@/components/dashboard/pages/overview";
import type { LoadState } from "@/server/dashboard-page-data";
import type { DashboardStatus, TracesResponse } from "@/lib/api-types";

export function DashboardOverviewClient({
  status,
  traces,
}: {
  status: LoadState<DashboardStatus>;
  traces: LoadState<TracesResponse>;
}) {
  const [items, setItems] = useState<AgentTrace[]>(
    traces.status === "ready" ? traces.data.traces : [],
  );
  const initialSequence = traces.status === "ready" ? traces.data.latestSequence : 0;
  const receiveTraces = useCallback((updates: AgentTrace[]) => {
    setItems((current) => upsertTraces(current, updates));
  }, []);
  const streamState = useTraceStream(initialSequence, receiveTraces);

  return (
    <DashboardShell view="overview" initialStatus={status}>
      {({ statusState, refreshStatus }) => {
        const guildNames = new Map(
          statusState.status === "ready"
            ? statusState.data.operations.guilds.map((guild) => [guild.guildId, guild.name])
            : [],
        );
        return (
          <Overview
            status={statusState}
            traces={items}
            traceStreamState={streamState}
            guildNames={guildNames}
            onRefresh={refreshStatus}
          />
        );
      }}
    </DashboardShell>
  );
}
