import { parseRuntimeJsonConfigForMutation } from "@aripabot/core/config/runtime-config.ts";
import { json, jsonError, parseJsonObject, readObjectField } from "@/app/api/_utils/json";
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
    const body = await parseJsonObject(request);
    const config = parseRuntimeJsonConfigForMutation(readObjectField(body, "config"));

    return json(await saveConfig(config));
  } catch (error) {
    return jsonError(error);
  }
}
