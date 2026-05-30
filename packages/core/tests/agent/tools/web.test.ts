import { describe, expect, test } from "vitest";
import { executeWebSearch, loadWebPrompt } from "@aripabot/core/agent/tools/web.ts";

describe("executeWebSearch", () => {
  test("returns a grounded web result with URL sources", async () => {
    const result = await executeWebSearch({
      question: "What changed recently?",
      loadPrompt: async () => "prompt",
      runWebSearch: async () => ({
        text: "A concise grounded answer.",
        sources: [
          {
            type: "source",
            sourceType: "url",
            id: "source-1",
            url: "https://example.com/article",
            title: "Example Article",
          },
          {
            type: "source",
            sourceType: "document",
            id: "source-2",
            mediaType: "application/pdf",
            title: "Ignored PDF",
          },
        ],
      }),
      log: createLog(),
    });

    expect(result).toEqual({
      type: "web_result",
      ok: true,
      question: "What changed recently?",
      answer: "A concise grounded answer.",
      sources: [
        {
          url: "https://example.com/article",
          title: "Example Article",
        },
      ],
    });
  });

  test("returns a fallback result when the web runner fails", async () => {
    const result = await executeWebSearch({
      question: "What changed recently?",
      loadPrompt: async () => "prompt",
      runWebSearch: async () => {
        throw new Error("network");
      },
      log: createLog(),
    });

    expect(result).toEqual({
      type: "web_result",
      ok: false,
      question: "What changed recently?",
      answer: "Sorry, I ran into an error while trying to get grounded information from the web.",
      sources: [],
      error: "web_search_failed",
    });
  });

  test("redacts question content from logs by default", async () => {
    const log = createCapturingLog();

    await executeWebSearch({
      question: "private search terms",
      loadPrompt: async () => "prompt",
      runWebSearch: async () => ({
        text: "A concise grounded answer.",
        sources: [],
      }),
      log: log as never,
    });

    expect(log.entries).toContainEqual({
      level: "info",
      message: "Web search requested.",
      metadata: {
        questionRedacted: true,
      },
      error: undefined,
    });
    expect(log.entries).toContainEqual({
      level: "info",
      message: "Web search completed.",
      metadata: {
        questionRedacted: true,
        sourceCount: 0,
      },
      error: undefined,
    });
  });

  test("logs question content when privacy logging is explicitly disabled", async () => {
    const log = createCapturingLog();

    await executeWebSearch({
      question: "debug search terms",
      logPrivacy: false,
      loadPrompt: async () => "prompt",
      runWebSearch: async () => ({
        text: "A concise grounded answer.",
        sources: [],
      }),
      log: log as never,
    });

    expect(log.entries).toContainEqual({
      level: "info",
      message: "Web search requested.",
      metadata: {
        question: "debug search terms",
      },
      error: undefined,
    });
  });
});

describe("loadWebPrompt", () => {
  test("loads the dedicated web prompt from disk", async () => {
    const prompt = await loadWebPrompt();

    expect(prompt).toContain("You are Aripa's web research tool.");
    expect(prompt).toContain("Do not roleplay");
  });
});

function createLog() {
  return {
    withMetadata() {
      return this;
    },
    withError() {
      return this;
    },
    info() {},
    warn() {},
    error() {},
  } as never;
}

function createCapturingLog() {
  const entries: Array<{
    level: string;
    message: string;
    metadata: unknown;
    error: unknown;
  }> = [];
  const state: {
    metadata?: unknown;
    error?: unknown;
  } = {};

  return {
    entries,
    withMetadata(metadata: unknown) {
      state.metadata = metadata;
      return this;
    },
    withError(error: unknown) {
      state.error = error;
      return this;
    },
    info(message: string) {
      entries.push({
        level: "info",
        message,
        metadata: state.metadata,
        error: state.error,
      });
      state.metadata = undefined;
      state.error = undefined;
    },
    warn(message: string) {
      entries.push({
        level: "warn",
        message,
        metadata: state.metadata,
        error: state.error,
      });
      state.metadata = undefined;
      state.error = undefined;
    },
    error(message: string) {
      entries.push({
        level: "error",
        message,
        metadata: state.metadata,
        error: state.error,
      });
      state.metadata = undefined;
      state.error = undefined;
    },
  };
}
