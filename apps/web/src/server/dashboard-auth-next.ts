import { cookies } from "next/headers";

import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardAuthState,
  getDashboardSessionCookieFromHeader,
  type DashboardAuthState,
} from "@/server/dashboard-auth";

export async function getDashboardPageAuthState(): Promise<DashboardAuthState> {
  const cookieStore = await cookies();
  return getDashboardAuthState(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value ?? null);
}

export async function requireDashboardApiAuth(request: Request): Promise<Response | null> {
  const sessionCookie = getDashboardSessionCookieFromHeader(request.headers.get("cookie"));
  const authState = await getDashboardAuthState(sessionCookie);

  if (authState.status === "authenticated") {
    return null;
  }

  const message =
    authState.status === "not_configured"
      ? "Dashboard password has not been created."
      : "Authentication required.";

  return Response.json(
    { error: message },
    {
      status: authState.status === "not_configured" ? 403 : 401,
      headers: { "cache-control": "no-store" },
    },
  );
}
