// The Social row under the Home brief: what is planned to go out today.
//
// State, not a call to action, like every other quiet row. A month with no
// posts at all gets no row, so Home stays quiet for anyone not using the planner.
import type { QuietRow } from '@/lib/focus/types';
import type { SocialPost } from '@/lib/social/types';

export function composeSocialRow(posts: SocialPost[], today: string): QuietRow | null {
  if (!posts.length) return null;
  const todays = posts.filter((post) => post.plannedFor === today);
  if (!todays.length) return { label: 'Social today', value: 'Nothing planned', empty: true, target: 'social' };
  const notReady = todays.filter((post) => post.status === 'idea' || post.status === 'draft').length;
  const out = todays.every((post) => post.status === 'published');
  const tail = notReady ? `${notReady} not ready` : out ? 'all out' : 'ready';
  return { label: 'Social today', value: `${todays.length} today, ${tail}`, empty: false, target: 'social' };
}
