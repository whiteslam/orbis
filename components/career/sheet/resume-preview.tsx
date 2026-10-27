import { monthYear } from '@/components/career/format';
import type { CareerFact, CareerProfile, CitedText, TailoredDraft } from '@/lib/career/types';

const squash = (text: string) => text.toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** True when the line says something other than the facts it cites, word for word. */
function reworded(line: CitedText, facts: Map<string, CareerFact>) {
  const own = squash(line.text);
  return !line.factIds.some((id) => {
    const fact = facts.get(id);
    return fact && squash(fact.text) === own;
  });
}

function Bullet({ line, facts }: Readonly<{ line: CitedText; facts: Map<string, CareerFact> }>) {
  const changed = reworded(line, facts);
  const sources = line.factIds.map((id) => facts.get(id)).filter((fact): fact is CareerFact => Boolean(fact));
  return (
    <li className={changed ? 'changed' : undefined}>
      <span>{line.text}</span>
      {changed && sources.length > 0 && (
        <details className="cr-was">
          <summary>Reworded<span className="sr-only"> from your master resume</span></summary>
          <p>Your resume says:</p>
          <ul>{sources.map((fact) => <li key={fact.id}>{fact.text}</li>)}</ul>
        </details>
      )}
    </li>
  );
}

function countLines(draft: TailoredDraft) {
  return [draft.summary, ...draft.roles.flatMap((role) => role.bullets), ...draft.projects.flatMap((project) => project.bullets)];
}

/**
 * The tailored resume as it will read, built from the draft and the profile:
 * names, employers, titles and dates always come from the profile. Each line
 * that differs from the master resume is marked "Reworded", and opens to show
 * the facts it rests on.
 */
export function ResumePreview({ draft, profile }: Readonly<{ draft: TailoredDraft; profile: CareerProfile | null }>) {
  const facts = new Map((profile?.facts ?? []).map((fact) => [fact.id, fact]));
  const roles = new Map((profile?.roles ?? []).map((role) => [role.id, role]));
  const projects = new Map((profile?.projects ?? []).map((project) => [project.id, project]));
  const skillLabel = new Map((profile?.skills ?? []).map((skill) => [skill.name, skill.label]));
  const lines = countLines(draft);
  const changed = lines.filter((line) => reworded(line, facts)).length;

  return (
    <section className="cr-block" aria-labelledby="cr-resume-title">
      <div className="fd-label-row">
        <h2 className="fd-label" id="cr-resume-title">Tailored resume</h2>
        <span className="cr-diff-count"><i aria-hidden="true" />{changed} of {lines.length} lines reworded</span>
      </div>
      <div className="cr-resume">
        {profile && <p className="cr-resume-name">{profile.contact.name}</p>}
        <p className="cr-resume-headline">{draft.headline}</p>
        <ul className="cr-resume-lines"><Bullet line={draft.summary} facts={facts} /></ul>

        <h3>Skills</h3>
        <p className="cr-resume-skills">{draft.skills.map((name) => skillLabel.get(name) ?? name).join(', ')}</p>

        <h3>Experience</h3>
        {draft.roles.map((entry) => {
          const role = roles.get(entry.roleId);
          return (
            <div className="cr-resume-role" key={entry.roleId}>
              {role && (
                <p className="cr-resume-role-head">
                  <span><b>{role.title}</b>, {role.employer}</span>
                  <small>{monthYear(role.start)} – {monthYear(role.end)}</small>
                </p>
              )}
              <ul className="cr-resume-lines">{entry.bullets.map((line) => <Bullet key={line.text} line={line} facts={facts} />)}</ul>
            </div>
          );
        })}

        {draft.projects.length > 0 && <h3>Projects</h3>}
        {draft.projects.map((entry) => (
          <div className="cr-resume-role" key={entry.projectId}>
            <p className="cr-resume-role-head"><b>{projects.get(entry.projectId)?.name ?? 'Project'}</b></p>
            <ul className="cr-resume-lines">{entry.bullets.map((line) => <Bullet key={line.text} line={line} facts={facts} />)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}
