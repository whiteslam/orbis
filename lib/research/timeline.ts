// A run's events laid out the way the team worked: analyst reports, the Bull
// vs Bear debate, the Research Manager's plan, the trader's proposal, the risk
// debate and the Portfolio Manager's call. Client-safe and pure.

import { AGENT_LABELS, type Agent, type PortfolioContext, type ResearchEvent } from '@/lib/research/types';

export type Said = { seq: number; agent: Agent; content: string; at: string };

export type Stage = 'waiting' | 'analysts' | 'debate' | 'plan' | 'trader' | 'risk' | 'decided';

export type Timeline = {
  status: Said[];
  reports: Said[];
  debate: Said[];
  plan: string | null;
  trader: string | null;
  risk: Said[];
  decision: string | null;
  stage: Stage;
};

const REPORT_ORDER: Agent[] = ['market', 'fundamentals', 'news'];

export function groupEvents(events: readonly ResearchEvent[]): Timeline {
  const seen = new Set<number>();
  const timeline: Timeline = { status: [], reports: [], debate: [], plan: null, trader: null, risk: [], decision: null, stage: 'waiting' };
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    const said: Said = { seq: event.seq, agent: event.agent, content: event.content, at: event.at };
    if (event.agent === 'desk') timeline.status.push(said);
    else if (REPORT_ORDER.includes(event.agent)) timeline.reports.push(said);
    else if (event.agent === 'bull' || event.agent === 'bear') timeline.debate.push(said);
    else if (event.agent === 'research_manager') timeline.plan = event.content;
    else if (event.agent === 'trader') timeline.trader = event.content;
    else if (event.agent.startsWith('risk_')) timeline.risk.push(said);
    else if (event.agent === 'portfolio_manager') timeline.decision = event.content;
  }
  timeline.reports.sort((left, right) => REPORT_ORDER.indexOf(left.agent) - REPORT_ORDER.indexOf(right.agent));
  timeline.stage = timeline.decision !== null ? 'decided'
    : timeline.risk.length ? 'risk'
      : timeline.trader !== null ? 'trader'
        : timeline.plan !== null ? 'plan'
          : timeline.debate.length ? 'debate'
            : timeline.reports.length ? 'analysts'
              : 'waiting';
  return timeline;
}

export const STAGE_LABELS: Record<Stage, string> = {
  waiting: 'Waiting for the worker to start',
  analysts: 'Analysts are writing their reports',
  debate: 'Bull and Bear are debating',
  plan: 'The Research Manager is writing the plan',
  trader: 'The trader has proposed a trade',
  risk: 'The risk team is debating the trade',
  decided: 'The Portfolio Manager has made the call',
};

export const agentLabel = (agent: Agent) => AGENT_LABELS[agent];

/** The agents write markdown; the screens show it as plain paragraphs. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const inr = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** What the call is weighed against: the owner's current position, as the run was told it. */
export function positionLine(portfolio: PortfolioContext | null, ticker: string): string | null {
  if (!portfolio) return null;
  const held = portfolio.positions.find((position) => position.ticker === ticker);
  if (!held) return 'You don’t hold this now.';
  const average = held.average_price === null ? '' : ` at an average of ${inr(held.average_price)}`;
  return `You hold ${held.quantity.toLocaleString('en-IN')}${average}.`;
}
