import {
  getRawTailAfterToken,
  type CommandToken,
} from "@aripabot/core/commands/command-tokenizer.ts";

export type CommandPathInput = string | readonly string[];

export interface CommandRoute<TMeta = unknown> {
  name: string;
  path: readonly string[];
  aliases?: readonly CommandPathInput[];
  pluginName?: string;
  group?: string;
  defaultLevel?: number;
  meta?: TMeta;
}

export interface CommandRouteDefinition<TMeta = unknown> {
  name?: string;
  path: CommandPathInput;
  aliases?: readonly CommandPathInput[];
  pluginName?: string;
  group?: string;
  defaultLevel?: number;
  meta?: TMeta;
}

export interface CommandRouteMatch<TMeta = unknown> {
  route: CommandRoute<TMeta>;
  matchedPath: string[];
  usedAlias: boolean;
  consumedTokenCount: number;
  args: CommandToken[];
  argValues: string[];
  rawArgs: string;
}

interface CandidatePath {
  path: string[];
  usedAlias: boolean;
}

export function defineCommandRoute<TMeta = unknown>(
  definition: CommandRouteDefinition<TMeta>,
): CommandRoute<TMeta> {
  const path = normalizeCommandPath(definition.path);

  return {
    name: definition.name ?? path.join(" "),
    path,
    aliases: definition.aliases,
    pluginName: definition.pluginName,
    group: definition.group ?? path[0],
    defaultLevel: definition.defaultLevel,
    meta: definition.meta,
  };
}

export function normalizeCommandPath(path: CommandPathInput): string[] {
  const parts = typeof path === "string" ? path.trim().split(/\s+/) : [...path];
  const normalized = parts.map((part) => part.trim().toLowerCase()).filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("Command path cannot be empty.");
  }

  return normalized;
}

export function matchCommandRoute<TMeta = unknown>(
  tokens: readonly CommandToken[],
  routes: readonly CommandRoute<TMeta>[],
  input = tokens.map((token) => token.raw).join(" "),
): CommandRouteMatch<TMeta> | null {
  let bestMatch: CommandRouteMatch<TMeta> | null = null;

  for (const route of routes) {
    for (const candidate of getCandidatePaths(route)) {
      if (!pathMatches(tokens, candidate.path)) {
        continue;
      }

      const consumedTokenCount = candidate.path.length;
      const args = tokens.slice(consumedTokenCount);
      const rawArgs =
        consumedTokenCount === 0
          ? input.trim()
          : getRawTailAfterToken(input, tokens, consumedTokenCount - 1);

      const match: CommandRouteMatch<TMeta> = {
        route,
        matchedPath: candidate.path,
        usedAlias: candidate.usedAlias,
        consumedTokenCount,
        args,
        argValues: args.map((token) => token.value),
        rawArgs,
      };

      if (isBetterRouteMatch(match, bestMatch)) {
        bestMatch = match;
      }
    }
  }

  return bestMatch;
}

function getCandidatePaths(route: CommandRoute): CandidatePath[] {
  return [
    { path: route.path.map(normalizePathPart), usedAlias: false },
    ...(route.aliases ?? []).map((alias) => ({
      path: normalizeCommandPath(alias),
      usedAlias: true,
    })),
  ];
}

function pathMatches(tokens: readonly CommandToken[], path: readonly string[]): boolean {
  if (tokens.length < path.length) {
    return false;
  }

  return path.every((part, index) => tokens[index]?.value.toLowerCase() === part);
}

function isBetterRouteMatch(
  candidate: CommandRouteMatch,
  current: CommandRouteMatch | null,
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.consumedTokenCount !== current.consumedTokenCount) {
    return candidate.consumedTokenCount > current.consumedTokenCount;
  }

  if (candidate.usedAlias !== current.usedAlias) {
    return !candidate.usedAlias;
  }

  return false;
}

function normalizePathPart(part: string): string {
  return part.trim().toLowerCase();
}
