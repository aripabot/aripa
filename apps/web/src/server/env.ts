import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const rootEnv = readRootEnv();

export function getEnv(name: string): string | undefined {
  return process.env[name] ?? rootEnv[name];
}

export function getRootEnv(): Record<string, string> {
  return rootEnv;
}

function readRootEnv(): Record<string, string> {
  try {
    return parseEnvText(readFileSync(join(repositoryRoot, ".env"), "utf8"));
  } catch {
    return {};
  }
}

function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}
