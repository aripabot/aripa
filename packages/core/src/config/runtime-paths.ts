import { join } from "node:path";

export interface RuntimePaths {
  repositoryRoot: string;
  configPath: string;
  databasePath: string;
  dashboardAuthPath: string;
  botPidPath: string;
  botRestartMarkerPath: string;
  logsDirectory: string;
}

export interface CreateRuntimePathsOptions {
  repositoryRoot: string;
  env?: Record<string, string | undefined>;
  fileExists?: (path: string) => boolean;
}

export function createRuntimePaths({
  repositoryRoot,
  env = process.env,
  fileExists = () => false,
}: CreateRuntimePathsOptions): RuntimePaths {
  const configPath = env.CONFIG_PATH?.trim() || join(repositoryRoot, "config.json");
  const defaultDatabasePath = join(repositoryRoot, "aripa.sqlite");
  const configuredDatabasePath = env.DATABASE_PATH?.trim();
  const databaseCandidates = [
    defaultDatabasePath,
    join(repositoryRoot, "apps", "bot", "aripa.sqlite"),
    join(repositoryRoot, "packages", "core", "aripa.sqlite"),
  ];

  return {
    repositoryRoot,
    configPath,
    databasePath:
      configuredDatabasePath ?? databaseCandidates.find(fileExists) ?? defaultDatabasePath,
    dashboardAuthPath:
      env.DASHBOARD_AUTH_PATH?.trim() || join(repositoryRoot, "dashboard-auth.json"),
    botPidPath: join(repositoryRoot, ".aripa", "bot.pid"),
    botRestartMarkerPath: join(repositoryRoot, ".aripa", "reload-requested"),
    logsDirectory: join(repositoryRoot, "logs"),
  };
}
