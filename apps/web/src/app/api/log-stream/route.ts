import { spawn } from "node:child_process";

import { parseLogLine } from "@/server/config-service";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCKER_CONTAINER_NAME = "aripabot-docker";
const DOCKER_SOURCE_ID = `docker:${DOCKER_CONTAINER_NAME}`;

export async function GET(request: Request): Promise<Response> {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? DOCKER_SOURCE_ID;

  if (source !== DOCKER_SOURCE_ID) {
    return Response.json(
      { error: "Realtime streaming is currently available for Docker logs only." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
  let lineIndex = 0;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let dockerProcess: ReturnType<typeof spawn> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const currentProcess = spawn(
        "docker",
        ["logs", "--follow", "--timestamps", "--tail", "0", DOCKER_CONTAINER_NAME],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      dockerProcess = currentProcess;

      function enqueue(event: string, payload: unknown) {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      }

      function enqueueLine(line: string) {
        if (!line.trim()) {
          return;
        }

        const entry = parseLogLine(
          line,
          { id: DOCKER_SOURCE_ID, kind: "docker", name: "Docker" },
          lineIndex,
        );
        lineIndex += 1;
        enqueue("log", entry);
      }

      currentProcess.stdout.on("data", (chunk: Buffer) => {
        const result = flushLines(`${stdoutBuffer}${chunk.toString("utf8")}`);
        stdoutBuffer = result.rest;
        for (const line of result.lines) {
          enqueueLine(line);
        }
      });

      currentProcess.stderr.on("data", (chunk: Buffer) => {
        const result = flushLines(`${stderrBuffer}${chunk.toString("utf8")}`);
        stderrBuffer = result.rest;
        for (const line of result.lines) {
          enqueueLine(line);
        }
      });

      currentProcess.on("error", (error) => {
        enqueue("stream-error", { error: error.message });
        close();
      });

      currentProcess.on("close", (code) => {
        if (stdoutBuffer) {
          enqueueLine(stdoutBuffer);
        }
        if (stderrBuffer) {
          enqueueLine(stderrBuffer);
        }
        enqueue("done", { code });
        close();
      });

      request.signal.addEventListener("abort", () => {
        currentProcess.kill();
        close();
      });

      enqueue("ready", { sourceId: DOCKER_SOURCE_ID });

      function close() {
        if (closed) {
          return;
        }

        closed = true;
        dockerProcess = null;
        controller.close();
      }
    },
    cancel() {
      closed = true;
      dockerProcess?.kill();
      dockerProcess = null;
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

function flushLines(text: string): { lines: string[]; rest: string } {
  const lines = text.split(/\r?\n/);
  return {
    lines: lines.slice(0, -1),
    rest: lines.at(-1) ?? "",
  };
}
