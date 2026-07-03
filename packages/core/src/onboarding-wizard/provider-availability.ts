import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CONFIGURABLE_MODEL_PROVIDERS,
  type ConfigurableRuntimeModelProvider,
} from "@aripabot/core/config/runtime-config.ts";

const execFileAsync = promisify(execFile);
const MIN_FM_MACOS_VERSION = "27.0";

export interface ProviderAvailabilityEnvironment {
  platform?: NodeJS.Platform;
  macOSVersion?: () => Promise<string | null>;
  hasCommand?: (command: string) => Promise<boolean>;
}

export async function getSelectableModelProviders(
  environment: ProviderAvailabilityEnvironment = {},
): Promise<ConfigurableRuntimeModelProvider[]> {
  const fmAvailable = await isFmProviderAvailable(environment);
  return CONFIGURABLE_MODEL_PROVIDERS.filter((provider) => provider !== "fm" || fmAvailable);
}

export async function isFmProviderAvailable(
  environment: ProviderAvailabilityEnvironment = {},
): Promise<boolean> {
  const platform = environment.platform ?? process.platform;
  if (platform !== "darwin") {
    return false;
  }

  const version = await (environment.macOSVersion ?? readMacOSProductVersion)();
  if (!version || compareDottedVersions(version, MIN_FM_MACOS_VERSION) < 0) {
    return false;
  }

  return (environment.hasCommand ?? hasCommand)("fm");
}

export function compareDottedVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

async function readMacOSProductVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/sw_vers", ["-productVersion"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/which", [command]);
    return true;
  } catch {
    return false;
  }
}

function parseVersionParts(version: string): number[] {
  return version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}
