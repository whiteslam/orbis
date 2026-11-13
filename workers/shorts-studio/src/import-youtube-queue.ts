// One-off: moves the old PC publisher's YouTube queue into Orbis.
//   cd workers/shorts-studio && npm run import-youtube-queue            (dry run: prints a plan, writes nothing)
//   cd workers/shorts-studio && npm run import-youtube-queue -- --apply (uploads the files and adds the rows)
// Reads ~/faceless-shorts/publisher/queue.json and published.json. For each queued project that
// has not been published, it takes the newest renders/*.mp4 and renders/cover.jpg, uploads them to
// shorts/<owner>/imported/<project>/ and adds a youtube_queue row from <project>/youtube.json, in
// queue order. Safe to run again: a project whose video_path is already in the queue is skipped.
// The old publisher's file formats are not in this repo, so they are read tolerantly, and an
// entry that cannot be read is listed and left out, never guessed. See docs/ops/youtube-owner-actions.md.

import { createClient } from '@supabase/supabase-js';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDetails } from '../../../lib/youtube/details.ts';
import type { VideoDetails } from '../../../lib/youtube/types.ts';
import { loadConfig } from './config.ts';

const BUCKET = 'shorts';
const PRIVACIES = ['public', 'unlisted', 'private'];
const DEFAULT_CATEGORY = '24';
const PAGE = 1000;

type PlanItem = { project: string; videoPath: string; coverPath: string };
type Planned = PlanItem & { skip: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The folder name of a project, whether the file holds `name` or a full path to it. */
function projectKey(project: string): string {
  return project.trim().split(/[\\/]+/).filter(Boolean).pop() ?? '';
}

/** What goes in the storage path: letters, digits, dot, underscore and dash only, and never a dot-only name. */
function pathSafe(project: string): string {
  const safe = projectKey(project).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return safe || 'project';
}

/** One entry of either file: a project string, or an object with `project`, `dir` or `name`. */
function entryProject(entry: unknown): string | null {
  const value = isRecord(entry) ? [entry.project, entry.dir, entry.name].find((one) => typeof one === 'string' && one.trim()) : entry;
  return typeof value === 'string' && projectKey(value) ? value.trim() : null;
}

function entryList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (isRecord(json)) {
    const list = [json.queue, json.published, json.projects].find(Array.isArray);
    if (list) return list as unknown[];
  }
  throw new Error('expected a list of projects');
}

/** The queue, in order, plus a note for each entry that could not be read. */
export function parseQueueFile(json: unknown): { projects: string[]; unreadable: string[] } {
  const projects: string[] = [];
  const unreadable: string[] = [];
  entryList(json).forEach((entry, index) => {
    const project = entryProject(entry);
    if (project) projects.push(project);
    else unreadable.push(`queue entry #${index + 1} is not a project name`);
  });
  return { projects, unreadable };
}

export function readQueueFile(json: unknown): string[] {
  return parseQueueFile(json).projects;
}

export function readPublished(json: unknown): Set<string> {
  return new Set(parseQueueFile(json).projects);
}

function tagList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === 'string');
  return typeof raw === 'string' ? raw.split(',') : [];
}

/** A project's youtube.json as video details. Throws a short reason when it cannot be right. */
export function readYouTubeJson(json: unknown, fallbackTitle: string): VideoDetails {
  if (!isRecord(json)) throw new Error('youtube.json is not an object');
  const pick = (...keys: string[]) => keys.map((key) => json[key]).find((value) => value !== undefined && value !== null);

  const rawTitle = pick('title');
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : fallbackTitle;

  const rawPrivacy = pick('privacyStatus', 'privacy');
  const privacy = rawPrivacy === undefined ? 'public' : typeof rawPrivacy === 'string' ? rawPrivacy.trim().toLowerCase() : '';
  if (!PRIVACIES.includes(privacy)) throw new Error(`privacy ${JSON.stringify(rawPrivacy)} is not public, unlisted or private`);

  const rawCategory = pick('categoryId', 'category_id');
  const categoryId = rawCategory === undefined ? DEFAULT_CATEGORY : String(rawCategory).trim();
  if (!/^\d{1,3}$/.test(categoryId)) throw new Error(`category ${JSON.stringify(rawCategory)} is not a category number`);

  const kids = pick('madeForKids', 'made_for_kids');
  const description = pick('description');
  const details = cleanDetails({
    title,
    description: typeof description === 'string' ? description : '',
    tags: tagList(pick('tags')),
    categoryId,
    privacy,
    madeForKids: kids === true || kids === 'true',
  });
  if (!details) throw new Error('there is no usable title');
  return details;
}

/** Each queue entry with where it goes, and why it is left out, if it is. */
export function planAll(queue: string[], published: Set<string>, alreadyQueuedPaths: Set<string>, owner: string): Planned[] {
  const publishedKeys = new Set([...published].map(projectKey));
  const taken = new Map<string, string>();
  return queue.map((project) => {
    const folder = pathSafe(project);
    const videoPath = `${owner}/imported/${folder}/video.mp4`;
    const coverPath = `${owner}/imported/${folder}/cover.jpg`;
    const earlier = taken.get(videoPath);
    const skip = publishedKeys.has(projectKey(project)) ? 'published'
      : alreadyQueuedPaths.has(videoPath) ? 'already queued'
      : earlier !== undefined ? `same folder name as ${earlier}`
      : null;
    if (!skip) taken.set(videoPath, project);
    return { project, videoPath, coverPath, skip };
  });
}

/**
 * Whether published.json can be trusted. A published entry that cannot be read, or a published
 * list that names nothing we know (no queued project and no project folder), means the format is
 * probably not what we expect, and a project already live would be queued and posted twice.
 */
export function checkPublished(
  published: { projects: string[]; unreadable: string[] },
  queue: string[],
  folders: string[],
): { notes: string[]; blocking: boolean } {
  const notes = published.unreadable.map((note) => `published.json: ${note.replace('queue entry', 'entry')}`);
  const known = new Set([...queue, ...folders].map(projectKey));
  if (published.projects.length > 0 && !published.projects.some((project) => known.has(projectKey(project)))) {
    notes.push('published.json: none of its names match a queued project or a project folder, so its format is probably not what this script expects');
  }
  return { notes, blocking: notes.length > 0 };
}

/** What to import, in queue order: not published, and not already in the queue by video_path. */
export function planImport(queue: string[], published: Set<string>, alreadyQueuedPaths: Set<string>, owner: string): PlanItem[] {
  return planAll(queue, published, alreadyQueuedPaths, owner)
    .filter((item) => !item.skip)
    .map(({ project, videoPath, coverPath }) => ({ project, videoPath, coverPath }));
}

// ---- Everything below touches files and the database; it is run by hand, not tested. ----

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function newestVideo(rendersDir: string): string | null {
  if (!existsSync(rendersDir)) return null;
  const files = readdirSync(rendersDir)
    .filter((name) => /\.mp4$/i.test(name))
    .map((name) => ({ name, mtime: statSync(join(rendersDir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime || right.name.localeCompare(left.name));
  return files.length ? join(rendersDir, files[0].name) : null;
}

type Ready = PlanItem & { video: string; cover: string | null; details: VideoDetails };

function prepare(item: PlanItem, projectsDir: string): Ready {
  const folder = resolve(projectsDir, item.project);
  if (!existsSync(folder)) throw new Error(`no project folder at ${folder}`);
  const video = newestVideo(join(folder, 'renders'));
  if (!video) throw new Error('no renders/*.mp4');
  const coverFile = join(folder, 'renders', 'cover.jpg');
  const jsonFile = join(folder, 'youtube.json');
  if (!existsSync(jsonFile)) throw new Error('no youtube.json');
  let parsed: unknown;
  try { parsed = readJson(jsonFile); } catch { throw new Error('youtube.json is not valid JSON'); }
  const details = readYouTubeJson(parsed, projectKey(item.project));
  return { ...item, video, cover: existsSync(coverFile) ? coverFile : null, details };
}

const USAGE = `Moves the old PC publisher's YouTube queue into Orbis.

  npm run import-youtube-queue              Dry run: prints the plan, writes nothing.
  npm run import-youtube-queue -- --apply   Uploads the files and adds the queue rows.

Reads <PROJECTS_DIR>/publisher/queue.json and published.json (PROJECTS_DIR is ~/faceless-shorts unless
set in ~/.config/orbis-shorts/.env). Safe to run again.`;

async function main(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  const apply = argv.includes('--apply');
  const unknown = argv.filter((arg) => arg !== '--apply');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}. Use --apply or --help.`);

  const cfg = loadConfig(process.env, (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } });
  const publisherDir = join(cfg.projectsDir, 'publisher');
  const read = (name: string): unknown => {
    const file = join(publisherDir, name);
    if (!existsSync(file)) throw new Error(`${file} does not exist`);
    try { return readJson(file); } catch { throw new Error(`${file} is not valid JSON`); }
  };

  const queueFile = parseQueueFile(read('queue.json'));
  let publishedFile = { projects: [] as string[], unreadable: [] as string[] };
  if (existsSync(join(publisherDir, 'published.json'))) publishedFile = parseQueueFile(read('published.json'));
  else console.log('Note: there is no published.json, so nothing counts as already published.');
  const published = new Set(publishedFile.projects);
  const folders = existsSync(cfg.projectsDir)
    ? readdirSync(cfg.projectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  const publishedCheck = checkPublished(publishedFile, queueFile.projects, folders);

  const db = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  // Page through every row (the API returns at most 1000 at a time).
  const existing: { video_path: string; position: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('youtube_queue').select('video_path,position').eq('user_id', cfg.owner).order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the YouTube queue: ${error.message}`);
    existing.push(...((data ?? []) as { video_path: string; position: number }[]));
    if ((data ?? []).length < PAGE) break;
  }
  const queuedPaths = new Set(existing.map((row) => row.video_path));
  let position = existing.reduce((most, row) => Math.max(most, row.position), 0);

  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written; add --apply to import)'}: ${queueFile.projects.length} project(s) in the old queue.`);
  for (const note of queueFile.unreadable) console.log(`unreadable: ${note}`);
  for (const note of publishedCheck.notes) console.log(`unreadable: ${note}`);

  const ready: Ready[] = [];
  let unreadable = queueFile.unreadable.length + publishedCheck.notes.length;
  for (const item of planAll(queueFile.projects, published, queuedPaths, cfg.owner)) {
    if (item.skip) { console.log(`skip (${item.skip}): ${item.project}`); continue; }
    try {
      const one = prepare(item, cfg.projectsDir);
      ready.push(one);
      console.log(`would upload: ${item.project}: "${one.details.title}" (${one.details.privacy}), ${mb(statSync(one.video).size)}${one.cover ? ' + cover' : ', no cover'} -> ${item.videoPath}`);
    } catch (error) {
      unreadable += 1;
      console.log(`unreadable: ${item.project}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`${ready.length} to import, ${unreadable} unreadable.`);
  if (apply && publishedCheck.blocking) {
    throw new Error('Not importing: published.json could not be fully read (see above), so a project that is already live might be queued and posted twice. Nothing was written. Tell Claude what published.json looks like.');
  }
  if (!apply) { if (publishedCheck.blocking) console.log('--apply will refuse to run until published.json reads cleanly.'); else if (ready.length) console.log('Nothing was written. Run again with --apply to import.'); return; }

  async function put(path: string, file: string, contentType: string) {
    const bytes = readFileSync(file);
    let last = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (!error) return;
      const failure = error as { message?: string; statusCode?: string | number; error?: string };
      // A previous run uploaded it and stopped before the insert: reuse it.
      if (String(failure.statusCode) === '409' || failure.error === 'Duplicate' || /already exists/i.test(failure.message ?? '')) {
        console.log(`  already uploaded, reusing: ${path}`);
        return;
      }
      last = failure.message ?? 'failed';
      if (attempt < 2) await sleep(2000 * 2 ** attempt);
    }
    throw new Error(`Uploading ${path}: ${last}`);
  }

  // One at a time, in queue order. The first failure stops the run, so the order stays right; run it again to carry on.
  let done = 0;
  for (const one of ready) {
    console.log(`uploading: ${one.project}`);
    await put(one.videoPath, one.video, 'video/mp4');
    if (one.cover) await put(one.coverPath, one.cover, 'image/jpeg');
    position += 1;
    const { error } = await db.from('youtube_queue').insert({
      user_id: cfg.owner,
      job_id: null,
      video_path: one.videoPath,
      cover_path: one.cover ? one.coverPath : null,
      title: one.details.title,
      description: one.details.description,
      tags: one.details.tags,
      category_id: one.details.categoryId,
      privacy: one.details.privacy,
      made_for_kids: one.details.madeForKids,
      position,
      status: 'queued',
    });
    if (error) throw new Error(`Adding ${one.project} to the queue: ${error.message}`);
    done += 1;
    console.log(`queued: ${one.project} at position ${position}`);
  }
  console.log(`Imported ${done} project(s).`);
}

// Only when run directly, so the tests can import the pure functions above.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
