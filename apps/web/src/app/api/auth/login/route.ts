import { json, jsonError } from "@/app/api/_utils/json";
import {
  createDashboardSessionCookie,
  hasDashboardPassword,
  verifyDashboardPassword,
} from "@/server/dashboard-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LoginRequest {
  password?: unknown;
}

const failedLoginWindowMs = 10 * 60 * 1000;
const maxFailedLoginAttempts = 10;
const failedLogins = new Map<string, { count: number; firstFailedAt: number }>();

export async function POST(request: Request) {
  try {
    if (!(await hasDashboardPassword())) {
      return json({ error: "Dashboard password has not been created." }, { status: 403 });
    }

    const clientKey = getClientKey(request);
    if (isRateLimited(clientKey)) {
      return json({ error: "Too many failed attempts. Try again later." }, { status: 429 });
    }

    const body = (await request.json()) as LoginRequest;

    if (typeof body.password !== "string" || !body.password) {
      return json({ error: "Enter the dashboard password." }, { status: 400 });
    }

    if (!(await verifyDashboardPassword(body.password))) {
      recordFailedLogin(clientKey);
      return json({ error: "The password is incorrect." }, { status: 401 });
    }

    failedLogins.delete(clientKey);

    return json(
      { ok: true },
      {
        headers: {
          "set-cookie": await createDashboardSessionCookie(request),
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}

function getClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isRateLimited(clientKey: string): boolean {
  const attempts = failedLogins.get(clientKey);

  if (!attempts) {
    return false;
  }

  if (Date.now() - attempts.firstFailedAt > failedLoginWindowMs) {
    failedLogins.delete(clientKey);
    return false;
  }

  return attempts.count >= maxFailedLoginAttempts;
}

function recordFailedLogin(clientKey: string): void {
  const now = Date.now();
  const attempts = failedLogins.get(clientKey);

  if (!attempts || now - attempts.firstFailedAt > failedLoginWindowMs) {
    failedLogins.set(clientKey, { count: 1, firstFailedAt: now });
    return;
  }

  attempts.count += 1;
}
