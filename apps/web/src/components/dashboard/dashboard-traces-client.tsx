"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { TracesPage } from "@/components/dashboard/pages/traces";
import { getTraces } from "@/lib/api";
import type { DashboardStatus, TracesResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function DashboardTracesClient({
  traces,
  status,
}: {
  traces: LoadState<TracesResponse>;
  status: LoadState<DashboardStatus>;
}) {
  const { state, refresh } = useLoadState(getTraces, traces);
  return (
    <DashboardShell view="traces" initialStatus={status}>
      {() => <TracesPage traces={state} status={status} onRefresh={refresh} />}
    </DashboardShell>
  );
}
