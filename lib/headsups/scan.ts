import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { bigSpend, categoryHot, loggingGap, type Expense } from '@/lib/headsups/checks/money';
import { routineSlipping, type RoutineEventRow, type RoutineRow } from '@/lib/headsups/checks/routines';
import { planFinished, stepsDown, type PlanRow, type StepDay } from '@/lib/headsups/checks/health';
import { addDays } from '@/lib/headsups/dates';
import { AI_WORDED_PER_DAY, dueForScan, localNow, mergeAction, pruneBefore, runChecks } from '@/lib/headsups/plan';
import { mayPush } from '@/lib/headsups/push-rules';
import { wordFinding } from '@/lib/headsups/word';
import type { Finding } from '@/lib/headsups/types';
import { localClock } from '@/lib/notifications/schedule';
import { pushToUser } from '@/lib/notifications/push';

type Admin = ReturnType<typeof createAdminClient>;
const INDIA = 'Asia/Kolkata';

const indiaDate = (iso: string) => localClock(new Date(iso), INDIA).date;

/** Everything the checks read for one person, loaded once. */
async function loadInput(admin: Admin, userId: string, today: string) {
  // Four calendar months back covers "the three months before this one" and the 90-day median.
  const since = `${addDays(today, -125)}T00:00:00Z`;
  const [expenses, routines, events, steps, plans] = await Promise.all([
    admin.from('transactions').select('id,amount,currency,category,merchant,occurred_at').eq('user_id', userId).eq('direction', 'expense').gte('occurred_at', since).limit(5000),
    admin.from('routines').select('id,title,days,active,archived_at,created_at').eq('user_id', userId),
    admin.from('routine_events').select('routine_id,local_date,status').eq('user_id', userId).gte('local_date', addDays(today, -14)),
    admin.from('health_daily_steps').select('date,steps').eq('user_id', userId).gte('date', addDays(today, -35)),
    admin.from('health_plans').select('id,title,plan,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
  ]);
  const newest = plans.data?.[0];
  return {
    expenses: (expenses.data ?? []).map((row): Expense => ({ id: row.id, amount: Number(row.amount), currency: row.currency, category: row.category, merchant: row.merchant, localDate: indiaDate(row.occurred_at) })),
    routines: (routines.data ?? []).map((row): RoutineRow => ({ id: row.id, title: row.title, days: row.days, active: row.active, archivedAt: row.archived_at, createdDate: indiaDate(row.created_at) })),
    events: (events.data ?? []).map((row): RoutineEventRow => ({ routineId: row.routine_id, localDate: row.local_date, status: row.status })),
    steps: (steps.data ?? []).map((row): StepDay => ({ date: row.date, steps: row.steps })),
    plan: newest ? ({ id: newest.id, title: newest.title, createdDate: indiaDate(newest.created_at), durationWeeks: Number((newest.plan as { durationWeeks?: number })?.durationWeeks) || 1 } satisfies PlanRow) : null,
  };
}

async function saveFindings(admin: Admin, userId: string, findings: Finding[], now: Date) {
  if (!findings.length) return 0;
  const { data: existing } = await admin.from('headsups').select('id,dedupe_key,status,updated_at').eq('user_id', userId).in('dedupe_key', findings.map((item) => item.dedupeKey));
  const byKey = new Map((existing ?? []).map((row) => [row.dedupe_key as string, row]));
  const { count: worded } = await admin.from('headsups').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('worded_by', 'ai').gte('created_at', new Date(now.getTime() - 86_400_000).toISOString());
  let aiLeft = AI_WORDED_PER_DAY - (worded ?? 0);
  let saved = 0;
  for (const finding of findings) {
    const row = byKey.get(finding.dedupeKey);
    const action = mergeAction(row ? { status: row.status, updatedAt: row.updated_at } : null, now);
    if (action === 'skip') continue;
    if (action === 'refresh') {
      await admin.from('headsups').update({ evidence: finding.evidence }).eq('id', row!.id);
      continue;
    }
    const wording = await wordFinding(userId, finding, aiLeft > 0);
    if (wording.wordedBy === 'ai') aiLeft -= 1;
    const values = {
      user_id: userId, kind: finding.kind, dedupe_key: finding.dedupeKey, urgency: finding.urgency, evidence: finding.evidence,
      title: wording.title, body: wording.body, action: finding.action, action_label: wording.actionLabel, worded_by: wording.wordedBy,
      status: 'new', snoozed_until: null, pushed_at: null, created_at: now.toISOString(),
    };
    const { error } = action === 'insert'
      ? await admin.from('headsups').insert(values)
      : await admin.from('headsups').update(values).eq('id', row!.id);
    if (error) console.error('Saving a heads-up failed', error);
    else saved += 1;
  }
  return saved;
}

/** Scans everyone due, until the deadline. The rest are picked up by the next run. */
export async function scanDue(admin: Admin, now: Date, deadline: number) {
  const [prefs, notify] = await Promise.all([
    admin.from('headsup_preferences').select('user_id,disabled_kinds,last_scan_date'),
    admin.from('notification_preferences').select('user_id,timezone'),
  ]);
  if (prefs.error) throw new Error('Heads-up preferences could not be loaded.');
  const zones = new Map((notify.data ?? []).map((row) => [row.user_id as string, row.timezone as string]));
  const people = (prefs.data ?? []).map((row) => ({ userId: row.user_id as string, timeZone: zones.get(row.user_id) ?? INDIA, lastScanDate: row.last_scan_date as string | null, disabled: (row.disabled_kinds ?? []) as string[] }));
  const disabledBy = new Map(people.map((person) => [person.userId, person.disabled]));
  const counts = { scanned: 0, findings: 0, failed: 0 };

  for (const person of dueForScan(people, now)) {
    if (Date.now() > deadline) break;
    // Claim the day first, so an overlapping run skips this person.
    const { data: claimed } = await admin.from('headsup_preferences').update({ last_scan_date: person.localDate }).eq('user_id', person.userId)
      .or(`last_scan_date.is.null,last_scan_date.lt.${person.localDate}`).select('user_id');
    if (!claimed?.length) continue;
    try {
      const today = person.localDate;
      const input = await loadInput(admin, person.userId, today);
      const moneyInput = { today, expenses: input.expenses };
      const { findings, failed } = runChecks([
        { kind: 'money.big_spend', run: () => bigSpend(moneyInput) },
        { kind: 'money.category_hot', run: () => categoryHot(moneyInput) },
        { kind: 'money.logging_gap', run: () => loggingGap(moneyInput) },
        { kind: 'routine.slipping', run: () => routineSlipping({ today, routines: input.routines, events: input.events }) },
        { kind: 'health.steps_down', run: () => stepsDown({ today, steps: input.steps }) },
        { kind: 'health.plan_finished', run: () => planFinished({ today, plan: input.plan }) },
      ], disabledBy.get(person.userId) ?? []);
      counts.findings += await saveFindings(admin, person.userId, findings, now);
      counts.failed += failed.length;
      await admin.from('headsups').delete().eq('user_id', person.userId).lt('created_at', pruneBefore(now));
      counts.scanned += 1;
    } catch (error) {
      console.error('Heads-up scan failed for a person', error);
      counts.failed += 1;
    }
  }
  return counts;
}

/** Sends urgent heads-ups that are allowed out now: new ones, and ones held overnight. */
export async function pushWaiting(admin: Admin, now: Date, deadline: number) {
  const { data: waiting } = await admin.from('headsups').select('id,user_id,urgency,status,title,body,worded_by,created_at,pushed_at,snoozed_until')
    .eq('urgency', 'urgent').eq('status', 'new').is('pushed_at', null).gte('created_at', new Date(now.getTime() - 86_400_000).toISOString()).order('created_at').limit(50);
  const counts = { sent: 0, held: 0 };
  for (const headsup of waiting ?? []) {
    if (Date.now() > deadline) break;
    const [prefs, devices] = await Promise.all([
      admin.from('notification_preferences').select('enabled,timezone').eq('user_id', headsup.user_id).maybeSingle(),
      admin.from('push_subscriptions').select('endpoint', { count: 'exact', head: true }).eq('user_id', headsup.user_id),
    ]);
    const clock = localNow(now, prefs.data?.timezone ?? INDIA);
    const { count: pushesToday } = await admin.from('notification_log').select('id', { count: 'exact', head: true }).eq('user_id', headsup.user_id).eq('slot', 'headsup').eq('local_date', clock.date);
    const allowed = mayPush(
      { urgency: headsup.urgency, createdAt: headsup.created_at, pushedAt: headsup.pushed_at, snoozedUntil: headsup.snoozed_until, status: headsup.status },
      { pushesToday: pushesToday ?? 0, localMinutes: clock.minutes, notificationsEnabled: Boolean(prefs.data?.enabled), hasDevice: (devices.count ?? 0) > 0 },
      now,
    );
    if (!allowed) {
      counts.held += 1;
      continue;
    }
    const { data: claimed } = await admin.from('headsups').update({ pushed_at: now.toISOString() }).eq('id', headsup.id).is('pushed_at', null).select('id');
    if (!claimed?.length) continue;
    const push = await pushToUser(admin, headsup.user_id, { title: headsup.title, body: headsup.body, tag: `orbis-headsup-${headsup.id}`.slice(0, 64), url: `/?headsup=${headsup.id}` });
    await admin.from('notification_log').insert({
      user_id: headsup.user_id, slot: 'headsup', local_date: clock.date, status: push.sent > 0 ? 'sent' : 'failed',
      title: headsup.title.slice(0, 80), body: headsup.body.slice(0, 300), source: headsup.worded_by, devices_sent: push.sent,
    });
    if (push.sent > 0) counts.sent += 1;
  }
  return counts;
}
