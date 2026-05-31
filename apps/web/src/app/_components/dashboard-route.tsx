import { ViewTransition } from "react";

import { Dashboard, type View } from "@/components/dashboard/dashboard-client";
import type { DashboardInitialData } from "@/server/dashboard-page-data";

export function DashboardRoute({
  initialData,
  view,
}: {
  initialData: DashboardInitialData;
  view: View;
}) {
  return (
    <ViewTransition enter="fade-in" exit="none" default="none">
      <Dashboard view={view} initialData={initialData} />
    </ViewTransition>
  );
}
