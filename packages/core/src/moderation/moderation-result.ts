import type { ActionContext, ActionReply } from "@aripabot/core/bot/action.ts";

export type ModerationResultStatus = "completed" | "denied" | "skipped" | "failed" | "dry_run";
export type ModerationNotifyMode = "default" | "quiet" | "dm" | "anon";

export interface ModerationTarget {
  id: string;
  label?: string;
}

export interface ModerationResult {
  type: "moderation_result";
  action: string;
  ok: boolean;
  status: ModerationResultStatus;
  message: string;
  target?: ModerationTarget;
  targets?: ModerationTarget[];
  reason?: string | null;
  durationMs?: number;
  notifyMode?: ModerationNotifyMode;
  auditLogReason?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModerationResultInput {
  action: string;
  status?: ModerationResultStatus;
  message: string;
  target?: ModerationTarget;
  targets?: ModerationTarget[];
  reason?: string | null;
  durationMs?: number;
  notifyMode?: ModerationNotifyMode;
  auditLogReason?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

export function moderationSuccess(input: ModerationResultInput): ModerationResult {
  return createModerationResult({
    ...input,
    ok: true,
    status: input.status ?? "completed",
  });
}

export function moderationFailure(input: ModerationResultInput): ModerationResult {
  return createModerationResult({
    ...input,
    ok: false,
    status: input.status ?? "failed",
  });
}

export function createModerationResult(
  input: ModerationResultInput & { ok: boolean },
): ModerationResult {
  return {
    type: "moderation_result",
    action: input.action,
    ok: input.ok,
    status: input.status ?? (input.ok ? "completed" : "failed"),
    message: input.message,
    target: input.target,
    targets: input.targets,
    reason: input.reason,
    durationMs: input.durationMs,
    notifyMode: input.notifyMode,
    auditLogReason: input.auditLogReason,
    errors: input.errors,
    metadata: input.metadata,
  };
}

export function formatModerationResultForUser(result: ModerationResult): string {
  const lines = [result.message];
  const targetSummary = formatTargets(result);

  if (targetSummary) {
    lines.push(`Target: ${targetSummary}`);
  }

  if (result.durationMs !== undefined) {
    lines.push(`Duration: ${formatDuration(result.durationMs)}`);
  }

  if (result.reason) {
    lines.push(`Reason: ${result.reason}`);
  }

  if (result.errors?.length) {
    lines.push(`Errors: ${result.errors.join("; ")}`);
  }

  return lines.join("\n");
}

export function formatModerationResultForAgent(result: ModerationResult): string {
  return JSON.stringify(result);
}

export async function replyWithModerationResult(
  context: ActionContext,
  result: ModerationResult,
): Promise<ActionReply> {
  if (context.isAgent) {
    const agentReply = formatModerationResultForAgent(result);
    context.agentReplies.push(agentReply);
    return agentReply;
  }

  return context.reply(formatModerationResultForUser(result));
}

function formatTargets(result: ModerationResult): string | null {
  if (result.targets?.length) {
    return result.targets.map(formatTarget).join(", ");
  }

  if (result.target) {
    return formatTarget(result.target);
  }

  return null;
}

function formatTarget(target: ModerationTarget): string {
  return target.label ? `${target.label} (${target.id})` : target.id;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds}ms`;
  }

  const seconds = Math.round(milliseconds / 1_000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
