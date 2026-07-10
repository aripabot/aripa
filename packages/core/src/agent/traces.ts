import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import * as z from "zod";

export const agentTraceStatusSchema = z.enum(["running", "completed", "failed"]);
export const agentTraceSpanKindSchema = z.enum(["model", "tool", "reply"]);
export const agentTraceSpanStatusSchema = z.enum(["running", "completed", "failed"]);

export type AgentTraceStatus = z.infer<typeof agentTraceStatusSchema>;
export type AgentTraceSpanKind = z.infer<typeof agentTraceSpanKindSchema>;
export type AgentTraceSpanStatus = z.infer<typeof agentTraceSpanStatusSchema>;

const traceContextSchema = z.object({
  system: z.string(),
  prompt: z.string(),
});

const traceUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
});

export type AgentTraceUsage = z.infer<typeof traceUsageSchema>;

const traceStartedEventSchema = z.object({
  type: z.literal("trace_started"),
  traceId: z.string(),
  occurredAt: z.string(),
  guildId: z.string(),
  channelId: z.string(),
  messageId: z.string(),
  userId: z.string(),
  private: z.boolean(),
  context: traceContextSchema.nullable(),
});

const spanStartedEventSchema = z.object({
  type: z.literal("span_started"),
  traceId: z.string(),
  occurredAt: z.string(),
  spanId: z.string(),
  kind: agentTraceSpanKindSchema,
  name: z.string(),
  stepNumber: z.number().int().nonnegative().nullable(),
  parentSpanId: z.string().nullable(),
  detail: z.unknown().nullable(),
});

const spanFinishedEventSchema = z.object({
  type: z.literal("span_finished"),
  traceId: z.string(),
  occurredAt: z.string(),
  spanId: z.string(),
  status: z.enum(["completed", "failed"]),
  detail: z.unknown().nullable(),
  usage: traceUsageSchema.nullable(),
  error: z.string().nullable(),
});

const traceFinishedEventSchema = z.object({
  type: z.literal("trace_finished"),
  traceId: z.string(),
  occurredAt: z.string(),
  status: z.enum(["completed", "failed"]),
  reply: z.string().nullable(),
  error: z.string().nullable(),
});

export const agentTraceEventSchema = z.discriminatedUnion("type", [
  traceStartedEventSchema,
  spanStartedEventSchema,
  spanFinishedEventSchema,
  traceFinishedEventSchema,
]);

export type AgentTraceEvent = z.infer<typeof agentTraceEventSchema>;

export interface AgentTraceSpan {
  id: string;
  kind: AgentTraceSpanKind;
  name: string;
  stepNumber: number | null;
  parentSpanId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: AgentTraceSpanStatus;
  detail: unknown | null;
  result: unknown | null;
  usage: AgentTraceUsage | null;
  error: string | null;
}

export interface AgentTrace {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  private: boolean;
  context: z.infer<typeof traceContextSchema> | null;
  startedAt: string;
  endedAt: string | null;
  status: AgentTraceStatus;
  reply: string | null;
  error: string | null;
  spans: AgentTraceSpan[];
  sequence: number;
}

export interface AgentTraceEventEnvelope {
  sequence: number;
  event: AgentTraceEvent;
}

export interface StartAgentTraceInput {
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  private: boolean;
  system: string;
  prompt: string;
}

export interface StartAgentTraceSpanInput {
  traceId: string;
  spanId?: string;
  kind: AgentTraceSpanKind;
  name: string;
  stepNumber?: number;
  parentSpanId?: string;
  detail?: unknown;
}

export interface FinishAgentTraceSpanInput {
  traceId: string;
  spanId: string;
  status: "completed" | "failed";
  detail?: unknown;
  usage?: AgentTraceUsage;
  error?: string;
}

export interface FinishAgentTraceInput {
  traceId: string;
  status: "completed" | "failed";
  reply?: string;
  error?: string;
}

export interface AgentTraceRecorder {
  startTrace(input: StartAgentTraceInput): string;
  startSpan(input: StartAgentTraceSpanInput): string;
  finishSpan(input: FinishAgentTraceSpanInput): void;
  finishTrace(input: FinishAgentTraceInput): void;
}

const agentTraceEventEnvelopeSchema = z.object({
  sequence: z.number().int().nonnegative(),
  event: agentTraceEventSchema,
});

export class AgentTraceStore implements AgentTraceRecorder {
  private readonly now: () => Date;
  private readonly memoryEvents: AgentTraceEventEnvelope[] | null;
  private sequence: number;

  constructor(path: string, options: { now?: () => Date } = {}) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.path = path;
    this.now = options.now ?? (() => new Date());
    this.memoryEvents = path === ":memory:" ? [] : null;
    this.sequence = this.readEvents().at(-1)?.sequence ?? 0;
  }

  private readonly path: string;

  startTrace(input: StartAgentTraceInput): string {
    const traceId = randomUUID();
    this.append({
      type: "trace_started",
      traceId,
      occurredAt: this.timestamp(),
      guildId: input.guildId,
      channelId: input.channelId,
      messageId: input.messageId,
      userId: input.userId,
      private: input.private,
      context: input.private ? null : { system: input.system, prompt: input.prompt },
    });
    this.prune();
    return traceId;
  }

  startSpan(input: StartAgentTraceSpanInput): string {
    const spanId = input.spanId ?? randomUUID();
    this.append({
      type: "span_started",
      traceId: input.traceId,
      occurredAt: this.timestamp(),
      spanId,
      kind: input.kind,
      name: input.name,
      stepNumber: input.stepNumber ?? null,
      parentSpanId: input.parentSpanId ?? null,
      detail: input.detail ?? null,
    });
    return spanId;
  }

  finishSpan(input: FinishAgentTraceSpanInput): void {
    this.append({
      type: "span_finished",
      traceId: input.traceId,
      occurredAt: this.timestamp(),
      spanId: input.spanId,
      status: input.status,
      detail: input.detail ?? null,
      usage: input.usage ?? null,
      error: input.error ?? null,
    });
  }

  finishTrace(input: FinishAgentTraceInput): void {
    this.append({
      type: "trace_finished",
      traceId: input.traceId,
      occurredAt: this.timestamp(),
      status: input.status,
      reply: input.reply ?? null,
      error: input.error ?? null,
    });
  }

  listTraces(limit = 100): AgentTrace[] {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return buildAgentTraces(this.readEvents())
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, safeLimit);
  }

  getTrace(traceId: string): AgentTrace | null {
    return (
      buildAgentTraces(this.readEvents().filter(({ event }) => event.traceId === traceId)).at(0) ??
      null
    );
  }

  listEventsAfter(sequence: number, limit = 200): AgentTraceEventEnvelope[] {
    return this.readEvents()
      .filter((envelope) => envelope.sequence > sequence)
      .slice(0, Math.max(1, Math.min(limit, 1_000)));
  }

  latestSequence(): number {
    return this.readEvents().at(-1)?.sequence ?? 0;
  }

  private append(event: AgentTraceEvent): void {
    this.sequence += 1;
    const envelope = { sequence: this.sequence, event } satisfies AgentTraceEventEnvelope;
    if (this.memoryEvents) {
      this.memoryEvents.push(envelope);
      return;
    }
    appendFileSync(this.path, `${stringifyTraceEnvelope(envelope)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(this.path, 0o600);
  }

  private prune(): void {
    const events = this.readEvents();
    const traceIds = events
      .filter(({ event }) => event.type === "trace_started")
      .map(({ event }) => event.traceId);
    if (traceIds.length <= 500) return;

    const retainedIds = new Set(traceIds.slice(-500));
    const retainedEvents = events.filter(({ event }) => retainedIds.has(event.traceId));
    if (this.memoryEvents) {
      this.memoryEvents.splice(0, this.memoryEvents.length, ...retainedEvents);
      return;
    }
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, retainedEvents.map(stringifyTraceEnvelope).join("\n") + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.path);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private readEvents(): AgentTraceEventEnvelope[] {
    if (this.memoryEvents) return [...this.memoryEvents];
    try {
      const lines = readFileSync(this.path, "utf8").split(/\r?\n/).filter(Boolean);
      return lines.flatMap((line, index) => {
        try {
          return [agentTraceEventEnvelopeSchema.parse(JSON.parse(line))];
        } catch (error) {
          if (index === lines.length - 1) return [];
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
}

export function resolveAgentTracePath(databasePath: string): string {
  return join(dirname(databasePath), "agent-traces.jsonl");
}

function stringifyTraceEnvelope(envelope: AgentTraceEventEnvelope): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(envelope, (_key, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Error) return { name: value.name, message: value.message };
    if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    return value;
  });
}

export function buildAgentTraces(envelopes: readonly AgentTraceEventEnvelope[]): AgentTrace[] {
  const traces = new Map<string, AgentTrace>();

  for (const { sequence, event } of envelopes) {
    switch (event.type) {
      case "trace_started":
        traces.set(event.traceId, {
          id: event.traceId,
          guildId: event.guildId,
          channelId: event.channelId,
          messageId: event.messageId,
          userId: event.userId,
          private: event.private,
          context: event.context,
          startedAt: event.occurredAt,
          endedAt: null,
          status: "running",
          reply: null,
          error: null,
          spans: [],
          sequence,
        });
        break;
      case "span_started": {
        const trace = traces.get(event.traceId);
        if (!trace) break;
        trace.spans.push({
          id: event.spanId,
          kind: event.kind,
          name: event.name,
          stepNumber: event.stepNumber,
          parentSpanId: event.parentSpanId,
          startedAt: event.occurredAt,
          endedAt: null,
          status: "running",
          detail: event.detail,
          result: null,
          usage: null,
          error: null,
        });
        trace.sequence = sequence;
        break;
      }
      case "span_finished": {
        const trace = traces.get(event.traceId);
        const span = trace?.spans.find((candidate) => candidate.id === event.spanId);
        if (!trace || !span) break;
        span.endedAt = event.occurredAt;
        span.status = event.status;
        span.result = event.detail;
        span.usage = event.usage;
        span.error = event.error;
        trace.sequence = sequence;
        break;
      }
      case "trace_finished": {
        const trace = traces.get(event.traceId);
        if (!trace) break;
        for (const span of trace.spans) {
          if (span.status !== "running") continue;
          span.status = event.status;
          span.endedAt = event.occurredAt;
          span.error = event.error;
        }
        trace.endedAt = event.occurredAt;
        trace.status = event.status;
        trace.reply = event.reply;
        trace.error = event.error;
        trace.sequence = sequence;
        break;
      }
    }
  }

  return [...traces.values()];
}
