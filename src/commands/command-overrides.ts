export const COMMAND_LEVELS = {
  default: 0,
  trusted: 10,
  moderator: 50,
  administrator: 100,
} as const;

export interface CommandIdentity {
  name: string;
  group?: string;
  pluginName?: string;
}

export interface CommandSelector {
  name?: string;
  group?: string;
  pluginName?: string;
  plugin?: {
    name?: string;
  };
}

export interface CommandOverrideRule extends CommandSelector {
  out: {
    level?: number;
    disabled?: boolean;
    roles?: readonly string[];
    excludeRoles?: readonly string[];
  };
}

export interface CommandLockdownRule extends CommandSelector {
  out: {
    channels?: readonly string[];
    category?: readonly string[];
    categories?: readonly string[];
    roles?: readonly string[];
    excludeChannels?: readonly string[];
    excludeCategory?: readonly string[];
    excludeCategories?: readonly string[];
    excludeRoles?: readonly string[];
  };
}

export interface CommandAccessSubject {
  level: number;
  roleIds: readonly string[];
  channelId?: string;
  categoryId?: string;
}

export interface CommandAccessOptions {
  identity: CommandIdentity;
  subject: CommandAccessSubject;
  defaultLevel?: number;
  overrides?: readonly CommandOverrideRule[];
  lockdowns?: readonly CommandLockdownRule[];
}

export type CommandAccessDecision =
  | {
      allowed: true;
      requiredLevel: number;
      matchedOverride?: CommandOverrideRule;
      matchedLockdown?: CommandLockdownRule;
    }
  | {
      allowed: false;
      reason: "disabled" | "level" | "role" | "channel" | "category";
      message: string;
      requiredLevel: number;
      matchedOverride?: CommandOverrideRule;
      matchedLockdown?: CommandLockdownRule;
    };

export function evaluateCommandAccess({
  identity,
  subject,
  defaultLevel = COMMAND_LEVELS.default,
  overrides = [],
  lockdowns = [],
}: CommandAccessOptions): CommandAccessDecision {
  const matchedOverride = findBestRule(overrides, identity);
  const requiredLevel = matchedOverride?.out.level ?? defaultLevel;

  if (matchedOverride?.out.disabled) {
    return denied("disabled", "That command is disabled.", requiredLevel, matchedOverride);
  }

  if (hasAny(subject.roleIds, matchedOverride?.out.excludeRoles)) {
    return denied(
      "role",
      "One of the user's roles is blocked from using that command.",
      requiredLevel,
      matchedOverride,
    );
  }

  const overrideRoleAllowed = hasAny(subject.roleIds, matchedOverride?.out.roles);

  if (subject.level < requiredLevel && !overrideRoleAllowed) {
    return denied(
      "level",
      `That command requires level ${requiredLevel}.`,
      requiredLevel,
      matchedOverride,
    );
  }

  const matchedLockdown = findBestRule(lockdowns, identity);
  const lockdownDecision = evaluateLockdown(
    subject,
    requiredLevel,
    matchedOverride,
    matchedLockdown,
  );

  if (lockdownDecision) {
    return lockdownDecision;
  }

  return {
    allowed: true,
    requiredLevel,
    matchedOverride,
    matchedLockdown,
  };
}

export function commandIdentityFromPath(
  path: readonly string[],
  pluginName?: string,
): CommandIdentity {
  const normalizedPath = path.map((part) => part.toLowerCase());

  return {
    name: normalizedPath.join(" "),
    group: normalizedPath[0],
    pluginName,
  };
}

function evaluateLockdown(
  subject: CommandAccessSubject,
  requiredLevel: number,
  matchedOverride: CommandOverrideRule | undefined,
  matchedLockdown: CommandLockdownRule | undefined,
): CommandAccessDecision | null {
  if (!matchedLockdown) {
    return null;
  }

  const out = matchedLockdown.out;

  if (hasAny([subject.channelId], out.excludeChannels)) {
    return denied(
      "channel",
      "That command is blocked in this channel.",
      requiredLevel,
      matchedOverride,
      matchedLockdown,
    );
  }

  if (
    hasAny([subject.categoryId], out.excludeCategory) ||
    hasAny([subject.categoryId], out.excludeCategories)
  ) {
    return denied(
      "category",
      "That command is blocked in this channel category.",
      requiredLevel,
      matchedOverride,
      matchedLockdown,
    );
  }

  if (hasAny(subject.roleIds, out.excludeRoles)) {
    return denied(
      "role",
      "One of the user's roles is blocked from using that command.",
      requiredLevel,
      matchedOverride,
      matchedLockdown,
    );
  }

  if (out.channels?.length && !hasAny([subject.channelId], out.channels)) {
    return denied(
      "channel",
      "That command is not enabled in this channel.",
      requiredLevel,
      matchedOverride,
      matchedLockdown,
    );
  }

  const allowedCategories = out.category ?? out.categories;

  if (allowedCategories?.length && !hasAny([subject.categoryId], allowedCategories)) {
    return denied(
      "category",
      "That command is not enabled in this channel category.",
      requiredLevel,
      matchedOverride,
      matchedLockdown,
    );
  }

  if (out.roles?.length && !hasAny(subject.roleIds, out.roles)) {
    return denied(
      "role",
      "That command is not enabled for any of the user's roles.",
      requiredLevel,
      matchedOverride,
      matchedLockdown,
    );
  }

  return null;
}

function findBestRule<TRule extends CommandSelector>(
  rules: readonly TRule[],
  identity: CommandIdentity,
): TRule | undefined {
  let bestRule: TRule | undefined;
  let bestSpecificity = 0;

  rules.forEach((rule) => {
    const specificity = selectorSpecificity(rule, identity);

    if (specificity >= bestSpecificity && specificity > 0) {
      bestRule = rule;
      bestSpecificity = specificity;
    }
  });

  return bestRule;
}

function selectorSpecificity(selector: CommandSelector, identity: CommandIdentity): number {
  if (selector.name && normalize(selector.name) === normalize(identity.name)) {
    return 3;
  }

  if (selector.group && identity.group && normalize(selector.group) === normalize(identity.group)) {
    return 2;
  }

  const selectorPluginName = selector.pluginName ?? selector.plugin?.name;

  if (
    selectorPluginName &&
    identity.pluginName &&
    normalize(selectorPluginName) === normalize(identity.pluginName)
  ) {
    return 1;
  }

  return 0;
}

function denied(
  reason: "disabled" | "level" | "role" | "channel" | "category",
  message: string,
  requiredLevel: number,
  matchedOverride?: CommandOverrideRule,
  matchedLockdown?: CommandLockdownRule,
): CommandAccessDecision {
  return {
    allowed: false,
    reason,
    message,
    requiredLevel,
    matchedOverride,
    matchedLockdown,
  };
}

function hasAny(
  actual: readonly (string | undefined)[],
  expected: readonly string[] | undefined,
): boolean {
  if (!expected?.length) {
    return false;
  }

  const expectedSet = new Set(expected);
  return actual.some((value) => value !== undefined && expectedSet.has(value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
