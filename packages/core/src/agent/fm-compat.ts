type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;
type FetchInput = Parameters<FetchLike>[0];
type FetchInit = Parameters<FetchLike>[1];

const FM_DEFAULT_BASE_URL = "http://127.0.0.1:1976/v1";
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "anyOf",
  "allOf",
  "oneOf",
  "if",
  "then",
  "else",
  "not",
  "$defs",
  "definitions",
  "$ref",
  "patternProperties",
  "description",
  "title",
  "examples",
  "default",
  "$schema",
  "$id",
  "$comment",
  "readOnly",
  "writeOnly",
]);
const EMBEDDED_SCHEMA_STRIP_KEYS = new Set([
  "description",
  "additionalProperties",
  "title",
  "examples",
  "default",
  "$schema",
  "$id",
  "$comment",
  "readOnly",
  "writeOnly",
]);

export interface FmToolRequestRewrite {
  body: string;
  coercion: Record<string, string[]>;
  stream: boolean;
}

export function createFmCompatibleFetch(baseFetch: FetchLike = fetch): FetchLike {
  return (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);

    if (!isChatCompletionsRequest(request)) {
      return baseFetch(request);
    }

    const rewrite = rewriteFmToolRequestBody(await request.clone().text());
    const headers = new Headers(request.headers);
    headers.delete("content-length");

    const upstreamRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: rewrite.body,
      signal: request.signal,
    });

    const response = await baseFetch(upstreamRequest);
    return rewriteFmToolResponse(response, rewrite);
  }) as FetchLike;
}

export function rewriteFmToolRequestBody(body: string): FmToolRequestRewrite {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isJsonObject(parsed)) {
      return { body, coercion: {}, stream: false };
    }

    const coercion: Record<string, string[]> = {};
    const tools = Array.isArray(parsed.tools) ? parsed.tools : null;

    if (tools) {
      parsed.tools = tools.map((tool) => rewriteFmToolDefinition(tool, coercion));
    }

    return {
      body: JSON.stringify(parsed),
      coercion,
      stream: parsed.stream === true,
    };
  } catch {
    return { body, coercion: {}, stream: false };
  }
}

export function fixFmToolSchema(schema: unknown): {
  schema: JsonObject;
  jsonFields: string[];
} {
  const result: JsonObject = {
    type: "object",
    properties: {},
    required: [],
  };
  const jsonFields: string[] = [];

  if (!isJsonObject(schema)) {
    return { schema: result, jsonFields };
  }

  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const resultProperties: JsonObject = {};

  for (const [name, property] of Object.entries(properties)) {
    if (needsJsonRoundTrip(property)) {
      jsonFields.push(name);
      const description =
        isJsonObject(property) && typeof property.description === "string"
          ? `${property.description} `
          : "";
      resultProperties[name] = {
        type: "string",
        description: `${description}JSON string matching: ${JSON.stringify(
          property,
          stripEmbeddedSchemaKey,
        )}`,
      };
      continue;
    }

    resultProperties[name] = simplifyFmSchemaProperty(property);
  }

  result.properties = resultProperties;

  if (Array.isArray(schema.required)) {
    result.required = schema.required.filter(
      (field): field is string => typeof field === "string" && field in resultProperties,
    );
  }

  return { schema: result, jsonFields };
}

export function expandFmToolCallArguments(
  toolName: string | undefined,
  argumentsJson: string,
  coercion: Record<string, string[]>,
): string {
  if (!toolName) {
    return argumentsJson;
  }

  const jsonFields = coercion[toolName];
  if (!jsonFields || jsonFields.length === 0) {
    return argumentsJson;
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (!isJsonObject(parsed)) {
      return argumentsJson;
    }

    let changed = false;
    for (const field of jsonFields) {
      if (typeof parsed[field] !== "string") {
        continue;
      }

      try {
        parsed[field] = JSON.parse(parsed[field]);
        changed = true;
      } catch {
        // Leave the model output untouched if it did not emit parseable JSON.
      }
    }

    return changed ? JSON.stringify(parsed) : argumentsJson;
  } catch {
    return argumentsJson;
  }
}

export function getFmDefaultBaseURL(): string {
  return FM_DEFAULT_BASE_URL;
}

export function convertFmEventStreamToChatCompletion(
  body: string,
  coercion: Record<string, string[]> = {},
): JsonObject {
  const completion: JsonObject = {
    id: "chatcmpl-fm",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "unknown",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "",
        },
        finish_reason: null,
      },
    ],
  };
  const choices = completion.choices as [JsonObject];
  const choice = choices[0];
  const message = choice.message as JsonObject;
  const toolCallsByIndex = new Map<number, JsonObject>();

  for (const payload of parseFmEventStreamDataPayloads(body)) {
    if (payload === "[DONE]") {
      continue;
    }

    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    if (!isJsonObject(chunk)) {
      continue;
    }

    if (typeof chunk.id === "string") {
      completion.id = chunk.id;
    }
    if (typeof chunk.created === "number") {
      completion.created = chunk.created;
    }
    if (typeof chunk.model === "string") {
      completion.model = chunk.model;
    }
    if (isJsonObject(chunk.usage)) {
      completion.usage = chunk.usage;
    }

    const chunkChoice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    if (!isJsonObject(chunkChoice)) {
      continue;
    }

    if (typeof chunkChoice.finish_reason === "string") {
      choice.finish_reason = chunkChoice.finish_reason;
    }

    const delta = isJsonObject(chunkChoice.delta) ? chunkChoice.delta : {};
    if (typeof delta.role === "string") {
      message.role = delta.role;
    }
    if (typeof delta.content === "string") {
      message.content = `${message.content ?? ""}${delta.content}`;
    }
    if (Array.isArray(delta.tool_calls)) {
      mergeFmToolCallDeltas(toolCallsByIndex, delta.tool_calls);
    }
  }

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => toolCall);

  if (toolCalls.length > 0) {
    rewriteToolCalls(toolCalls, coercion);
    message.tool_calls = toolCalls;
    if (message.content === "") {
      message.content = null;
    }
  }

  return completion;
}

async function rewriteFmToolResponse(
  response: Response,
  rewrite: FmToolRequestRewrite,
): Promise<Response> {
  if (!isTextResponse(response)) {
    return response;
  }

  const isEventStream = isEventStreamResponse(response);
  if (isEventStream && !rewrite.stream) {
    return rewriteFmNonStreamingEventStreamResponse(response, rewrite.coercion);
  }

  if (Object.keys(rewrite.coercion).length === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const body = await response.text();
  const rewrittenBody = isEventStream
    ? rewriteFmToolEventStream(body, rewrite.coercion)
    : rewriteFmToolResponseBody(body, rewrite.coercion);

  return new Response(rewrittenBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rewriteFmNonStreamingEventStreamResponse(
  response: Response,
  coercion: Record<string, string[]>,
): Promise<Response> {
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("transfer-encoding");

  return new Response(JSON.stringify(convertFmEventStreamToChatCompletion(body, coercion)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rewriteFmToolDefinition(tool: unknown, coercion: Record<string, string[]>): unknown {
  if (!isJsonObject(tool) || !isJsonObject(tool.function)) {
    return tool;
  }

  const toolFunction = tool.function;
  const { schema, jsonFields } = fixFmToolSchema(toolFunction.parameters);
  const name = typeof toolFunction.name === "string" ? toolFunction.name : null;

  if (name && jsonFields.length > 0) {
    coercion[name] = jsonFields;
  }

  return {
    ...tool,
    function: {
      ...toolFunction,
      parameters: schema,
    },
  };
}

function simplifyFmSchemaProperty(property: unknown): unknown {
  if (!isJsonObject(property)) {
    return property;
  }

  if (Array.isArray(property.anyOf)) {
    return simplifyFmSchemaProperty(mergeCompositeSchema(property, "anyOf", false));
  }
  if (Array.isArray(property.oneOf)) {
    return simplifyFmSchemaProperty(mergeCompositeSchema(property, "oneOf", false));
  }
  if (Array.isArray(property.allOf)) {
    return simplifyFmSchemaProperty(mergeCompositeSchema(property, "allOf", true));
  }

  if (property.type === "object" || isJsonObject(property.properties)) {
    return { type: "string" };
  }

  if (property.type === "array") {
    const result: JsonObject = { type: "array" };
    if ("items" in property) {
      result.items = simplifyFmSchemaProperty(property.items);
    }
    if (typeof property.description === "string") {
      result.description = property.description;
    }
    return result;
  }

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(property)) {
    if (!UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

function mergeCompositeSchema(property: JsonObject, key: string, mergeAll: boolean): JsonObject {
  const entries = Array.isArray(property[key]) ? property[key] : [];
  const base: JsonObject = {};

  if (mergeAll) {
    for (const entry of entries) {
      if (isJsonObject(entry)) {
        Object.assign(base, entry);
      }
    }
  } else {
    const selected =
      entries.find((entry) => isJsonObject(entry) && typeof entry.type === "string") ?? entries[0];
    if (isJsonObject(selected)) {
      Object.assign(base, selected);
    }
  }

  for (const [propertyKey, value] of Object.entries(property)) {
    if (propertyKey !== key && !(propertyKey in base)) {
      base[propertyKey] = value;
    }
  }

  return base;
}

function needsJsonRoundTrip(property: unknown): boolean {
  if (!isJsonObject(property)) {
    return false;
  }

  if (property.type === "object" || isJsonObject(property.properties)) {
    return true;
  }

  if (property.type === "array") {
    return needsJsonRoundTrip(property.items);
  }

  return false;
}

function rewriteFmToolResponseBody(body: string, coercion: Record<string, string[]>): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    return rewriteToolPayload(parsed, coercion) ? JSON.stringify(parsed) : body;
  } catch {
    return body;
  }
}

function rewriteFmToolEventStream(body: string, coercion: Record<string, string[]>): string {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("data:")) {
        return line;
      }

      const prefixLength = line.indexOf("data:");
      const prefix = line.slice(0, prefixLength + "data:".length);
      const payload = line.slice(prefix.length).trim();
      if (!payload || payload === "[DONE]") {
        return line;
      }

      try {
        const parsed = JSON.parse(payload) as unknown;
        return rewriteToolPayload(parsed, coercion) ? `${prefix} ${JSON.stringify(parsed)}` : line;
      } catch {
        return line;
      }
    })
    .join("\n");
}

function parseFmEventStreamDataPayloads(body: string): string[] {
  const payloads: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("data:")) {
      payloads.push(trimmed.slice("data:".length).trim());
    }
  }

  return payloads;
}

function mergeFmToolCallDeltas(toolCallsByIndex: Map<number, JsonObject>, deltas: unknown[]): void {
  for (const delta of deltas) {
    if (!isJsonObject(delta)) {
      continue;
    }

    const index = typeof delta.index === "number" ? delta.index : toolCallsByIndex.size;
    const toolCall = toolCallsByIndex.get(index) ?? {
      index,
      function: {},
    };
    toolCallsByIndex.set(index, toolCall);

    if (typeof delta.id === "string") {
      toolCall.id = delta.id;
    }
    if (typeof delta.type === "string") {
      toolCall.type = delta.type;
    }

    if (!isJsonObject(delta.function)) {
      continue;
    }

    const toolFunction = isJsonObject(toolCall.function) ? toolCall.function : {};
    toolCall.function = toolFunction;

    if (typeof delta.function.name === "string") {
      toolFunction.name = delta.function.name;
    }
    if (typeof delta.function.arguments === "string") {
      toolFunction.arguments = `${toolFunction.arguments ?? ""}${delta.function.arguments}`;
    }
  }
}

function rewriteToolPayload(payload: unknown, coercion: Record<string, string[]>): boolean {
  if (!isJsonObject(payload) || !Array.isArray(payload.choices)) {
    return false;
  }

  let changed = false;

  for (const choice of payload.choices) {
    if (!isJsonObject(choice)) {
      continue;
    }

    for (const containerKey of ["message", "delta"] as const) {
      const container = choice[containerKey];
      if (isJsonObject(container) && Array.isArray(container.tool_calls)) {
        changed = rewriteToolCalls(container.tool_calls, coercion) || changed;
      }
    }
  }

  return changed;
}

function rewriteToolCalls(toolCalls: unknown[], coercion: Record<string, string[]>): boolean {
  let changed = false;

  for (const toolCall of toolCalls) {
    if (!isJsonObject(toolCall) || !isJsonObject(toolCall.function)) {
      continue;
    }

    const toolFunction = toolCall.function;
    if (typeof toolFunction.arguments !== "string") {
      continue;
    }

    const expanded = expandFmToolCallArguments(
      typeof toolFunction.name === "string" ? toolFunction.name : undefined,
      toolFunction.arguments,
      coercion,
    );

    if (expanded !== toolFunction.arguments) {
      toolFunction.arguments = expanded;
      changed = true;
    }
  }

  return changed;
}

function isChatCompletionsRequest(request: Request): boolean {
  return (
    request.method.toUpperCase() === "POST" &&
    new URL(request.url).pathname.endsWith("/chat/completions")
  );
}

function isTextResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType.includes("application/json") ||
    contentType.includes("text/event-stream") ||
    contentType.includes("application/x-ndjson")
  );
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
}

function stripEmbeddedSchemaKey(key: string, value: unknown): unknown {
  return EMBEDDED_SCHEMA_STRIP_KEYS.has(key) ? undefined : value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
