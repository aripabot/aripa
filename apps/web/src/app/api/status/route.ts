import { json, jsonError } from "@/app/api/_utils/json";
import { getDashboardStatus } from "@/server/config-service";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    return json(await getDashboardStatus());
  } catch (error) {
    return jsonError(error);
  }
}
