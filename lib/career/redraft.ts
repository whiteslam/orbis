/**
 * The owner's edits to a drafted application, and the truth check run again
 * over them. Pure.
 *
 * Text the owner typed is theirs: it is never removed, but anything in it the
 * profile can't back up (a new number, a skill not on file) comes back as a
 * highlight, so they see what a recruiter might ask them to prove. An edited
 * bullet keeps the facts the bullet it replaced cited, so a reworded claim is
 * still checked against the same evidence.
 */
import type { CareerApplication, CareerProfile, CitedText, Requirements, ScreeningAnswer, TailoredDraft, TruthRemoval } from './types.ts';
import type { DraftPatch } from './view.ts';
import { checkTailored, type TailorJob } from './truth.ts';

export type DraftContent = Pick<CareerApplication, 'draft' | 'coverNote' | 'answers' | 'outreach'>;

export type PatchedContent = {
  draft: TailoredDraft;
  coverNote: CitedText;
  answers: ScreeningAnswer[];
  outreach: string;
  /** Every text the owner changed, as typed. */
  ownerEdits: string[];
};

const flat = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

/** The edited text with the old text's citations, and whether it changed. */
function edited(previous: CitedText | null, text: string, edits: string[]): CitedText {
  const changed = flat(text) !== flat(previous?.text ?? '');
  if (changed && flat(text)) edits.push(text);
  return { text: text.trim(), factIds: previous?.factIds ?? [] };
}

function patchRole(draft: TailoredDraft, patch: NonNullable<DraftPatch['roleBullets']>, edits: string[]): TailoredDraft {
  const old = draft.roles.find((role) => role.roleId === patch.roleId)?.bullets ?? [];
  const bullets = patch.bullets.filter((text) => flat(text)).map((text, index) => {
    const same = old.find((bullet) => flat(bullet.text) === flat(text));
    // An unchanged bullet keeps its own facts; a reworded one inherits the facts of the bullet it replaced.
    return same ?? edited(old[index] ?? null, text, edits);
  });
  const roles = draft.roles.some((role) => role.roleId === patch.roleId)
    ? draft.roles.map((role) => (role.roleId === patch.roleId ? { roleId: role.roleId, bullets } : role))
    : [...draft.roles, { roleId: patch.roleId, bullets }];
  return { ...draft, roles };
}

function patchAnswers(previous: ScreeningAnswer[], next: ScreeningAnswer[], edits: string[]): ScreeningAnswer[] {
  const before = new Map(previous.map((item) => [flat(item.question).toLowerCase(), flat(item.answer)]));
  return next.map((item) => {
    const answer = item.answer.trim();
    if (flat(answer) && before.get(flat(item.question).toLowerCase()) !== flat(answer)) edits.push(answer);
    return { question: item.question.trim(), answer };
  });
}

const EMPTY_DRAFT: TailoredDraft = { headline: '', summary: { text: '', factIds: [] }, skills: [], roles: [], projects: [] };

/** The application's content with the patch applied, and which texts the owner changed. */
export function patchedContent(current: DraftContent, patch: DraftPatch): PatchedContent {
  const ownerEdits: string[] = [];
  let draft = current.draft ?? EMPTY_DRAFT;
  if (patch.summary !== undefined) draft = { ...draft, summary: edited(draft.summary, patch.summary, ownerEdits) };
  if (patch.roleBullets) draft = patchRole(draft, patch.roleBullets, ownerEdits);
  const coverNote = patch.coverNote === undefined
    ? current.coverNote ?? { text: '', factIds: [] }
    : edited(current.coverNote, patch.coverNote, ownerEdits);
  const answers = patch.answers ? patchAnswers(current.answers, patch.answers, ownerEdits) : current.answers;
  return { draft, coverNote, answers, outreach: current.outreach ?? '', ownerEdits };
}

export type RedraftInput = {
  application: DraftContent & Pick<CareerApplication, 'removed'>;
  patch: DraftPatch;
  profile: CareerProfile;
  requirements: Requirements | null;
  job: TailorJob;
};

export type RedraftResult = Omit<PatchedContent, 'ownerEdits'> & {
  /** What the first truth check removed, plus anything removed now; for the "couldn't be backed up" list. */
  removed: TruthRemoval[];
  /** Owner text kept although the profile can't back it up: show it highlighted. */
  highlights: TruthRemoval[];
};

function mergeRemovals(earlier: TruthRemoval[], now: TruthRemoval[]): TruthRemoval[] {
  const seen = new Set(earlier.map((item) => `${item.where}\n${item.text}`));
  return [...earlier, ...now.filter((item) => !seen.has(`${item.where}\n${item.text}`))];
}

/**
 * Applies the owner's edits and runs the truth check again over the whole
 * draft. Their own words stay; the result says which of them to highlight.
 */
export function redraftText(input: RedraftInput): RedraftResult {
  const patched = patchedContent(input.application, input.patch);
  // Unchanged answers are the profile's and spec's own (notice, salary) or already
  // passed the first check; only the owner's new wording needs checking, for highlights.
  const editedAnswers = patched.answers.filter((item) => patched.ownerEdits.includes(item.answer));
  const checked = checkTailored({
    draft: patched.draft,
    coverNote: patched.coverNote,
    answers: editedAnswers,
    outreach: patched.outreach,
    profile: input.profile,
    ownerEdits: patched.ownerEdits,
    requirements: input.requirements,
    job: input.job,
  });
  return {
    draft: checked.draft,
    coverNote: checked.coverNote,
    // Owner text is never removed, so every answer stands.
    answers: patched.answers,
    outreach: checked.outreach,
    removed: mergeRemovals(input.application.removed, checked.removed),
    highlights: checked.highlights,
  };
}
