import {
  getDashboardStatus,
  installRelease,
  listReleases,
  readConfig,
  readLocalLogs,
  saveConfig,
  staticFilePath,
} from "@/server/config-service";
import type { SaveConfigRequest, UpdateInstallRequest } from "@/lib/api-types";

const port = Number(Bun.env.WEB_API_PORT?.trim() || Bun.env.PORT?.trim() || 4174);

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/status" && request.method === "GET") {
        return json(await getDashboardStatus());
      }

      if (url.pathname === "/api/config" && request.method === "GET") {
        return json(await readConfig());
      }

      if (url.pathname === "/api/config" && request.method === "POST") {
        const body = (await request.json()) as SaveConfigRequest;
        return json(await saveConfig(body.config));
      }

      if (url.pathname === "/api/logs" && request.method === "GET") {
        return json(await readLocalLogs());
      }

      if (url.pathname === "/api/releases" && request.method === "GET") {
        return json(await listReleases());
      }

      if (url.pathname === "/api/updates/install" && request.method === "POST") {
        const body = (await request.json()) as UpdateInstallRequest;
        return json(await installRelease(body.tagName));
      }

      const staticResponse = await serveStatic(url.pathname);
      if (staticResponse) {
        return staticResponse;
      }

      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Request failed." },
        { status: 400 },
      );
    }
  },
});

console.log(`Aripa dashboard API listening on http://127.0.0.1:${port}`);

function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const normalizedPathname = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = staticFilePath(normalizedPathname);
  if (!filePath) {
    return null;
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }

  const index = Bun.file(staticFilePath("index.html"));
  if (await index.exists()) {
    return new Response(index, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  }

  return null;
}
