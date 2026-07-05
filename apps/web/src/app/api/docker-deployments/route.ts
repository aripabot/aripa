import type { DockerDeploymentAction } from "@/lib/api-types";
import { json, jsonError, parseJsonObject, readStringField } from "@/app/api/_utils/json";
import {
  getDockerDeploymentStatus,
  runDockerDeploymentCommand,
} from "@/server/docker-deployment-service";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  try {
    return json(await getDockerDeploymentStatus());
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
    return json(await runDockerDeploymentCommand(parseDockerDeploymentAction(body)));
  } catch (error) {
    return jsonError(error);
  }
}

function parseDockerDeploymentAction(body: Record<string, unknown>): DockerDeploymentAction {
  const action = readStringField(body, "action");

  if (action !== "start" && action !== "stop") {
    throw new Error("Expected action to be start or stop.");
  }

  return action;
}
