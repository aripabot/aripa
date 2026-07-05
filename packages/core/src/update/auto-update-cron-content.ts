import { join, resolve } from "node:path";

export const AUTO_UPDATE_CRON_BEGIN = "# BEGIN ARIPA AUTO UPDATE";
export const AUTO_UPDATE_CRON_END = "# END ARIPA AUTO UPDATE";

const AUTO_UPDATE_CRON_BLOCK_PATTERN = new RegExp(
  `${escapeRegExp(AUTO_UPDATE_CRON_BEGIN)}\\n[\\s\\S]*?\\n${escapeRegExp(AUTO_UPDATE_CRON_END)}\\n?`,
  "g",
);

export interface AutoUpdateCronEntryOptions {
  cwd?: string;
  configPath?: string | URL;
  cronExpression: string;
  bunExecutable?: string;
  logPath?: string;
}

export function buildAutoUpdateCronEntry(options: AutoUpdateCronEntryOptions): string {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = formatCronPath(options.configPath ?? join(cwd, "config.json"));
  const bunExecutable = options.bunExecutable ?? process.execPath;
  const logPath = options.logPath ?? join(cwd, "aripa-update.log");
  const command = [
    `cd ${shellQuote(cwd)}`,
    `CONFIG_PATH=${shellQuote(configPath)} ${shellQuote(bunExecutable)} run update --latest >> ${shellQuote(logPath)} 2>&1`,
  ].join(" && ");

  return `${options.cronExpression} ${command}`;
}

export function updateManagedAutoUpdateCronContent(
  existingCrontab: string,
  cronEntry: string,
): string {
  const unmanagedCrontab = removeManagedAutoUpdateCronContent(existingCrontab).trimEnd();
  const managedBlock = `${AUTO_UPDATE_CRON_BEGIN}\n${cronEntry}\n${AUTO_UPDATE_CRON_END}`;

  return `${unmanagedCrontab ? `${unmanagedCrontab}\n\n` : ""}${managedBlock}\n`;
}

export function removeManagedAutoUpdateCronContent(existingCrontab: string): string {
  const withoutManagedBlock = existingCrontab
    .replace(AUTO_UPDATE_CRON_BLOCK_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return withoutManagedBlock ? `${withoutManagedBlock}\n` : "";
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCronPath(pathOrUrl: string | URL): string {
  if (pathOrUrl instanceof URL) {
    return pathOrUrl.pathname;
  }

  return resolve(pathOrUrl);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
