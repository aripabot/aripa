import { json, jsonError, parseJsonObject, readObjectField } from "@/app/api/_utils/json";
import { parseRuntimeOnboardingInput } from "@aripabot/core/config/onboarding.ts";
import { getOnboardingOptions } from "@/server/config-service";
import { completeOnboarding } from "@/server/config-store";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    return json(await getOnboardingOptions());
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
    return json(
      await completeOnboarding(parseRuntimeOnboardingInput(readObjectField(body, "input"))),
    );
  } catch (error) {
    return jsonError(error);
  }
}
