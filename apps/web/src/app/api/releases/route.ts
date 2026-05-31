import { json, jsonError } from "@/app/api/_utils/json";
import { listReleases } from "@/server/config-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return json(await listReleases());
  } catch (error) {
    return jsonError(error);
  }
}
