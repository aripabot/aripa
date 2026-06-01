import { json, jsonError } from "@/app/api/_utils/json";
import { listReleases } from "@/server/config-service";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    return json(await listReleases());
  } catch (error) {
    return jsonError(error);
  }
}
