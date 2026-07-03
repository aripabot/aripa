import { describe, expect, test } from "vitest";
import {
  convertFmEventStreamToChatCompletion,
  expandFmToolCallArguments,
  fixFmToolSchema,
  rewriteFmToolRequestBody,
} from "@aripabot/core/agent/fm-compat.ts";

describe("fixFmToolSchema", () => {
  test("round-trips nested object parameters through JSON strings", () => {
    const { schema, jsonFields } = fixFmToolSchema({
      type: "object",
      required: ["query", "filters"],
      properties: {
        query: {
          type: "string",
          description: "Search text.",
        },
        filters: {
          type: "object",
          description: "Search filters.",
          required: ["channelIds"],
          properties: {
            channelIds: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    });

    expect(jsonFields).toEqual(["filters"]);
    expect(schema).toEqual({
      type: "object",
      required: ["query", "filters"],
      properties: {
        query: {
          type: "string",
        },
        filters: {
          type: "string",
          description: expect.stringContaining("JSON string matching:"),
        },
      },
    });
  });

  test("adds an empty required list for tools without parameters", () => {
    expect(fixFmToolSchema(undefined).schema).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });

  test("tracks whether the upstream request should stream", () => {
    expect(rewriteFmToolRequestBody(JSON.stringify({ stream: true })).stream).toBe(true);
    expect(rewriteFmToolRequestBody(JSON.stringify({ stream: false })).stream).toBe(false);
    expect(rewriteFmToolRequestBody(JSON.stringify({})).stream).toBe(false);
  });
});

describe("rewriteFmToolRequestBody", () => {
  test("flattens OpenAI tool definitions and records fields to re-expand", () => {
    const rewrite = rewriteFmToolRequestBody(
      JSON.stringify({
        model: "system",
        messages: [{ role: "user", content: "search" }],
        tools: [
          {
            type: "function",
            function: {
              name: "search_messages",
              description: "Search Discord messages.",
              parameters: {
                type: "object",
                required: ["request"],
                properties: {
                  request: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        ],
      }),
    );

    expect(rewrite.coercion).toEqual({ search_messages: ["request"] });
    expect(JSON.parse(rewrite.body).tools[0].function.parameters).toEqual({
      type: "object",
      properties: {
        request: {
          type: "string",
          description: expect.stringContaining("JSON string matching:"),
        },
      },
      required: ["request"],
    });
  });
});

describe("convertFmEventStreamToChatCompletion", () => {
  test("normalizes a non-streaming fm SSE tool-call response to chat completion JSON", () => {
    const body = [
      'data: {"model":"pcc","choices":[{"delta":{"role":"assistant"}}],"id":"chatcmpl-1"}',
      "",
      'data: {"model":"pcc","id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"run_action","arguments":"{\\"command\\": \\";;ping\\"}"},"index":0,"type":"function"}]}}]}',
      "",
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}],"model":"pcc","id":"chatcmpl-1"}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect(convertFmEventStreamToChatCompletion(body)).toEqual({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: expect.any(Number),
      model: "pcc",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                index: 0,
                type: "function",
                function: {
                  name: "run_action",
                  arguments: '{"command": ";;ping"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  });

  test("expands coerced JSON-string tool arguments in converted SSE responses", () => {
    const body = [
      'data: {"id":"chatcmpl-1","model":"pcc","choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"search_messages","arguments":"{\\"request\\": \\"{\\\\\\"query\\\\\\":\\\\\\"hello\\\\\\"}\\"}"},"index":0,"type":"function"}]}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect(
      convertFmEventStreamToChatCompletion(body, {
        search_messages: ["request"],
      }).choices,
    ).toEqual([
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              index: 0,
              type: "function",
              function: {
                name: "search_messages",
                arguments: '{"request":{"query":"hello"}}',
              },
            },
          ],
        },
        finish_reason: null,
      },
    ]);
  });
});

describe("expandFmToolCallArguments", () => {
  test("expands JSON-string fields back to the original structured argument shape", () => {
    expect(
      expandFmToolCallArguments(
        "search_messages",
        JSON.stringify({
          request: JSON.stringify({
            query: "hello",
            channelIds: ["123"],
          }),
        }),
        { search_messages: ["request"] },
      ),
    ).toBe(
      JSON.stringify({
        request: {
          query: "hello",
          channelIds: ["123"],
        },
      }),
    );
  });
});
