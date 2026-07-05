import { spawn } from "node:child_process";

import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";
import {
  CURRENT_DOCKER_SOURCE_ID,
  HOST_DOCKER_SOURCE_ID,
  DOCKER_CONTAINER_NAME,
  getDockerRuntimeLogPath,
  isInsideDockerRuntime,
} from "@/server/docker-runtime";
import { parseLogLine } from "@/server/log-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authError = await requireDashboardApiAuth(request);
  if (authError) {
    return authError;
  }

  const url = new URL(request.url);
  const defaultSource = isInsideDockerRuntime() ? CURRENT_DOCKER_SOURCE_ID : HOST_DOCKER_SOURCE_ID;
  const source = url.searchParams.get("source") ?? defaultSource;

  if (source !== HOST_DOCKER_SOURCE_ID && source !== CURRENT_DOCKER_SOURCE_ID) {
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
  let logProcess: ReturnType<typeof spawn> | null = null;
  const streamConfig = createLogStreamConfig(source);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const currentProcess = spawn(streamConfig.command, streamConfig.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      logProcess = currentProcess;

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
          { id: streamConfig.sourceId, kind: "docker", name: "Docker" },
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

      enqueue("ready", { sourceId: streamConfig.sourceId });

      function close() {
        if (closed) {
          return;
        }

        closed = true;
        logProcess = null;
        controller.close();
      }
    },
    cancel() {
      closed = true;
      logProcess?.kill();
      logProcess = null;
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

function createLogStreamConfig(sourceId: string): {
  sourceId: string;
  command: string;
  args: string[];
} {
  if (sourceId === CURRENT_DOCKER_SOURCE_ID) {
    return {
      sourceId,
      command: "tail",
      args: ["-n", "0", "-f", getDockerRuntimeLogPath()],
    };
  }

  return {
    sourceId: HOST_DOCKER_SOURCE_ID,
    command: "docker",
    args: ["logs", "--follow", "--timestamps", "--tail", "0", DOCKER_CONTAINER_NAME],
  };
}

function flushLines(text: string): { lines: string[]; rest: string } {
  const lines = text.split(/\r?\n/);
  return {
    lines: lines.slice(0, -1),
    rest: lines.at(-1) ?? "",
  };
}
