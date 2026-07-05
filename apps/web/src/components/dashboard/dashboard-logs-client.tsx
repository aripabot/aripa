"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { LogsPage } from "@/components/dashboard/pages/logs";
import { getLogs } from "@/lib/api";
import type { DashboardStatus, LogsResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function DashboardLogsClient({
  logs,
  status,
}: {
  logs: LoadState<LogsResponse>;
  status: LoadState<DashboardStatus>;
}) {
  const { state: logsState, refresh: refreshLogs } = useLoadState(getLogs, logs);

  return (
    <DashboardShell view="logs" initialStatus={status}>
      {() => <LogsPage logs={logsState} onRefresh={refreshLogs} />}
    </DashboardShell>
  );
}
