import { DashboardRoute } from "@/app/_components/dashboard-route";
import { DashboardAuthScreen } from "@/components/dashboard/dashboard-auth-screen";
import { DashboardTraceDetailClient } from "@/components/dashboard/dashboard-trace-detail-client";
import { getDashboardPageAuthState } from "@/server/dashboard-auth-next";
import { loadDashboardStatus, loadDashboardTrace } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TracePage({ params }: { params: Promise<{ traceId: string }> }) {
  const authState = await getDashboardPageAuthState();
  if (authState.status !== "authenticated") return <DashboardAuthScreen authState={authState} />;

  const { traceId } = await params;
  const [status, trace] = await Promise.all([loadDashboardStatus(), loadDashboardTrace(traceId)]);
  return (
    <DashboardRoute>
      <DashboardTraceDetailClient status={status} trace={trace} />
    </DashboardRoute>
  );
}
