import type { SaveConfigRequest } from "@/lib/api-types";
import { json, jsonError } from "@/app/api/_utils/json";
import { readConfig, saveConfig } from "@/server/config-store";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    return json(await readConfig());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const body = (await request.json()) as SaveConfigRequest;
    return json(await saveConfig(body.config));
  } catch (error) {
    return jsonError(error);
  }
}
