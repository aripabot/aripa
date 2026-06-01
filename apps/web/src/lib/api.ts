import type {
  ApiErrorResponse,
  ConfigResponse,
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
  DashboardStatus,
  DockerDeploymentCommandRequest,
  DockerDeploymentCommandResponse,
  DockerDeploymentStatus,
  GenerateSigningKeyResponse,
  LogsResponse,
  OnboardingOptionsResponse,
  ReleasesResponse,
  SaveConfigRequest,
  SaveConfigResponse,
  UpdateInstallRequest,
  UpdateInstallResponse,
} from "@/lib/api-types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T | ApiErrorResponse;

  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : "Request failed.";
    throw new Error(error);
  }

  return payload as T;
}

export function getStatus(): Promise<DashboardStatus> {
  return requestJson<DashboardStatus>("/api/status");
}

export function getConfig(): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>("/api/config");
}

export function saveConfig(body: SaveConfigRequest): Promise<SaveConfigResponse> {
  return requestJson<SaveConfigResponse>("/api/config", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getOnboardingOptions(): Promise<OnboardingOptionsResponse> {
  return requestJson<OnboardingOptionsResponse>("/api/onboarding");
}

export function completeOnboarding(
  body: CompleteOnboardingRequest,
): Promise<CompleteOnboardingResponse> {
  return requestJson<CompleteOnboardingResponse>("/api/onboarding", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function generateSigningKey(): Promise<GenerateSigningKeyResponse> {
  return requestJson<GenerateSigningKeyResponse>("/api/onboarding/signing-key", {
    method: "POST",
  });
}

export function getLogs(): Promise<LogsResponse> {
  return requestJson<LogsResponse>("/api/logs");
}

export function getReleases(): Promise<ReleasesResponse> {
  return requestJson<ReleasesResponse>("/api/releases");
}

export function installUpdate(body: UpdateInstallRequest): Promise<UpdateInstallResponse> {
  return requestJson<UpdateInstallResponse>("/api/updates/install", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getDockerDeploymentStatus(): Promise<DockerDeploymentStatus> {
  return requestJson<DockerDeploymentStatus>("/api/docker-deployments");
}

export function runDockerDeploymentCommand(
  body: DockerDeploymentCommandRequest,
): Promise<DockerDeploymentCommandResponse> {
  return requestJson<DockerDeploymentCommandResponse>("/api/docker-deployments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
