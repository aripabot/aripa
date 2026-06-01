import { json } from "@/app/api/_utils/json";
import { createDashboardLogoutCookie } from "@/server/dashboard-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": createDashboardLogoutCookie(request),
      },
    },
  );
}
