"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { UpdatesPage } from "@/components/dashboard/pages/updates";
import { getReleases } from "@/lib/api";
import type { DashboardStatus, ReleasesResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function DashboardUpdatesClient({
  releases,
  status,
}: {
  releases: LoadState<ReleasesResponse>;
  status: LoadState<DashboardStatus>;
}) {
  const { state: releasesState, refresh: refreshReleases } = useLoadState(getReleases, releases);

  return (
    <DashboardShell view="updates" initialStatus={status}>
      {({ statusState, refreshStatus }) => (
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
    </DashboardShell>
  );
}
