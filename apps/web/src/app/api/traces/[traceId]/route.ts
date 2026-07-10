import { json, jsonError } from "@/app/api/_utils/json";
import { requireDashboardApiAuth } from "@/server/dashboard-auth-next";
import { readAgentTrace } from "@/server/trace-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ traceId: string }> },
): Promise<Response> {
  const authError = await requireDashboardApiAuth(request);
  if (authError) return authError;

  try {
    const result = await readAgentTrace((await params).traceId);
    return result ? json(result) : Response.json({ error: "Trace not found." }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}
