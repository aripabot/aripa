import type {
  DashboardStatus,
  DockerDeploymentStatus,
  LogsResponse,
  ReleasesResponse,
} from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import { getDockerDeploymentStatus } from "@/server/docker-deployment-service";
import { getDashboardStatus } from "@/server/config-service";
import { readLocalLogs } from "@/server/log-sources";
import { listReleases } from "@/server/releases";

export type LoadState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

export interface DashboardInitialData {
  status?: LoadState<DashboardStatus>;
  logs?: LoadState<LogsResponse>;
  releases?: LoadState<ReleasesResponse>;
  dockerDeployment?: LoadState<DockerDeploymentStatus>;
}

export function loadDashboardStatus(): Promise<LoadState<DashboardStatus>> {
  return loadState(getDashboardStatus);
}

export function loadDashboardLogs(): Promise<LoadState<LogsResponse>> {
  return loadState(readLocalLogs);
}

export function loadDashboardReleases(): Promise<LoadState<ReleasesResponse>> {
  return loadState(listReleases);
}

export function loadDockerDeployment(): Promise<LoadState<DockerDeploymentStatus>> {
  return loadState(getDockerDeploymentStatus);
}

async function loadState<T>(loader: () => Promise<T>): Promise<LoadState<T>> {
  try {
    return { status: "ready", data: await loader(), error: null };
  } catch (error) {
    return { status: "error", data: null, error: readableError(error, "Request failed.") };
  }
}
