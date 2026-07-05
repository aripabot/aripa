export function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

export function jsonError(error: unknown): Response {
  return json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: 400 },
  );
}

export async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json()) as unknown;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected a JSON object.");
  }

  return body as Record<string, unknown>;
}

export function readStringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || !value) {
    throw new Error(`Expected ${field} to be a non-empty string.`);
  }

  return value;
}

export function readObjectField(body: Record<string, unknown>, field: string): unknown {
  const value = body[field];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${field} to be a JSON object.`);
  }

  return value;
}
