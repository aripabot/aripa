import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  createDashboardLogoutCookie,
  createDashboardPassword,
  createDashboardSessionCookie,
  DASHBOARD_SESSION_COOKIE,
  getDashboardAuthState,
  getDashboardSessionCookieFromHeader,
  verifyDashboardPassword,
} from "@/server/dashboard-auth";

describe("dashboard auth", () => {
  test("reports an unset dashboard password", async () => {
    await withTempAuth(async () => {
      await expect(getDashboardAuthState()).resolves.toMatchObject({ status: "not_configured" });
    });
  });

  test("creates a generated password and stores only a hash", async () => {
    await withTempAuth(async (authPath) => {
      const result = await createDashboardPassword();
      const rawAuthFile = await readFile(authPath, "utf8");
      const authFileMode = (await stat(authPath)).mode & 0o777;

      expect(result.password).toHaveLength(43);
      expect(rawAuthFile).not.toContain(result.password);
      expect(rawAuthFile).toContain('"algorithm": "scrypt"');
      expect(authFileMode).toBe(0o600);
      await expect(verifyDashboardPassword(result.password)).resolves.toBe(true);
      await expect(verifyDashboardPassword("wrong-password")).resolves.toBe(false);
    });
  });

  test("requires force before replacing an existing dashboard password", async () => {
    await withTempAuth(async () => {
      const first = await createDashboardPassword();

      await expect(createDashboardPassword()).rejects.toThrow("--force");

      const second = await createDashboardPassword({ force: true });
      expect(second.replacedExisting).toBe(true);
      await expect(verifyDashboardPassword(first.password)).resolves.toBe(false);
      await expect(verifyDashboardPassword(second.password)).resolves.toBe(true);
    });
  });

  test("authenticates valid signed session cookies", async () => {
    await withTempAuth(async () => {
      await createDashboardPassword();

      const setCookie = await createDashboardSessionCookie(
        new Request("https://dashboard.example.test/"),
      );
      const sessionCookie = getDashboardSessionCookieFromHeader(setCookie);

      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Secure");
      expect(sessionCookie).toBeTruthy();
      await expect(getDashboardAuthState(sessionCookie)).resolves.toMatchObject({
        status: "authenticated",
      });
      await expect(getDashboardAuthState(`${sessionCookie}x`)).resolves.toMatchObject({
        status: "locked",
      });
    });
  });

  test("clears the dashboard session cookie", () => {
    const setCookie = createDashboardLogoutCookie(new Request("http://127.0.0.1:3000/"));

    expect(setCookie).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("Secure");
  });
});

async function withTempAuth(run: (authPath: string) => Promise<void>): Promise<void> {
  const previousAuthPath = Bun.env.DASHBOARD_AUTH_PATH;
  const directory = await mkdtemp(join(tmpdir(), "aripa-dashboard-auth-test-"));
  const authPath = join(directory, "dashboard-auth.json");

  Bun.env.DASHBOARD_AUTH_PATH = authPath;

  try {
    await run(authPath);
  } finally {
    if (previousAuthPath === undefined) {
      delete Bun.env.DASHBOARD_AUTH_PATH;
    } else {
      Bun.env.DASHBOARD_AUTH_PATH = previousAuthPath;
    }

    await rm(directory, { recursive: true, force: true });
  }
}
