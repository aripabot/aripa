import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { POST } from "@/app/api/auth/login/route";
import { createDashboardPassword, DASHBOARD_SESSION_COOKIE } from "@/server/dashboard-auth";

describe("dashboard login route", () => {
  test("rejects login before the dashboard password is created", async () => {
    await withTempAuth(async () => {
      const response = await POST(loginRequest("anything"));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Dashboard password has not been created.",
      });
    });
  });

  test("sets an http-only dashboard session cookie after a valid login", async () => {
    await withTempAuth(async () => {
      const { password } = await createDashboardPassword();
      const response = await POST(loginRequest(password));

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    });
  });

  test("rejects an invalid dashboard password", async () => {
    await withTempAuth(async () => {
      await createDashboardPassword();
      const response = await POST(loginRequest("wrong"));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "The password is incorrect." });
    });
  });

  test("rate limits repeated invalid dashboard passwords", async () => {
    await withTempAuth(async () => {
      await createDashboardPassword();

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await POST(loginRequest("wrong", "203.0.113.10"));
        expect(response.status).toBe(401);
      }

      const response = await POST(loginRequest("wrong", "203.0.113.10"));
      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        error: "Too many failed attempts. Try again later.",
      });
    });
  });
});

function loginRequest(password: string, clientAddress?: string): Request {
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(clientAddress ? { "x-forwarded-for": clientAddress } : {}),
    },
    body: JSON.stringify({ password }),
  });
}

async function withTempAuth(run: () => Promise<void>): Promise<void> {
  const previousAuthPath = Bun.env.DASHBOARD_AUTH_PATH;
  const directory = await mkdtemp(join(tmpdir(), "aripa-dashboard-login-test-"));

  Bun.env.DASHBOARD_AUTH_PATH = join(directory, "dashboard-auth.json");

  try {
    await run();
  } finally {
    if (previousAuthPath === undefined) {
      delete Bun.env.DASHBOARD_AUTH_PATH;
    } else {
      Bun.env.DASHBOARD_AUTH_PATH = previousAuthPath;
    }

    await rm(directory, { recursive: true, force: true });
  }
}
