import { json, jsonError } from "@/app/api/_utils/json";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";
import { readAgentTraces } from "@/server/trace-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authError = await requireDashboardApiAuth(request);
  if (authError) return authError;

  try {
    return json(await readAgentTraces());
  } catch (error) {
    return jsonError(error);
  }
}
