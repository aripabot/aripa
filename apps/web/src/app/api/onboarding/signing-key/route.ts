import { json, jsonError } from "@/app/api/_utils/json";
import { createReleaseSigningKeyPair } from "@/server/config-store";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    return json(createReleaseSigningKeyPair());
  } catch (error) {
    return jsonError(error);
  }
}
