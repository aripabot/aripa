import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";
import { readChangedAgentTraces } from "@/server/trace-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 750;

export async function GET(request: Request): Promise<Response> {
  const authError = await requireDashboardApiAuth(request);
  if (authError) return authError;

  const cursor = Number.parseInt(new URL(request.url).searchParams.get("after") ?? "0", 10);
  let sequence = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function enqueue(event: string, payload: unknown): void {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      }

      async function poll(): Promise<void> {
        try {
          const update = await readChangedAgentTraces(sequence);
          sequence = update.latestSequence;
          if (update.traces.length > 0) enqueue("traces", update);
        } catch (error) {
          enqueue("stream-error", {
            error: error instanceof Error ? error.message : "Trace stream unavailable.",
          });
        } finally {
          if (!closed) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }

      request.signal.addEventListener("abort", close, { once: true });
      enqueue("ready", { latestSequence: sequence });
      void poll();

      function close(): void {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        controller.close();
      }
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
