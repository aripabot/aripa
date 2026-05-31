import type { DockerDeploymentCommandRequest } from "@/lib/api-types";
import { json, jsonError } from "@/app/api/_utils/json";
import {
  getDockerDeploymentStatus,
  runDockerDeploymentCommand,
} from "@/server/docker-deployment-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return json(await getDockerDeploymentStatus());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DockerDeploymentCommandRequest;
    return json(await runDockerDeploymentCommand(body.action));
  } catch (error) {
    return jsonError(error);
  }
}
