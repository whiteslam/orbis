'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { ArrowUpRight, CircleCheck, CircleDashed, GitCommitHorizontal, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { clearSkillTreeAction, importSkillTreeAction } from '@/app/career/actions';
import { CopyButton, NoticeLine } from '@/components/career/bits';
import { useRun } from '@/components/career/use-run';
import { reloadSkillTree, setSkillTreeCache, useSkillTree } from '@/components/career/use-skill-tree';
import {
  SKILL_TREE_FILE_MAX_BYTES, cvLineState, readSkillTreeFile, skillsByBranch, treeSkillsFor,
  type SkillTree, type SkillTreeBranch, type SkillTreeSkill,
} from '@/lib/career/skill-tree';
import type { CareerProfile } from '@/lib/career/types';

/** "6 Nov 2026", in India time like every Career date. */
function shortDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

const plural = (count: number, word: string) => `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`;

/** A branch's colour as a custom property; validateSkillTree only lets a #rrggbb through. */
const branchStyle = (branch: SkillTreeBranch) => ({ '--st-c': branch.color }) as CSSProperties;

/** Every CV line, grouped by branch, strongest first: for pasting into a CV. */
function cvList(tree: SkillTree) {
  return skillsByBranch(tree).map(({ branch, skills }) => `${branch.name}\n${skills.map((skill) => `- ${skill.cv}`).join('\n')}`).join('\n\n');
}

function Pips({ level }: Readonly<{ level: number }>) {
  return (
    <span className="st-pips" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((step) => <i key={step} className={step <= level ? 'on' : undefined} />)}
    </span>
  );
}

const CV_STATE = {
  confirmed: { Icon: CircleCheck, text: 'Confirmed in your profile: tailored resumes use it' },
  waiting: { Icon: CircleDashed, text: 'In your profile, waiting for you to confirm it in Setup' },
  missing: { Icon: CircleDashed, text: 'Not in your profile: upload the tree again to add it' },
} as const;

function SkillDetail({ skill, profile, id }: Readonly<{ skill: SkillTreeSkill; profile: CareerProfile | null; id: string }>) {
  const state = cvLineState(skill, profile);
  const { Icon, text } = CV_STATE[state];
  return (
    <div className="st-detail" id={id}>
      <p className="st-about">{skill.about}</p>
      <div className="st-cv">
        <div className="st-cv-head">
          <span className="fd-label">Line for your CV</span>
          <CopyButton value={skill.cv} label={`the CV line for ${skill.name}`} />
        </div>
        <p>{skill.cv}</p>
        <small className={`st-cv-state ${state}`}><Icon size={13} aria-hidden="true" />{text}</small>
      </div>
      {skill.tools.length > 0 && (
        <ul className="st-tools" aria-label="Tools">
          {skill.tools.map((tool) => <li key={tool}>{tool}</li>)}
        </ul>
      )}
      <p className="st-facts">
        {plural(skill.commits, 'commit')} · {plural(skill.files, 'file')} changed{skill.first ? ` · since ${shortDate(skill.first)}` : ''}
      </p>
      {skill.proof.length > 0 && (
        <>
          <h4 className="fd-label st-proof-title">Newest proof</h4>
          <ol className="st-proof">
            {skill.proof.map((entry) => (
              <li key={entry.hash}>
                <GitCommitHorizontal size={14} aria-hidden="true" />
                <span>
                  {entry.text}
                  <small>{entry.project} · {shortDate(entry.date)} · <code>{entry.hash.slice(0, 7)}</code></small>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function SkillStone({ skill, profile, open, onToggle }: Readonly<{ skill: SkillTreeSkill; profile: CareerProfile | null; open: boolean; onToggle: () => void }>) {
  const detailId = useId();
  const waiting = cvLineState(skill, profile) === 'waiting';
  return (
    <li className={`st-skill${open ? ' open' : ''}`}>
      <button type="button" className="st-stone" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={onToggle}>
        <span className="st-gem" aria-hidden="true">{skill.level}</span>
        <span className="st-name">
          <b>{skill.name}</b>
          <small>
            <Pips level={skill.level} />
            <span>Level {skill.level} of 5 · {plural(skill.commits, 'commit')}</span>
          </small>
        </span>
        {waiting && <span className="st-dot" title="CV line waiting for you"><span className="sr-only">, CV line waiting for you</span></span>}
      </button>
      {open && <SkillDetail skill={skill} profile={profile} id={detailId} />}
    </li>
  );
}

function TreeUpload({ hasTree, onDone }: Readonly<{ hasTree: boolean; onDone: (text: string) => void }>) {
  const inputId = useId();
  const { busy, notice, setNotice, run } = useRun();

  async function upload(file: File) {
    if (file.size > SKILL_TREE_FILE_MAX_BYTES) return setNotice({ text: 'That file is over 5 MB. Choose the tree’s public/data.js.', ok: false });
    let source = '';
    try {
      source = await file.text();
    } catch {
      return setNotice({ text: 'That file couldn’t be read. Choose it again.', ok: false });
    }
    const tree = readSkillTreeFile(source);
    if (!tree) return setNotice({ text: 'That isn’t a skill tree Orbis can read. Choose data.js from the tree’s public folder.', ok: false });
    await run('import', () => importSkillTreeAction(tree), (result) => {
      setSkillTreeCache({ tree: result.tree, profile: result.profile, ready: true });
      const parts = [
        result.added.skills ? plural(result.added.skills, 'skill') : null,
        result.added.facts ? plural(result.added.facts, 'CV line') : null,
      ].filter(Boolean);
      const added = parts.length ? `Added ${parts.join(' and ')} to your profile.` : 'Your profile already had everything in it.';
      const updated = result.added.updated ? ` Updated ${plural(result.added.updated, 'CV line')} you hadn’t confirmed yet.` : '';
      const full = result.skipped ? ` ${result.skipped} didn’t fit: your profile is full.` : '';
      const rescored = result.rescored ? ` Rescored ${plural(result.rescored, 'job')} against it.` : '';
      onDone(`${added}${updated}${full}${rescored}`);
    });
  }

  const working = busy === 'import';
  return (
    <div className="st-upload">
      <label className={`hl-drop cr-drop${working ? ' busy' : ''}`} htmlFor={inputId}>
        {working ? <LoaderCircle className="cr-spin" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
        <strong>{working ? 'Adding your skill tree…' : hasTree ? 'Upload a newer data.js' : 'Upload your skill tree'}</strong>
        <span>The data.js file in your skill tree’s public folder</span>
      </label>
      <input id={inputId} type="file" className="sr-only" accept=".js,.json,text/javascript,application/json" disabled={working} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void upload(file);
      }} />
      <NoticeLine notice={notice} />
    </div>
  );
}

function SetupLink({ onSetup, setupHref, children }: Readonly<{ onSetup?: () => void; setupHref?: string; children: string }>) {
  if (setupHref) return <a className="cr-panel-link" href={setupHref}>{children}<ArrowUpRight size={13} aria-hidden="true" /></a>;
  return <button type="button" className="cr-panel-link" onClick={onSetup}>{children}<ArrowUpRight size={13} aria-hidden="true" /></button>;
}

/**
 * Career → Skills: the owner's skill tree, uploaded from the data.js their PC
 * builds from their commits. Branches of skill stones with levels; a stone
 * opens its CV line (and whether it is confirmed in the profile), the tools
 * and the newest proof commits. Uploading puts the skills and CV lines into
 * the profile, so job matches and tailored resumes use them
 * (lib/career/skill-tree.ts). The same view serves the phone tab and the web
 * panel; the layout is the stylesheet's (career-skills.css).
 */
export function SkillTreeView({ onProfileChanged, onSetup, setupHref }: Readonly<{
  /** After an upload or removal: the home reloads so scores and Setup catch up. */
  onProfileChanged: () => void;
  /** The phone tab's way to Setup… */
  onSetup?: () => void;
  /** …and the panel's. */
  setupHref?: string;
}>) {
  const state = useSkillTree();
  const [branch, setBranch] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { busy, notice, run } = useRun();
  const tree = state?.tree ?? null;
  const profile = state?.profile ?? null;
  const groups = useMemo(() => (tree ? skillsByBranch(tree) : []), [tree]);
  const waiting = tree ? tree.skills.filter((skill) => cvLineState(skill, profile) === 'waiting').length : 0;

  const uploaded = (text: string) => {
    setDone(text);
    onProfileChanged();
  };

  const remove = () => {
    if (!window.confirm('Take the skill tree off Career? The skills and CV lines it added stay in your profile, to keep or delete in Setup.')) return;
    void run('clear', () => clearSkillTreeAction(), () => {
      setSkillTreeCache({ tree: null, profile, ready: true });
      setDone(null);
      onProfileChanged();
      return 'The skill tree is off Career. Your profile kept what it added.';
    });
  };

  if (state === undefined) return <output className="cp-loading st-loading">Loading your skill tree…</output>;
  if (state === null) {
    return (
      <p className="so-problem">Your skill tree couldn’t be loaded. <button type="button" className="fd-link" onClick={reloadSkillTree}>Try again</button></p>
    );
  }
  if (!state.ready) return <p className="so-problem">Skill trees aren’t set up in the database yet. Try again later.</p>;

  if (!tree) {
    return (
      <section className="st-empty fd-focus" aria-labelledby="st-empty-title">
        <h2 id="st-empty-title">Show what your commits prove.</h2>
        <p>
          Upload the data.js your skill tree builds from your commits. Orbis adds its skills and tools to your profile, so jobs that ask for
          them score higher straight away, and turns each skill’s CV line into a fact for you to confirm before it goes into a tailored resume.
        </p>
        <TreeUpload hasTree={false} onDone={uploaded} />
        <p className="fd-hint">Only the skills, CV lines and the newest 10 commits per skill are sent. The rest of the file stays on your computer.</p>
      </section>
    );
  }

  const shown = branch === 'all' ? groups : groups.filter((group) => group.branch.id === branch);
  const { stats } = tree;
  return (
    <div className="st-view">
      <section className="st-summary" aria-label="Your skill tree in numbers">
        <dl>
          <div><dt>Skills</dt><dd>{tree.skills.length}</dd></div>
          <div><dt>Commits</dt><dd>{stats.commits.toLocaleString('en-IN')}</dd></div>
          <div><dt>Active days</dt><dd>{stats.activeDays}</dd></div>
          <div><dt>Projects</dt><dd>{stats.projects.length}</dd></div>
        </dl>
        <p className="st-span">
          {stats.from && stats.to ? `${shortDate(stats.from)} to ${shortDate(stats.to)}` : null}
          {stats.projects.length > 0 && <> · {stats.projects.map((project) => project.name).join(', ')}</>}
          <> · uploaded {shortDate(tree.importedAt)}</>
        </p>
      </section>

      {done && <NoticeLine notice={{ text: done, ok: true }} onDismiss={() => setDone(null)} />}
      <NoticeLine notice={notice} />

      {waiting > 0 && (
        <div className="st-review">
          <p><b>{plural(waiting, 'CV line')} waiting for you.</b> Job matches already count them. Confirm them in Profile and settings, under “Other facts”, so tailored resumes can use them.</p>
          <SetupLink onSetup={onSetup} setupHref={setupHref}>Review in Setup</SetupLink>
        </div>
      )}

      <div className="st-bar">
        <div className="st-filter" role="group" aria-label="Show a branch">
          <button type="button" aria-pressed={branch === 'all'} onClick={() => setBranch('all')}>All</button>
          {groups.map((group) => (
            <button key={group.branch.id} type="button" aria-pressed={branch === group.branch.id} style={branchStyle(group.branch)} onClick={() => setBranch(group.branch.id)}>
              <i aria-hidden="true" />{group.branch.name}
            </button>
          ))}
        </div>
        <CopyButton value={cvList(tree)} label="every CV line" />
      </div>

      <div className="st-branches">
        {shown.map((group) => (
          <section key={group.branch.id} className="st-branch" style={branchStyle(group.branch)} aria-labelledby={`st-b-${group.branch.id}`}>
            <h3 id={`st-b-${group.branch.id}`}><i aria-hidden="true" />{group.branch.name}<small>{plural(group.skills.length, 'skill')}</small></h3>
            <ol className="st-trunk">
              {group.skills.map((skill) => (
                <SkillStone key={skill.id} skill={skill} profile={profile} open={openId === skill.id} onToggle={() => setOpenId((current) => (current === skill.id ? null : skill.id))} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="st-manage" aria-label="Manage the skill tree">
        <TreeUpload hasTree onDone={uploaded} />
        <button type="button" className="fd-link st-remove" onClick={remove} disabled={busy === 'clear'}>
          <Trash2 size={13} aria-hidden="true" />Take the tree off Career
        </button>
      </section>
    </div>
  );
}

/**
 * In a job's sheet: the tree skills this job asks for, with their level and
 * commits, so the owner sees the proof behind a match. Nothing without a tree.
 */
export function SkillTreeProof({ skills }: Readonly<{ skills: readonly string[] }>) {
  const state = useSkillTree();
  const tree = state?.tree;
  const backed = useMemo(() => {
    if (!tree || !skills.length) return [];
    return treeSkillsFor(tree, skills);
  }, [tree, skills]);
  if (!backed.length) return null;
  return (
    <section className="st-jobproof" aria-labelledby="st-jobproof-title">
      <h3 className="fd-label" id="st-jobproof-title">Backed by your skill tree</h3>
      <ul>
        {backed.slice(0, 6).map((skill) => (
          <li key={skill.id}>
            <span className="st-gem small" aria-hidden="true">{skill.level}</span>
            <span>
              <b>{skill.name}</b>
              <small>Level {skill.level} of 5 · {plural(skill.commits, 'commit')}{skill.proof[0] ? ` · latest: ${skill.proof[0].text}` : ''}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

