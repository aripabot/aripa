import {
  AgentTraceStore,
  resolveAgentTracePath,
  type AgentTrace,
} from "@aripabot/core/agent/traces.ts";

import type { TraceResponse, TracesResponse } from "@/lib/api-types";
import { resolveDatabasePath } from "@/server/operations";

export async function readAgentTraces(): Promise<TracesResponse> {
  return withTraceStore((store) => ({
    traces: store.listTraces(),
    latestSequence: store.latestSequence(),
  }));
}

export async function readAgentTrace(traceId: string): Promise<TraceResponse | null> {
  return withTraceStore((store) => {
    const trace = store.getTrace(traceId);
    return trace ? { trace, latestSequence: store.latestSequence() } : null;
  });
}

export async function readChangedAgentTraces(
  afterSequence: number,
): Promise<{ traces: AgentTrace[]; latestSequence: number }> {
  return withTraceStore((store) => {
    const events = store.listEventsAfter(afterSequence);
    const traceIds = [...new Set(events.map(({ event }) => event.traceId))];
    return {
      traces: traceIds.flatMap((traceId) => {
        const trace = store.getTrace(traceId);
        return trace ? [trace] : [];
      }),
      latestSequence: events.at(-1)?.sequence ?? afterSequence,
    };
  });
}

async function withTraceStore<T>(read: (store: AgentTraceStore) => T): Promise<T> {
  const store = new AgentTraceStore(resolveAgentTracePath(await resolveDatabasePath()));
  return read(store);
}
