import { apiData } from '@/lib/api/data';
import { apiError, asApiCaller } from '@/lib/api/gate';
import { NO_STORE } from '@/lib/api/http';

// GET /api/v1/data/finance
// The summary the app shows for one area; the reply is {"data": ...}.
export async function GET(request: Request, ctx: { params: Promise<{ area: string }> }) {
  const { area } = await ctx.params;
  return asApiCaller(request, async (caller) => {
    const read = apiData(area);
    if (!read) return apiError(404, `There is no data area called "${area}". GET /api/v1 lists them.`);
    return Response.json({ data: await read(caller) }, { headers: NO_STORE });
  });
}
