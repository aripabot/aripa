import { json, jsonError, parseJsonObject, readStringField } from "@/app/api/_utils/json";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";
import { installRelease } from "@/server/update-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const body = await parseJsonObject(request);
    return json(await installRelease(readStringField(body, "tagName")));
  } catch (error) {
    return jsonError(error);
  }
}
