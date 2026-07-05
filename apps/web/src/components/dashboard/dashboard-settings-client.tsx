"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SettingsPage } from "@/components/dashboard/pages/settings";
import type { DashboardStatus } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function DashboardSettingsClient({ status }: { status: LoadState<DashboardStatus> }) {
  return (
    <DashboardShell view="settings" initialStatus={status}>
      {({ statusState, setStatusState }) =>
        statusState.status === "ready" && (
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
        )
      }
    </DashboardShell>
  );
}
