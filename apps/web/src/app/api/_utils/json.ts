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
