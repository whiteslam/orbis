import { apiAction } from '@/lib/api/actions';
import { TOO_LARGE, apiError, asApiCaller, readBody } from '@/lib/api/gate';
import { NO_STORE, actionStatus, readArgs } from '@/lib/api/http';

// POST /api/v1/actions/social.loadMonth  {"args": ["2026-10-01"]}
// Runs one of the app's server actions as the caller; the reply is {"result": <what the action returned>}.
export async function POST(request: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  return asApiCaller(request, async () => {
    const action = apiAction(name);
    if (!action) return apiError(404, `There is no action called "${name}". GET /api/v1 lists them.`);
    const text = await readBody(request);
    if (text === null) return TOO_LARGE();
    const args = readArgs(text);
    if (typeof args === 'string') return apiError(400, args);
    const result = await (action as (...values: unknown[]) => Promise<unknown>)(...args);
    return Response.json({ result: result ?? null }, { status: actionStatus(result), headers: NO_STORE });
  });
}
