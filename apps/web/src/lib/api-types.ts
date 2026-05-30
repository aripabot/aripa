import type {
  RuntimeJsonConfig,
  RuntimeModelProvider,
  RuntimeReasoningEffort,
} from "@aripabot/core/config/config.ts";
import type { GitHubRelease } from "@aripabot/core/update/release-updater.ts";

export interface DashboardStatus {
  appName: string;
  botVersion: string;
  webVersion: string;
  configPath: string;
  databasePath: string;
  tokenConfigured: boolean;
  prefix: string;
  styles: StylePromptOption[];
  providers: RuntimeModelProvider[];
  reasoningEfforts: RuntimeReasoningEffort[];
  config: RuntimeJsonConfig;
}

export interface StylePromptOption {
  value: string;
  label: string;
  description: string;
}

export interface ConfigResponse {
  path: string;
  raw: Record<string, unknown>;
  config: RuntimeJsonConfig;
}

export interface SaveConfigRequest {
  config: RuntimeJsonConfig;
}

export interface SaveConfigResponse extends ConfigResponse {
  savedAt: string;
}

export interface LocalLogFile {
  name: string;
  path: string;
  exists: boolean;
  updatedAt: string | null;
  sizeBytes: number;
  lines: string[];
}

export interface LogsResponse {
  files: LocalLogFile[];
}

export interface ReleasesResponse {
  repo: string;
  releases: GitHubRelease[];
}

export interface UpdateInstallRequest {
  tagName: string;
}

export interface UpdateInstallResponse {
  tagName: string;
  updatedPath: string;
  installedDependencies: boolean;
  progress: string[];
}

export interface ApiErrorResponse {
  error: string;
}
