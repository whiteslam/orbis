import { loadPortfolioNews } from '@/lib/news/portfolio';
import { homeRequest, NO_STORE } from '@/lib/home/route-auth';

// GET /api/invest/news → today's news read against the person's holdings.
// A route handler, like Home's background reads: brokers and a model can be
// slow, and server actions run one at a time.
export async function GET() {
  const { requester, status } = await homeRequest();
  if (!requester) return Response.json(null, { status, headers: NO_STORE });
  try {
    return Response.json(await loadPortfolioNews(requester.userId, requester.email), { headers: NO_STORE });
  } catch (error) {
    console.error('Portfolio news failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
