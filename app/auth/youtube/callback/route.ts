import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { verifyState } from '@/lib/security/oauth-state';
import { siteUrl } from '@/lib/social/site';
import { saveYouTubeConnection } from '@/lib/youtube/connection';
import { exchangeYouTubeCode, getChannel, youtubeStateCookieName, YouTubeAuthError } from '@/lib/youtube/google';

/**
 * Where Google sends the user back, carrying a one-time code.
 *
 * The code is traded for tokens immediately: it is single use and expires in
 * minutes, so there is nothing worth keeping if the exchange fails.
 *
 * The code is only accepted when the `state` Google echoes back matches the
 * signed cookie set by /auth/youtube/start for this same user. Without that, a
 * crafted link could attach someone else's channel to whoever clicks it.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const done = (response: NextResponse) => {
    // The state is single-use: clear it whatever the outcome.
    response.cookies.set(youtubeStateCookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/auth/youtube', maxAge: 0 });
    return response;
  };
  const back = (reason: string) => done(NextResponse.redirect(new URL(`/?tab=social&social=${reason}`, request.url)));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return done(NextResponse.redirect(new URL('/login', request.url)));
  }

  const code = url.searchParams.get('code');
  // The user can decline at Google, which comes back with an error and no code.
  if (!code || url.searchParams.get('error')) return back('youtube-cancelled');

  // Usually more than ten minutes at Google, a start on another address, or a
  // link that never started here at all.
  if (!verifyState(request.cookies.get(youtubeStateCookieName)?.value, url.searchParams.get('state'), userId, 'youtube')) {
    console.error('YouTube callback rejected', { stateCookie: request.cookies.has(youtubeStateCookieName), returnedState: url.searchParams.has('state') });
    return back('youtube-failed');
  }

  try {
    const tokens = await exchangeYouTubeCode(code, siteUrl(request));
    const channel = await getChannel(tokens.accessToken);
    // A Google account can exist without a channel; nothing is stored for it.
    // Google still holds a grant with upload scope here. It isn't revoked, because that grant is shared with Gmail.
    if (!channel) {
      console.warn('YouTube connect: the Google account has no channel');
      return back('youtube-no-channel');
    }
    await saveYouTubeConnection(userId, channel, tokens);
  } catch (error_) {
    // Orbis's own words (for example "connect again and allow access") help
    // more than a generic failure.
    // Only the error's name is logged: its message could carry Google's response.
    // A YouTubeAuthError's message is Orbis's own sentence (no token, no Google text), so it is safe to log.
    if (error_ instanceof YouTubeAuthError) console.warn('YouTube connect refused:', error_.message);
    else console.error('YouTube connect failed', error_ instanceof Error ? error_.name : 'unknown');
    const message = error_ instanceof YouTubeAuthError ? error_.message : null;
    const why = message ? `&why=${encodeURIComponent(message.slice(0, 160))}` : '';
    return done(NextResponse.redirect(new URL(`/?tab=social&social=youtube-failed${why}`, request.url)));
  }
  console.info('YouTube connected');
  return back('youtube-connected');
}
