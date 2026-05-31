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
  botRuntime: BotRuntimeStatus;
  operations: DashboardOperations;
  styles: StylePromptOption[];
  providers: RuntimeModelProvider[];
  reasoningEfforts: RuntimeReasoningEffort[];
  config: RuntimeJsonConfig;
}

export interface BotRuntimeStatus {
  state: "running" | "docker" | "stopped";
  label: string;
  detail: string;
}

export interface DashboardOperations {
  guilds: GuildOperationsSummary[];
  activeMutes: ActiveMuteSummary[];
  attentionItems: AttentionItem[];
  totals: OperationsTotals;
  discordLookup: DiscordLookupStatus;
}

export interface GuildOperationsSummary {
  guildId: string;
  name: string | null;
  iconUrl: string | null;
  logChannelId: string | null;
  logChannelName: string | null;
  modLogsEnabled: boolean;
  banMessage: string | null;
  muteRoleId: string | null;
  muteRoleName: string | null;
  muteMode: "none" | "role" | "timeout";
  tagCount: number;
  activeMuteCount: number;
  updatedAt: string | null;
  readiness: "ready" | "attention" | "quiet";
}

export interface ActiveMuteSummary {
  guildId: string;
  guildName: string | null;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  muteRoleId: string;
  muteRoleName: string | null;
  expiresAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "indefinite";
}

export interface AttentionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  guildId?: string;
}

export interface OperationsTotals {
  guilds: number;
  readyGuilds: number;
  attentionGuilds: number;
  activeMutes: number;
  expiredMutes: number;
  tags: number;
}

export interface DiscordLookupStatus {
  available: boolean;
  detail: string;
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
