import type { ReactNode } from 'react';
import { attentionItems, attentionLead } from '@/components/career/attention';
import { countRange, moneyShort } from '@/components/career/format';
import { PAGE_META, allApplications, hrefFor, navOf, openCount, percent, relativeTime, untilText, weekDelta, type PanelPage } from '@/components/career/panel/panel-data';
import { hadReply } from '@/lib/career/status';
import type { CareerHome } from '@/lib/career/view';

type Key = { id: string; value: string; label: string; badge?: { text: string; tone: 'up' | 'down' | 'flat' } | null };

function overviewKeys(home: CareerHome): Key[] {
  const { week } = home;
  const delta = weekDelta(week.sent, week.sentLastWeek);
  return [
    { id: 'sent', value: String(week.sent), label: 'Sent this week', badge: delta },
    { id: 'interviews', value: String(home.counts.interviews), label: 'Interviews booked' },
    { id: 'reply', value: week.replyRate === null ? 'Too early' : percent(week.replyRate), label: week.replyRate === null ? 'Reply rate, once more are out' : 'Reply rate' },
  ];
}

function pipelineKeys(home: CareerHome): Key[] {
  const cards = allApplications(home);
  const replied = cards.filter((card) => hadReply(card.application.status)).length;
  return [
    { id: 'open', value: String(openCount(cards)), label: 'In play' },
    { id: 'replied', value: String(replied), label: replied === 1 ? 'Got a reply' : 'Got replies' },
    { id: 'offers', value: String(home.counts.offers), label: home.counts.offers === 1 ? 'Offer waiting' : 'Offers waiting' },
  ];
}

function jobsKeys(home: CareerHome): Key[] {
  const last = home.state.lastIngestAt;
  return [
    { id: 'matches', value: String(home.counts.forYou), label: 'New above your bar' },
    { id: 'queue', value: String(home.counts.queue), label: 'Drafts ready to send' },
    { id: 'search', value: last ? relativeTime(last) : 'Not yet', label: 'Last search' },
  ];
}

function interviewKeys(home: CareerHome): Key[] {
  const now = Date.now();
  const next = [...home.upcoming].filter((item) => item.at && Date.parse(item.at) > now).sort((left, right) => (left.at ?? '').localeCompare(right.at ?? ''))[0];
  const prepped = home.upcoming.filter((item) => item.application.prep).length;
  return [
    { id: 'upcoming', value: String(home.upcoming.length), label: 'Coming up' },
    { id: 'next', value: next?.at ? untilText(next.at) : 'None booked', label: next ? `Next, ${next.job.company}` : 'Next interview' },
    { id: 'prep', value: `${prepped} of ${home.upcoming.length}`, label: 'Prep packs ready' },
  ];
}

function offerKeys(home: CareerHome): Key[] {
  const pulse = home.insights?.salary[0] ?? null;
  const target = home.state.spec?.salaryTarget ?? null;
  return [
    { id: 'offers', value: String(home.counts.offers), label: home.counts.offers === 1 ? 'Offer waiting' : 'Offers waiting' },
    { id: 'median', value: pulse ? moneyShort(pulse.p50, pulse.currency) : 'Not enough data', label: pulse ? `Market median, ${pulse.sample} listings` : 'Market median' },
    { id: 'target', value: target ? moneyShort(target.amount, target.currency) : 'Not set', label: 'Your target' },
  ];
}

function insightKeys(home: CareerHome): Key[] {
  const insights = home.insights;
  const gap = insights?.skillGaps[0];
  return [
    { id: 'replies', value: insights ? countRange(insights.forecast.replies) : 'Too early', label: 'Replies in 14 days' },
    { id: 'gap', value: gap ? gap.skill : 'None', label: gap ? `Would unlock ${gap.jobsItWouldUnlock} jobs` : 'Biggest skill gap' },
    { id: 'day', value: insights?.bestDay.day ?? 'Too early', label: 'Best day to apply' },
  ];
}

function setupKeys(home: CareerHome): Key[] {
  const { settings } = home.state;
  const on = Object.values(settings.sources).filter(Boolean).length;
  return [
    { id: 'bar', value: String(settings.threshold), label: 'Your match bar' },
    { id: 'goal', value: String(settings.weeklyGoal), label: 'Weekly goal' },
    { id: 'sources', value: String(on), label: on === 1 ? 'Source on' : 'Sources on' },
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

/** What needs the owner, as the panel's Home counts it (unmatched replies live behind the header's inbox). */
export function panelAttention(home: CareerHome) {
  return attentionItems(home).filter((item) => item.kind !== 'unmatched');
}

const SUB_LABEL: Partial<Record<PanelPage, string>> = { pipeline: 'All applications', jobs: 'Matches' };

/** The pages under one destination, as plain text links: Applications has Interviews and Offers, Jobs has Market insights. */
function SubNav({ page, home }: Readonly<{ page: PanelPage; home: CareerHome | null }>) {
  const group = navOf(page);
  if (!group || group.pages.length < 2) return null;
  const count = (id: PanelPage) => {
    if (!home) return 0;
    if (id === 'interviews') return home.upcoming.length;
    if (id === 'offers') return home.counts.offers;
    return 0;
  };
  return (
    <nav className="cp-subnav" aria-label={`${group.label} sections`}>
      <ul>
        {group.pages.map((id) => (
          <li key={id}>
            <a href={hrefFor(id)} aria-current={page === id ? 'page' : undefined}>
              {SUB_LABEL[id] ?? PAGE_META[id].label}
              {count(id) > 0 && <span className="cp-subnav-n"><span className="sr-only">, </span>{count(id)}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The page's title: a faint context line over a big one, the page's few key
 * numbers as a quiet line of facts, and the page's actions on the right. On
 * Home the big line is what needs you ("3 things need you").
 */
export function TitleRow({ page, home, actions }: Readonly<{ page: PanelPage; home: CareerHome | null; actions?: ReactNode }>) {
  const [context, title] = PAGE_META[page].title;
  const keys = home?.state.profile ? KEYS[page](home) : [];
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  const leadsWithNeeds = page === 'overview' && home?.state.profile && home.state.spec;
  const big = leadsWithNeeds ? attentionLead(panelAttention(home).length) : title;
  return (
    <div className="cp-titlerow">
      <div className="cp-title-main">
        <h1 id="cp-title"><span suppressHydrationWarning>{page === 'overview' ? today : context}</span>{big}</h1>
        {keys.length > 0 && (
          <ul className="cp-keys" aria-label="Key numbers">
            {keys.map((key) => (
              <li key={key.id}>
                <b>{key.value}</b>
                <small>{key.label}</small>
                {key.badge && <em className={`cp-delta ${key.badge.tone}`}>{key.badge.text}</em>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {actions}
      <SubNav page={page} home={home} />
    </div>
  );
}
