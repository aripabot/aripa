import { json, jsonError } from "@/app/api/_utils/json";
import { getDashboardStatus } from "@/server/config-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return json(await getDashboardStatus());
  } catch (error) {
    return jsonError(error);
  }
}
