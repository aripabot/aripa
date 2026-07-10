"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { TraceDetailPage } from "@/components/dashboard/pages/trace-detail";
import type { DashboardStatus, TraceResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function DashboardTraceDetailClient({
  trace,
  status,
}: {
  trace: LoadState<TraceResponse>;
  status: LoadState<DashboardStatus>;
}) {
  return (
    <DashboardShell view="traces" initialStatus={status}>
      {() => <TraceDetailPage initialTrace={trace} status={status} />}
    </DashboardShell>
  );
}
