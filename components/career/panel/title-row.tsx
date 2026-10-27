import type { ReactNode } from 'react';
import { Briefcase, CalendarCheck, CalendarClock, Clock, Gauge, HandCoins, Inbox, Layers, MessageSquareReply, Radar, Send, SlidersHorizontal, Sparkles, Target, TrendingUp } from 'lucide-react';
import { countRange, moneyShort } from '@/components/career/format';
import { PAGE_META, allApplications, openCount, percent, relativeTime, untilText, weekDelta, type PanelPage } from '@/components/career/panel/panel-data';
import { hadReply } from '@/lib/career/status';
import type { CareerHome } from '@/lib/career/view';

type Key = { id: string; icon: ReactNode; value: string; label: string; badge?: { text: string; tone: 'up' | 'down' | 'flat' } | null };

const icon = (Icon: typeof Send) => <Icon size={18} strokeWidth={2} aria-hidden="true" />;

function overviewKeys(home: CareerHome): Key[] {
  const { week } = home;
  const delta = weekDelta(week.sent, week.sentLastWeek);
  return [
    { id: 'sent', icon: icon(Send), value: String(week.sent), label: 'Sent this week', badge: delta },
    { id: 'interviews', icon: icon(CalendarCheck), value: String(home.counts.interviews), label: 'Interviews booked' },
    { id: 'reply', icon: icon(MessageSquareReply), value: week.replyRate === null ? 'Too early' : percent(week.replyRate), label: week.replyRate === null ? 'Reply rate, once more are out' : 'Reply rate' },
  ];
}

function pipelineKeys(home: CareerHome): Key[] {
  const cards = allApplications(home);
  const replied = cards.filter((card) => hadReply(card.application.status)).length;
  return [
    { id: 'open', icon: icon(Layers), value: String(openCount(cards)), label: 'In play' },
    { id: 'replied', icon: icon(MessageSquareReply), value: String(replied), label: replied === 1 ? 'Got a reply' : 'Got replies' },
    { id: 'offers', icon: icon(HandCoins), value: String(home.counts.offers), label: home.counts.offers === 1 ? 'Offer waiting' : 'Offers waiting' },
  ];
}

function jobsKeys(home: CareerHome): Key[] {
  const last = home.state.lastIngestAt;
  return [
    { id: 'matches', icon: icon(Sparkles), value: String(home.counts.forYou), label: 'New above your bar' },
    { id: 'queue', icon: icon(Inbox), value: String(home.counts.queue), label: 'Drafts ready to send' },
    { id: 'search', icon: icon(Radar), value: last ? relativeTime(last) : 'Not yet', label: 'Last search' },
  ];
}

function interviewKeys(home: CareerHome): Key[] {
  const now = Date.now();
  const next = [...home.upcoming].filter((item) => item.at && Date.parse(item.at) > now).sort((left, right) => (left.at ?? '').localeCompare(right.at ?? ''))[0];
  const prepped = home.upcoming.filter((item) => item.application.prep).length;
  return [
    { id: 'upcoming', icon: icon(CalendarClock), value: String(home.upcoming.length), label: 'Coming up' },
    { id: 'next', icon: icon(Clock), value: next?.at ? untilText(next.at) : 'None booked', label: next ? `Next, ${next.job.company}` : 'Next interview' },
    { id: 'prep', icon: icon(Target), value: `${prepped} of ${home.upcoming.length}`, label: 'Prep packs ready' },
  ];
}

function offerKeys(home: CareerHome): Key[] {
  const pulse = home.insights?.salary[0] ?? null;
  const target = home.state.spec?.salaryTarget ?? null;
  return [
    { id: 'offers', icon: icon(HandCoins), value: String(home.counts.offers), label: home.counts.offers === 1 ? 'Offer waiting' : 'Offers waiting' },
    { id: 'median', icon: icon(TrendingUp), value: pulse ? moneyShort(pulse.p50, pulse.currency) : 'Not enough data', label: pulse ? `Market median, ${pulse.sample} listings` : 'Market median' },
    { id: 'target', icon: icon(Target), value: target ? moneyShort(target.amount, target.currency) : 'Not set', label: 'Your target' },
  ];
}

function insightKeys(home: CareerHome): Key[] {
  const insights = home.insights;
  const gap = insights?.skillGaps[0];
  return [
    { id: 'replies', icon: icon(MessageSquareReply), value: insights ? countRange(insights.forecast.replies) : 'Too early', label: 'Replies in 14 days' },
    { id: 'gap', icon: icon(Sparkles), value: gap ? gap.skill : 'None', label: gap ? `Would unlock ${gap.jobsItWouldUnlock} jobs` : 'Biggest skill gap' },
    { id: 'day', icon: icon(CalendarCheck), value: insights?.bestDay.day ?? 'Too early', label: 'Best day to apply' },
  ];
}

function setupKeys(home: CareerHome): Key[] {
  const { settings } = home.state;
  const on = Object.values(settings.sources).filter(Boolean).length;
  return [
    { id: 'bar', icon: icon(Gauge), value: String(settings.threshold), label: 'Your match bar' },
    { id: 'goal', icon: icon(Briefcase), value: String(settings.weeklyGoal), label: 'Weekly goal' },
    { id: 'sources', icon: icon(SlidersHorizontal), value: String(on), label: on === 1 ? 'Source on' : 'Sources on' },
  ];
}

const KEYS: Record<PanelPage, (home: CareerHome) => Key[]> = {
  overview: overviewKeys,
  pipeline: pipelineKeys,
  jobs: jobsKeys,
  interviews: interviewKeys,
  offers: offerKeys,
  insights: insightKeys,
  setup: setupKeys,
};

/** The page's two-line title and its three key numbers, each on an icon disc. */
export function TitleRow({ page, home }: Readonly<{ page: PanelPage; home: CareerHome | null }>) {
  const [first, second] = PAGE_META[page].title;
  const keys = home?.state.profile ? KEYS[page](home) : [];
  return (
    <div className="cp-titlerow">
      <h1 id="cp-title"><span>{first}</span><span>{second}</span></h1>
      {keys.length > 0 && (
        <ul className="cp-keys" aria-label="Key numbers">
          {keys.map((key) => (
            <li key={key.id}>
              <span className="cp-key-disc">{key.icon}</span>
              <span className="cp-key-text">
                <b>{key.value}{key.badge && <em className={`cp-delta ${key.badge.tone}`}>{key.badge.text}</em>}</b>
                <small>{key.label}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
