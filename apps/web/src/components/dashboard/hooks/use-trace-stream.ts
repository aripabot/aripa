"use client";

import { useEffect, useState } from "react";
import type { AgentTrace } from "@aripabot/core/agent/traces.ts";

export type TraceStreamState = "connecting" | "live" | "reconnecting";

export function useTraceStream(
  initialSequence: number,
  onTraces: (traces: AgentTrace[], latestSequence: number) => void,
): TraceStreamState {
  const [state, setState] = useState<TraceStreamState>("connecting");

  useEffect(() => {
    const source = new EventSource(`/api/trace-stream?after=${initialSequence}`);
    source.addEventListener("ready", () => setState("live"));
    source.addEventListener("traces", (event) => {
      const update = JSON.parse(event.data) as {
        traces: AgentTrace[];
        latestSequence: number;
      };
      onTraces(update.traces, update.latestSequence);
      setState("live");
    });
    source.addEventListener("stream-error", () => setState("reconnecting"));
    source.addEventListener("error", () => setState("reconnecting"));
    return () => source.close();
  }, [initialSequence, onTraces]);

  return state;
}
