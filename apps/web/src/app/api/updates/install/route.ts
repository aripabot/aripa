import type { UpdateInstallRequest } from "@/lib/api-types";
import { json, jsonError } from "@/app/api/_utils/json";
import { installRelease } from "@/server/update-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpdateInstallRequest;
    return json(await installRelease(body.tagName));
  } catch (error) {
    return jsonError(error);
  }
}
