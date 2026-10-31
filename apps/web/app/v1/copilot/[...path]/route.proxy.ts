import { proxyCopilotRequest } from "../../../../lib/server/copilot-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyCopilotRequest(request, { pathSegments: path ?? [] });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
