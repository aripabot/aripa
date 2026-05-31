import type { SaveConfigRequest } from "@/lib/api-types";
import { json, jsonError } from "@/app/api/_utils/json";
import { readConfig, saveConfig } from "@/server/config-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return json(await readConfig());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveConfigRequest;
    return json(await saveConfig(body.config));
  } catch (error) {
    return jsonError(error);
  }
}
