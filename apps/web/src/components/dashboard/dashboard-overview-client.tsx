"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Overview } from "@/components/dashboard/pages/overview";
import type { LoadState } from "@/server/dashboard-page-data";
import type { DashboardStatus } from "@/lib/api-types";

export function DashboardOverviewClient({ status }: { status: LoadState<DashboardStatus> }) {
  return (
    <DashboardShell view="overview" initialStatus={status}>
      {({ statusState, refreshStatus }) => (
        <Overview status={statusState} onRefresh={refreshStatus} />
      )}
    </DashboardShell>
  );
}
