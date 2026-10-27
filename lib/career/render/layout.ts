/**
 * The resume as a plain model both renderers draw from. Pure.
 *
 * Structure comes from the profile (names, employers, titles, dates, education,
 * contact); only the words inside it come from the tailored draft. That split is
 * what keeps the AI from ever writing an employer or a date onto the page.
 */
import type { CareerProfile, CareerRole, TailoredDraft } from '../types.ts';

export const RESUME_HEADINGS = ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications'] as const;
export type ResumeHeading = (typeof RESUME_HEADINGS)[number];

/** One dated block: a role, a project or a degree. */
export type ResumeEntry = {
  /** Bold first line: the role title, project name or degree. */
  title: string;
  /** Second line: employer and location, institution, or a link. */
  meta: string | null;
  /** Right-aligned beside the title: "Jan 2022 – Present". */
  dates: string | null;
  bullets: string[];
};

export type ResumeSection = {
  heading: ResumeHeading;
  /** Plain lines (summary, skills, certifications). */
  paragraphs: string[];
  entries: ResumeEntry[];
};

export type ResumeDoc = {
  name: string;
  /** "a@b.com | +91 98… | Bengaluru | linkedin.com/in/…" */
  contact: string;
  headline: string | null;
  /** Only sections with something in them, in RESUME_HEADINGS order. */
  sections: ResumeSection[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → "Mar 2024"; 'YYYY' stays as it is; anything else is shown untouched. */
export function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  const index = month ? Number.parseInt(month, 10) - 1 : -1;
  if (!/^\d{4}$/.test(year)) return value;
  return MONTHS[index] ? `${MONTHS[index]} ${year}` : year;
}

export function formatRange(start: string | null, end: string | null): string | null {
  if (!start) return end ? formatMonth(end) : null;
  return `${formatMonth(start)} – ${end ? formatMonth(end) : 'Present'}`;
}

/** Newest first: current roles, then by start date. The ATS check expects this order. */
export function orderedRoles(profile: CareerProfile): CareerRole[] {
  return profile.roles.toSorted((left, right) => {
    const leftEnd = left.end ?? '9999-99';
    const rightEnd = right.end ?? '9999-99';
    if (leftEnd !== rightEnd) return rightEnd.localeCompare(leftEnd);
    return right.start.localeCompare(left.start);
  });
}

const clean = (text: string | null | undefined) => (text ?? '').replaceAll(/\s+/g, ' ').trim();
const joined = (parts: Array<string | null | undefined>, separator: string) => parts.map(clean).filter(Boolean).join(separator);

function contactLine(profile: CareerProfile): string {
  const { email, phone, location, links } = profile.contact;
  return joined([email, phone, location, ...links.map((link) => link.url)], ' | ');
}

/** Profile labels for the draft's skills, in the draft's order; the profile's own list when the draft has none. */
function skillLabels(profile: CareerProfile, draft: TailoredDraft): string[] {
  const byName = new Map(profile.skills.map((skill) => [skill.name, skill.label || skill.name]));
  const chosen = draft.skills.map((name) => byName.get(name)).filter((label): label is string => Boolean(label));
  const labels = chosen.length ? chosen : profile.skills.map((skill) => skill.label || skill.name);
  return [...new Set(labels.map(clean).filter(Boolean))];
}

function experienceEntries(profile: CareerProfile, draft: TailoredDraft): ResumeEntry[] {
  const bulletsByRole = new Map(draft.roles.map((role) => [role.roleId, role.bullets]));
  // Every role appears, bullets or not: hiding employment history would misstate it.
  return orderedRoles(profile).map((role) => ({
    title: clean(role.title),
    meta: joined([role.employer, role.location], ', ') || null,
    dates: formatRange(role.start, role.end),
    bullets: (bulletsByRole.get(role.id) ?? []).map((bullet) => clean(bullet.text)).filter(Boolean),
  }));
}

function projectEntries(profile: CareerProfile, draft: TailoredDraft): ResumeEntry[] {
  const projects = new Map(profile.projects.map((project) => [project.id, project]));
  const entries: ResumeEntry[] = [];
  for (const chosen of draft.projects) {
    const project = projects.get(chosen.projectId);
    if (!project) continue;
    entries.push({
      title: clean(project.name),
      meta: clean(project.url) || null,
      dates: null,
      bullets: chosen.bullets.map((bullet) => clean(bullet.text)).filter(Boolean),
    });
  }
  return entries;
}

function educationEntries(profile: CareerProfile): ResumeEntry[] {
  return profile.education.map((item) => ({
    title: joined([item.degree, item.field], ', '),
    meta: joined([item.institution, item.grade], ', ') || null,
    dates: item.end ? formatMonth(item.end) : null,
    bullets: [],
  }));
}

function certificationLines(profile: CareerProfile): string[] {
  return profile.certifications.map((cert) => {
    const base = joined([cert.name, cert.issuer], ', ');
    return cert.year ? `${base} (${clean(cert.year)})` : base;
  }).filter(Boolean);
}

const section = (heading: ResumeHeading, paragraphs: string[], entries: ResumeEntry[] = []): ResumeSection => ({ heading, paragraphs, entries });

/** The resume for one application: the profile's structure with the draft's words. */
export function resumeSections(profile: CareerProfile, draft: TailoredDraft): ResumeDoc {
  // The truth check may empty the draft's summary or headline; the profile's own stand in.
  const summary = clean(draft.summary.text) || clean(profile.summary);
  const skills = skillLabels(profile, draft);
  const candidates = [
    section('Summary', summary ? [summary] : []),
    section('Skills', skills.length ? [skills.join(', ')] : []),
    section('Experience', [], experienceEntries(profile, draft)),
    section('Projects', [], projectEntries(profile, draft)),
    section('Education', [], educationEntries(profile)),
    section('Certifications', certificationLines(profile)),
  ];
  return {
    name: clean(profile.contact.name),
    contact: contactLine(profile),
    headline: clean(draft.headline) || clean(profile.headline) || null,
    sections: candidates.filter((item) => item.paragraphs.length || item.entries.length),
  };
}
