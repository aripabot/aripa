import { Glob } from "bun";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Action } from "@/bot/action.ts";
import { log } from "@/config/logger.ts";

type ActionModule = {
  default?: unknown;
  action?: unknown;
};

export class ActionDirectory {
  readonly byName = new Map<string, Action>();
  readonly aliases = new Map<string, Action>();

  add(action: Action, source: string): void {
    const actionName = action.name.toLowerCase();

    if (this.byName.has(actionName) || this.aliases.has(actionName)) {
      log.withMetadata({ action: action.name, source }).warn("Skipping duplicate action name.");
      return;
    }

    this.byName.set(actionName, action);

    for (const alias of action.aliases ?? []) {
      const normalizedAlias = alias.toLowerCase();

      if (this.byName.has(normalizedAlias) || this.aliases.has(normalizedAlias)) {
        log
          .withMetadata({ action: action.name, alias, source })
          .warn("Skipping duplicate action alias.");
        continue;
      }

      this.aliases.set(normalizedAlias, action);
    }
  }

  find(name: string): Action | undefined {
    const normalizedName = name.toLowerCase();
    return this.byName.get(normalizedName) ?? this.aliases.get(normalizedName);
  }

  all(): Action[] {
    return [...this.byName.values()];
  }

  get size(): number {
    return this.byName.size;
  }
}

export async function loadActions(
  actionsPath = resolve(import.meta.dir, "../actions"),
): Promise<ActionDirectory> {
  const actions = new ActionDirectory();
  const glob = new Glob("**/*.{ts,js}");

  for await (const path of glob.scan({ cwd: actionsPath, absolute: true, onlyFiles: true })) {
    if (shouldSkipActionFile(path)) {
      continue;
    }

    const module = (await import(pathToFileURL(path).href)) as ActionModule;
    const action = module.default ?? module.action;

    if (!isAction(action)) {
      log.withMetadata({ path }).warn("Skipping action file without a valid action export.");
      continue;
    }

    actions.add(action, path);
    log.withMetadata({ action: action.name, path }).debug("Loaded action.");
  }

  return actions;
}

function shouldSkipActionFile(path: string): boolean {
  const fileName = basename(path);
  return fileName.endsWith(".d.ts") || fileName.includes(".test.") || fileName.startsWith("_");
}

function isAction(value: unknown): value is Action {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Action>;

  return (
    typeof candidate.name === "string" &&
    Array.isArray(candidate.requiredUserPermissions) &&
    typeof candidate.execute === "function"
  );
}
