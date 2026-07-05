import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { parseLogLine, readLocalLogs } from "@/server/log-sources";

describe("dashboard log sources", () => {
  test("parses pino log lines into dashboard entries", () => {
    const entry = parseLogLine(
      JSON.stringify({
        level: 30,
        time: 1_735_689_600_000,
        msg: "Action requested.",
        metadata: { action: "ping" },
      }),
      { id: "docker:aripabot-docker", kind: "docker", name: "Docker" },
      0,
    );

    expect(entry.level).toBe("info");
    expect(entry.timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(entry.message).toBe("Action requested.");
    expect(entry.metadata).toEqual({ metadata: { action: "ping" } });
  });

  test.each([
    [10, "trace"],
    [20, "debug"],
    [30, "info"],
    [40, "warn"],
    [50, "error"],
    [60, "fatal"],
    ["warn", "warn"],
    ["unknown-level", "unknown"],
  ] as const)("maps pino level %s to %s", (level, expectedLevel) => {
    const entry = parseLogLine(
      JSON.stringify({
        level,
        msg: "Mapped level.",
      }),
      { id: "file:/tmp/aripa.log", kind: "file", name: "aripa.log" },
      0,
    );

    expect(entry.level).toBe(expectedLevel);
  });

  test("redacts sensitive log fields before returning entries", () => {
    const entry = parseLogLine(
      JSON.stringify({
        level: 50,
        msg: "Request failed with Bearer secret-token-value",
        metadata: {
          token: "secret-token-value",
          nested: { apiKey: "secret-api-key" },
        },
      }),
      { id: "file:/tmp/aripa.log", kind: "file", name: "aripa.log" },
      1,
    );

    expect(entry.message).toContain("Bearer [redacted]");
    expect(entry.raw).not.toContain("secret-token-value");
    expect(entry.metadata).toEqual({
      metadata: {
        token: "[redacted]",
        nested: { apiKey: "[redacted]" },
      },
    });
  });

  test("parses timestamped text logs with ansi codes and redacted bot tokens", () => {
    const entry = parseLogLine(
      "2026-07-05T12:34:56.789Z \u001B[31mWARN\u001B[0m retrying with Bot secret-token-value",
      { id: "docker:aripabot-docker", kind: "docker", name: "Docker" },
      2,
    );

    expect(entry.level).toBe("warn");
    expect(entry.timestamp).toBe("2026-07-05T12:34:56.789Z");
    expect(entry.message).toBe("WARN retrying with Bot [redacted]");
    expect(entry.raw).toBe("WARN retrying with Bot [redacted]");
    expect(entry.metadata).toBeNull();
  });

  test("reads current container logs when running inside Docker", async () => {
    const previousDockerRuntime = process.env.ARIPA_DOCKER_RUNTIME;
    const previousDockerLogPath = process.env.ARIPA_DOCKER_LOG_PATH;
    const directory = await mkdtemp(join(tmpdir(), "aripa-docker-log-test-"));
    const logPath = join(directory, "aripa-docker.log");

    try {
      process.env.ARIPA_DOCKER_RUNTIME = "1";
      process.env.ARIPA_DOCKER_LOG_PATH = logPath;
      await Bun.write(
        logPath,
        `${JSON.stringify({
          level: 30,
          time: 1_735_689_600_000,
          msg: "Container log line.",
        })}\n`,
      );

      const result = await readLocalLogs();
      const dockerSource = result.sources.find((source) => source.id === "docker:current");

      expect(dockerSource?.available).toBe(true);
      expect(result.entries.some((entry) => entry.message === "Container log line.")).toBe(true);
    } finally {
      if (previousDockerRuntime === undefined) {
        delete process.env.ARIPA_DOCKER_RUNTIME;
      } else {
        process.env.ARIPA_DOCKER_RUNTIME = previousDockerRuntime;
      }

      if (previousDockerLogPath === undefined) {
        delete process.env.ARIPA_DOCKER_LOG_PATH;
      } else {
        process.env.ARIPA_DOCKER_LOG_PATH = previousDockerLogPath;
      }

      await rm(directory, { recursive: true, force: true });
    }
  });
});
