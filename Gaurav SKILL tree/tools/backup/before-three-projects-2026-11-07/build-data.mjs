// Turns the exported commit records in tools/source into public/data.js.
// Every level on the tree is calculated here from real commits. Nothing is hand-scored.
// Stones name abilities a recruiter recognises. Tools are listed inside each ability, and project
// features are only ever proof.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.SKILLTREE_SOURCE || join(root, 'tools/source');
const PUBLIC = process.env.SKILLTREE_PUBLIC || join(root, 'public');
const read = (f) => (existsSync(join(SOURCE, f)) ? readFileSync(join(SOURCE, f), 'utf8').split(/\r?\n/).filter(Boolean) : []);

// One commit swept in 2,564 files, most of them other people's code. It never counts as evidence.
const BULK = 'c23d0fff';

const commits = read('commits.txt').map((line, i) => {
  const [h, d, ...rest] = line.split('|');
  return { n: i + 1, h, d, s: rest.join('|') };
});
const merges = read('merges.txt').map((line) => {
  const [h, d, ...rest] = line.split('|');
  return { h, d, s: rest.join('|') };
});

const filesOf = {};
let current = null;
for (const line of read('commit-files.txt')) {
  if (line.startsWith('@')) { current = line.slice(1); filesOf[current] = []; continue; }
  if (line.startsWith('.agents') || line.startsWith('skills-lock')) continue;
  filesOf[current].push(line.replace(/^command-hq\//, ''));
}
const claude = new Set(read('coauthored-claude.txt'));

// Client names and email addresses never reach the page, even though it is private.
const scrub = (s) => s
  .replace(/\s*\((?:Gaurav|gaurav|owner)[^)]*\)/g, '')
  .replace(/\bEssex Heating\b/g, 'a client')
  .replace(/\bAirficiency\b/g, 'a client')
  .replace(/\bTest Company Inc\b/g, 'the test client')
  .replace(/\bGRV\b/g, 'test')
  .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[email]');

const shorten = (s) => {
  const clean = scrub(s).trim();
  const sentence = clean.match(/^(.{28,130}?[.;])\s/);
  if (sentence) return sentence[1].replace(/[.;]$/, '');
  return clean.length > 130 ? `${clean.slice(0, 127).trimEnd()}...` : clean;
};

// A commit touching over 1,000 files is treated as a sweep of other people's work, like the one above.
const usable = commits.filter((c) => c.h !== BULK && (filesOf[c.h] || []).length <= 1000);
const usableHashes = new Set(usable.map((c) => c.h));
const baseline = read('baseline-order.txt').map((l) => l.split('|')[0]);
const baselineHashes = new Set(baseline);
const byHash = Object.fromEntries(commits.map((c) => [c.h, c]));
const lines = (...ns) => ns.map((n) => {
  const c = byHash[baseline[n - 1]];
  if (!c) throw new Error(`No commit on line ${n}`);
  if (c.h === BULK) throw new Error(`Line ${n} is the bulk commit`);
  return c;
});
const files = (re) => usable.filter((c) => (filesOf[c.h] || []).some((f) => re.test(f)));
const subject = (re) => usable.filter((c) => re.test(c.s));
// Commits whose actual code changes matched a search for this skill, saved in tools/source/evidence.
const scan = (name) => read(`evidence/${name}.txt`).filter((h) => usableHashes.has(h)).map((h) => byHash[h]);

const BRANCHES = [
  { id: 'databases', name: 'Database Engineering', label: 'Database\nEngineering', color: '#7FE8D6', icon: 'db', x: 330, y: 760 },
  { id: 'frontend', name: 'Frontend Engineering', label: 'Frontend\nEngineering', color: '#FFCB6B', icon: 'layout', x: 590, y: 470 },
  { id: 'backend', name: 'Backend Engineering', label: 'Backend\nEngineering', color: '#93BCFF', icon: 'cube', x: 875, y: 520 },
  { id: 'ai', name: 'AI Engineering', label: 'AI\nEngineering', color: '#DDB0FF', icon: 'spark', x: 1140, y: 520 },
  { id: 'quality', name: 'Security and Quality', label: 'Security\nand Quality', color: '#FFA6B2', icon: 'shield', x: 1430, y: 470 },
  { id: 'practices', name: 'Software Engineering', label: 'Software\nEngineering', color: '#BDEB8A', icon: 'flag', x: 1670, y: 760 },
];

// Places on the tree. A skill's oldest commit decides its place: the older the skill, the closer to
// the trunk, so the replay always grows outward and nothing lights up before the limb carrying it.
// Each place is [x, y, index of the earlier place it grows from, or null for the branch itself].
const PLACES = {
  databases: [[440, 620, null], [280, 560, null], [140, 680, null], [120, 850, null], [180, 980, null], [470, 900, null]],
  frontend: [[420, 430, null], [560, 300, null], [700, 322, null], [665, 180, null], [270, 340, 0], [430, 180, 1], [300, 190, 4], [560, 110, 1]],
  backend: [[800, 380, null], [950, 380, null], [800, 240, 0], [950, 240, 1], [800, 95, 2], [950, 95, 3]],
  ai: [[1050, 350, null], [1215, 365, null], [1135, 205, null]],
  quality: [[1310, 340, null], [1440, 318, null], [1585, 350, null], [1360, 165, 0], [1520, 165, 1]],
  practices: [[1570, 610, null], [1730, 570, null], [1870, 680, null], [1885, 845, null], [1740, 950, null], [1550, 890, null]],
};

// How new commits count towards skills whose existing proof was picked by hand.
const code = (re) => (c) => (filesOf[c.h] || []).some((f) => re.test(f));
const said = (re) => (c) => re.test(c.s);
const AUTO = {
  designsystems: code(/^components\/ui\//),
  designtocode: (c) => said(/\b(design|redesign)/i)(c) && code(/\.tsx$/)(c),
  crossdevice: said(/\b(phone|mobile|tablet|ipad|responsive)\b/i),
  interactive: said(/\b(drag|drop|preview|pop-?up)\b/i),
  richtext: said(/\b(editor|rich text|tiptap)\b/i),
  businesslogic: code(/^lib\/(board|tasks|customer|clients|leave|team|plan)\/.*\.ts$/),
  integration: said(/\b(integrat|import from|webhook|third.party)/i),
  scheduling: code(/^app\/api\/cron\//),
  prompts: code(/(prompts?\.ts|\/knowledge\/)/i),
  debugging: said(/\b(fix|fixes|fixed|bug|bugs|error|errors)\b/i),
  performance: said(/\b(speed|faster|slow|performance)\b/i),
  appsec: code(/(vault|crypto|twoFactor|two-factor|password)/i),
  authz: said(/\b(permission|access control|two-step|two-factor|sign-in|login)\b/i),
  techdocs: code(/^docs\/.*(spec|plan|design).*\.md$/i),
  compat: said(/\b(untouched|backward|older code|older schema|old code)\b/i),
  datamigration: code(/^scripts\/.*\.mjs$/),
};

// Skills not earned yet. These never show until at least two of Gaurav's commits prove them, and
// each has its own fixed place, so a new unlock never shuffles the stones already on the tree.
const LATER = [
  { id: 'cicd', branch: 'practices', x: 1550, y: 890, name: 'CI/CD Pipelines', label: 'CI/CD\nPipelines', icon: 'route',
    tools: ['GitHub Actions'], evidence: files(/^\.github\/workflows\//),
    about: 'Automatically testing and releasing code every time it changes.',
    cv: 'Built automated pipelines that test and release code on every change.' },
  { id: 'containers', branch: 'practices', x: 1465, y: 985, name: 'Containerization', label: 'Containerization', icon: 'box',
    tools: ['Docker'], evidence: files(/(^|\/)(Dockerfile|docker-compose[^/]*)$/i),
    about: 'Packaging an app so it runs the same on any machine.',
    cv: 'Packaged applications into containers so they run the same in every environment.' },
  { id: 'e2e', branch: 'quality', x: 1690, y: 235, name: 'End-to-End Testing', label: 'End-to-End\nTesting', icon: 'hand',
    tools: ['Playwright'], evidence: files(/(^e2e\/|\.spec\.tsx?$)/),
    about: 'Automatically clicking through an app the way a person would, to check that it all works together.',
    cv: 'Wrote end-to-end browser tests covering complete user journeys.' },
  { id: 'payments', branch: 'backend', x: 700, y: 55, name: 'Payment Integration', label: 'Payment\nIntegration', icon: 'card',
    tools: ['Stripe'], evidence: scan('payments'),
    about: 'Taking payments inside an app through a service such as Stripe.',
    cv: 'Integrated payment processing into a production application.' },
  { id: 'email', branch: 'backend', x: 1060, y: 60, name: 'Transactional Email', label: 'Transactional\nEmail', icon: 'chat',
    tools: ['Email delivery services'], evidence: scan('email'),
    about: 'Emails an app sends by itself, such as alerts and confirmations.',
    cv: 'Built automated emails that an application sends in response to user activity.' },
  { id: 'realtime', branch: 'frontend', x: 560, y: 110, name: 'Real-Time Features', label: 'Real-Time\nFeatures', icon: 'bolt',
    tools: ['Supabase Realtime'], evidence: scan('realtime'),
    about: 'Screens that update by themselves the moment something changes.',
    cv: 'Built real-time features that update screens the moment data changes.' },
  { id: 'i18n', branch: 'frontend', x: 130, y: 440, name: 'Internationalization', label: 'Internationalization', icon: 'globe',
    tools: ['Multi-language routing'], evidence: scan('i18n'),
    about: 'Showing one app in several languages.',
    cv: 'Added multi-language support to a production web application.' },
];

// A commit that changed both the screens and the server or database side of the same work.
const fullStack = usable.filter((c) => {
  const fs = filesOf[c.h] || [];
  return fs.some((f) => /^(components|app)\/.*\.tsx$/.test(f)) && fs.some((f) => /^(lib\/db\/|lib\/actions\/|supabase\/migrations\/|app\/.*api\/)/.test(f));
});

const SKILLS = [
  // Frontend Engineering
  { id: 'frontendarch', branch: 'frontend', name: 'Frontend Architecture', label: 'Frontend\nArchitecture', icon: 'blocks',
    tools: ['Next.js (App Router)', 'React', 'TypeScript'],
    evidence: files(/^app\/.*(page|layout)\.tsx$/),
    about: 'Deciding how the pages, layouts and building blocks of a large web app fit together.',
    cv: 'Structured pages, layouts and shared navigation for a production web app serving separate client and staff areas.' },
  { id: 'ssr', branch: 'frontend', name: 'Server-Side Rendering', label: 'Server-Side\nRendering', icon: 'route',
    tools: ['Next.js (App Router)', 'React Server Components'],
    evidence: scan('ssr'),
    about: 'Preparing a page on the server with its real data, so it arrives ready to read.',
    cv: 'Built server-rendered pages that load their data on the server before reaching the browser.' },
  { id: 'designsystems', branch: 'frontend', name: 'Design Systems', label: 'Design\nSystems', icon: 'check',
    tools: ['React', 'Tailwind CSS'],
    evidence: lines(100, 97, 96, 95, 92, 107, 118),
    about: 'One shared set of buttons, cards and colours, so every screen looks and behaves the same.',
    cv: 'Replaced duplicated buttons, links and hard-coded colours with shared components and design tokens.' },
  { id: 'designtocode', branch: 'frontend', name: 'Design-to-Code Implementation', label: 'Design-to-Code\nImplementation', icon: 'pen',
    tools: ['React', 'Tailwind CSS'],
    evidence: lines(108, 106, 105, 104, 103, 102, 101, 99, 98, 94, 93, 91, 90, 89, 88, 87, 86, 85, 146, 84, 75),
    about: 'Turning a designer\'s files into working screens that match them closely.',
    cv: 'Rebuilt a staff hub from a designer\'s files into production screens, matching layout, spacing and components.' },
  { id: 'crossdevice', branch: 'frontend', name: 'Cross-Device UI Engineering', label: 'Cross-Device UI\nEngineering', icon: 'phone',
    tools: ['Tailwind CSS', 'CSS media queries'],
    evidence: [...scan('tailwind-responsive'), ...scan('css-media'), ...lines(2, 19, 42, 43, 73, 109)],
    about: 'Making one app work properly on phones, tablets and desktops.',
    cv: 'Made a production web app work across phones, tablets and desktops, including swipe-between-columns boards.' },
  { id: 'interactive', branch: 'frontend', name: 'Interactive UI Development', label: 'Interactive UI\nDevelopment', icon: 'hand',
    tools: ['React', 'HTML5 Drag and Drop'],
    evidence: [...scan('dragdrop'), ...lines(23, 24, 25, 71, 58, 11, 12)],
    about: 'Screens that respond directly to people, such as dragging files onto a form and previewing them.',
    cv: 'Built drag-and-drop file uploads, upload previews and read-only preview pop-ups across client and staff screens.' },
  { id: 'richtext', branch: 'frontend', name: 'Rich Content Editing', label: 'Rich Content\nEditing', icon: 'book',
    tools: ['Tiptap'],
    evidence: [...scan('tiptap'), ...lines(116, 117, 120, 121, 125)],
    about: 'Word-style writing and formatting inside a web page.',
    cv: 'Built rich document editing with named document tabs and one shared editor across teams.' },

  // Backend Engineering
  { id: 'apidesign', branch: 'backend', name: 'API Design and Development', label: 'API Design and\nDevelopment', icon: 'plug',
    tools: ['Next.js Route Handlers', 'REST', 'TypeScript'],
    evidence: files(/^app\/.*api\/.*route\.ts$/),
    about: 'Designing and building the server addresses that screens and other systems call.',
    cv: 'Built and maintained REST-style API routes for a production application.' },
  { id: 'businesslogic', branch: 'backend', name: 'Business Logic Implementation', label: 'Business Logic\nImplementation', icon: 'scale',
    tools: ['TypeScript', 'Next.js Server Actions'],
    evidence: [...scan('server-actions'), ...lines(56, 55, 54, 50, 44, 35, 16, 149, 148, 111)],
    about: 'Turning company rules into code, such as when a client\'s monthly content unlocks.',
    cv: 'Turned business rules, such as when a client\'s monthly content unlocks, into small, separately tested functions.' },
  { id: 'integration', branch: 'backend', name: 'Third-Party Integration', label: 'Third-Party\nIntegration', icon: 'link',
    tools: ['Google Docs'],
    evidence: [...scan('google-api'), ...lines(140, 139, 138, 137, 135, 134, 133, 132, 131, 130, 129, 127, 126)],
    about: 'Connecting an app to outside services, here importing documents from Google Docs.',
    cv: 'Built a Google Docs import that follows linked documents recursively and files the result in a document library.' },
  { id: 'scheduling', branch: 'backend', name: 'Task Scheduling', label: 'Task\nScheduling', icon: 'clock',
    tools: ['Cron jobs'],
    evidence: [...files(/^app\/api\/cron\//), ...lines(55)],
    about: 'Work a server does by itself on a timer.',
    cv: 'Added scheduled server jobs, including an automatic purge of deleted documents and client phase updates.' },
  { id: 'validation', branch: 'backend', name: 'Data Validation', label: 'Data\nValidation', icon: 'list',
    tools: ['Zod'],
    evidence: scan('zod'),
    about: 'Checking that information has the expected shape before the app trusts it.',
    cv: 'Validated structured responses from AI models against schemas before using them in the app.' },
  { id: 'automation', branch: 'backend', name: 'Scripting and Automation', label: 'Scripting and\nAutomation', icon: 'terminal',
    tools: ['Node.js', 'JavaScript'],
    evidence: files(/^scripts\/.*\.mjs$/),
    about: 'Small programs that do repetitive or risky jobs reliably.',
    cv: 'Wrote scripts to create templates, update stored data and reset test environments.' },

  // Database Engineering
  { id: 'dbdesign', branch: 'databases', name: 'Database Design', label: 'Database\nDesign', icon: 'db',
    tools: ['PostgreSQL', 'SQL'],
    evidence: files(/\.sql$/),
    about: 'Deciding how information is organised in a database so it stays correct and easy to use.',
    cv: 'Designed tables, constraints and database functions for a production PostgreSQL database.' },
  { id: 'dataaccess', branch: 'databases', name: 'Data Access Layer Development', label: 'Data Access\nLayer', icon: 'cube',
    tools: ['Supabase', 'TypeScript'],
    evidence: scan('supabase'),
    about: 'The part of an app that reads and saves information in the database.',
    cv: 'Built the code that reads and writes application data, keeping database access in shared modules.' },
  { id: 'schemamigrations', branch: 'databases', name: 'Schema Migration Management', label: 'Schema Migration\nManagement', icon: 'route',
    tools: ['Supabase migrations', 'SQL'],
    evidence: files(/^supabase\/migrations\/|^MIGRATIONS-TO-RUN/),
    about: 'Controlled, written-down changes to a live database\'s structure.',
    cv: 'Wrote and documented schema migrations for a live database, keeping them safe for older running code.' },
  { id: 'dbsecurity', branch: 'databases', name: 'Database Access Control', label: 'Database\nAccess Control', icon: 'key',
    tools: ['PostgreSQL Row-Level Security'],
    evidence: scan('rls'),
    about: 'Database rules that decide which records each signed-in person can see.',
    cv: 'Protected sensitive tables with row-level security policies at the database layer.' },
  { id: 'indexing', branch: 'databases', name: 'Database Indexing', label: 'Database\nIndexing', icon: 'list',
    tools: ['PostgreSQL'],
    evidence: scan('sql-index'),
    about: 'Adding lookups to a database so that searches stay fast as it grows.',
    cv: 'Added indexes for common lookups on new and existing tables.' },
  { id: 'datamigration', branch: 'databases', name: 'Data Migration', label: 'Data\nMigration', icon: 'map',
    tools: ['Node.js', 'SQL'],
    evidence: [...files(/^scripts\/.*\.mjs$/), ...lines(14, 10, 8)],
    about: 'Safely changing or moving stored information, with a practice run first.',
    cv: 'Wrote data migration scripts with dry runs, proving unrelated records stayed unchanged before applying them.' },

  // AI Engineering
  { id: 'aiintegration', branch: 'ai', name: 'AI Product Integration', label: 'AI Product\nIntegration', icon: 'robot',
    tools: ['Vercel AI SDK', 'LLMs', 'Zod'],
    evidence: [...scan('ai-sdk'), ...files(/^(lib\/ai|lib\/ava|components\/ai)\//)],
    about: 'Building AI models into a real product that people use.',
    cv: 'Integrated AI model features into a production app, including work on an in-app AI assistant.' },
  { id: 'prompts', branch: 'ai', name: 'Prompt Engineering', label: 'Prompt\nEngineering', icon: 'quote',
    tools: ['LLMs'],
    evidence: lines(136, 135, 127, 34, 33),
    about: 'Writing the instructions an AI follows, so it gives reliable results.',
    cv: 'Wrote and refined instructions for an AI assistant and a prompt for merging documents.' },
  { id: 'aidev', branch: 'ai', name: 'AI-Assisted Software Development', label: 'AI-Assisted\nSoftware\nDevelopment', icon: 'chip',
    tools: ['Claude Code', 'Cursor'],
    evidence: usable.filter((c) => claude.has(c.h)),
    about: 'Directing AI coding tools to build real features, then testing what comes back. These are the commits that list Claude as co-author.',
    cv: 'Shipped production features with AI coding agents, working from written specs and automated tests.' },

  // Security and Quality
  { id: 'authz', branch: 'quality', name: 'Authentication and Authorization', label: 'Authentication\nand Authorization', icon: 'lock',
    tools: ['Role-based access control', 'Two-factor authentication', 'Supabase'],
    evidence: [...scan('rbac'), ...scan('totp'), ...lines(124, 111, 110, 70, 42, 150)],
    about: 'Confirming who someone is, then deciding what they are allowed to see and do.',
    cv: 'Built access controls by person, role, department and job tag, with two-factor checks on sensitive actions.' },
  { id: 'testautomation', branch: 'quality', name: 'Test Automation', label: 'Test\nAutomation', icon: 'flask',
    tools: ['Vitest'],
    evidence: files(/^tests\//),
    about: 'Small programs that automatically check the app still behaves correctly.',
    cv: 'Wrote and maintained automated tests, including mocks, across a large production codebase.' },
  { id: 'debugging', branch: 'quality', name: 'Debugging and Root Cause Analysis', label: 'Debugging and\nRoot Cause\nAnalysis', icon: 'bug',
    tools: ['React', 'Next.js'],
    evidence: lines(65, 123, 132, 137, 52, 79, 70, 35, 44, 29, 38),
    about: 'Finding why something is wrong and fixing the cause.',
    cv: 'Diagnosed and fixed production bugs, including hydration errors and data that disagreed between screens.' },
  { id: 'performance', branch: 'quality', name: 'Web Performance Optimization', label: 'Web Performance\nOptimization', icon: 'mountain',
    tools: ['Lazy loading', 'Parallel data loading'],
    evidence: [...lines(20, 57), ...scan('lazy')],
    about: 'Making slow pages quicker.',
    cv: 'Sped up data-heavy screens with parallel data loading, lazy-loaded images and paused background checks.' },
  { id: 'appsec', branch: 'quality', name: 'Application Security', label: 'Application\nSecurity', icon: 'shield',
    tools: ['Encryption at rest', 'Audit logging'],
    evidence: [...scan('crypto'), ...lines(41, 28)],
    about: 'Protecting an app and its data, here with encrypted stored passwords, attempt limits and a log of who viewed what.',
    cv: 'Secured stored client logins with encryption at rest, attempt lockouts and an access audit log.' },

  // Software Engineering
  { id: 'fullstack', branch: 'practices', name: 'Full-Stack Web Development', label: 'Full-Stack Web\nDevelopment', icon: 'blocks',
    tools: ['Next.js', 'React', 'TypeScript', 'Supabase', 'PostgreSQL'],
    evidence: fullStack,
    about: 'Building a feature from end to end: the screens, the server and the database. These are the commits that changed both sides.',
    cv: 'Delivered features end to end across the interface, server and database in a production web application.' },
  { id: 'versioncontrol', branch: 'practices', name: 'Version Control and Team Workflow', label: 'Version Control and\nTeam Workflow', icon: 'branch',
    tools: ['Git', 'GitHub'],
    evidence: merges,
    about: 'Tracking every code change and working alongside other developers without overwriting each other.',
    cv: 'Worked in a shared repository with several developers, using personal branches and regular merges.' },
  { id: 'techdocs', branch: 'practices', name: 'Technical Design Documentation', label: 'Technical Design\nDocumentation', icon: 'map',
    tools: ['Design specs', 'Implementation plans'],
    evidence: lines(140, 139, 108, 147),
    about: 'Writing down the design and the steps before building anything.',
    cv: 'Wrote design specs and implementation plans before building larger features.' },
  { id: 'compat', branch: 'practices', name: 'Backward-Compatible Releases', label: 'Backward-Compatible\nReleases', icon: 'scale',
    tools: ['Staged rollouts', 'Versioned templates'],
    evidence: lines(56, 44, 48, 14, 10, 8),
    about: 'Shipping new work so that older versions and existing customers keep working.',
    cv: 'Shipped changes to a database shared with an older live version, keeping existing clients and older code working.' },
  { id: 'requirements', branch: 'practices', name: 'Requirements Analysis', label: 'Requirements\nAnalysis', icon: 'chat',
    tools: ['Direct stakeholder feedback'],
    evidence: subject(/\bowner\b/i),
    about: 'Understanding what a business needs and turning it into clear, finished work.',
    cv: 'Worked directly with the company owner, turning requests and feedback into shipped product changes.' },
];

// Level comes from how much evidence backs a skill: commits, plus a bonus of one point per 20 files
// changed, capped at the number of commits so one wide rename cannot inflate a skill.
const levelOf = (score) => (score >= 25 ? 5 : score >= 12 ? 4 : score >= 6 ? 3 : score >= 3 ? 2 : 1);

const uniqueCount = (list) => new Set(list.map((c) => c.h)).size;
const earned = LATER.filter((s) => uniqueCount(s.evidence) >= 2);
const nodes = [];
for (const skill of [...SKILLS, ...earned]) {
  const seen = new Map();
  for (const c of skill.evidence) seen.set(c.h, c);
  if (AUTO[skill.id]) for (const c of usable) if (!baselineHashes.has(c.h) && AUTO[skill.id](c)) seen.set(c.h, c);
  const list = [...seen.values()].sort((a, b) => (a.d < b.d ? 1 : -1));
  if (!list.length) throw new Error(`${skill.name} has no proof, so it cannot go on the tree`);
  const touched = new Set(list.flatMap((c) => filesOf[c.h] || []));
  const score = list.length + Math.min(touched.size / 20, list.length);
  nodes.push({
    ...skill,
    kind: 'skill',
    level: levelOf(score),
    commits: list.length,
    files: touched.size,
    first: list.map((c) => c.d).sort()[0],
    evidence: list.map((c) => ({ h: c.h, d: c.d, s: shorten(c.s) })),
  });
}

const FROZEN = existsSync(join(SOURCE, 'places.json')) ? JSON.parse(readFileSync(join(SOURCE, 'places.json'), 'utf8')) : {};
const SKILL_OF = Object.fromEntries(LATER.map((s) => [s.id, s]));
for (const b of BRANCHES) {
  const fixed = nodes.filter((n) => n.branch === b.id && earned.includes(SKILL_OF[n.id]));
  fixed.forEach((n) => { n.parent = b.id; });
  const kids = nodes.filter((n) => n.branch === b.id && !fixed.includes(n)).sort((x, y) => (x.first < y.first ? -1 : x.first > y.first ? 1 : y.commits - x.commits));
  const places = PLACES[b.id];
  if (kids.length > places.length) throw new Error(`${b.name} has more skills than places`);
  kids.forEach((n, i) => {
    const [x, y, from] = places[i];
    n.x = x; n.y = y;
    n.parent = from === null ? b.id : kids[from].id;
    // Stones already on the tree keep their place for good, whatever new work comes in.
    const kept = FROZEN[n.id];
    if (kept) { n.x = kept.x; n.y = kept.y; n.parent = kept.parent; }
  });
  nodes.push({
    id: b.id, branch: b.id, parent: 'root', x: b.x, y: b.y, name: b.name, label: b.label, icon: b.icon,
    kind: 'hub', first: [...kids, ...fixed].map((k) => k.first).sort()[0], level: 0, commits: 0, files: 0, evidence: [],
  });
}

const dates = commits.map((c) => c.d).sort();
const allFiles = new Set(usable.flatMap((c) => filesOf[c.h] || []));
const count = (re) => [...allFiles].filter((f) => re.test(f)).length;

const data = {
  version: createHash('sha1').update(JSON.stringify(nodes.map((n) => [n.id, n.level, n.commits, n.files]))).update(`${commits.length}/${merges.length}`).digest('hex').slice(0, 12),
  branches: BRANCHES.map(({ id, name, color }) => ({ id, name, color })),
  nodes,
  timeline: [...commits, ...merges].map((c) => c.d).sort(),
  stats: {
    commits: commits.length,
    merges: merges.length,
    activeDays: new Set(commits.map((c) => c.d)).size,
    from: dates[0],
    to: dates[dates.length - 1],
    files: allFiles.size,
    testFiles: count(/^tests\//),
    sqlFiles: count(/\.sql$/),
    apiRoutes: count(/^app\/.*api\/.*route\.ts$/),
    scripts: count(/^scripts\/.*\.mjs$/),
    claude: claude.size,
    skills: nodes.filter((n) => n.kind === 'skill').length,
    unlocked: nodes.filter((n) => n.kind === 'skill').length,
  },
};

writeFileSync(join(PUBLIC, 'data.js'), `window.TREE = ${JSON.stringify(data)};\n`);

console.log('skill                             lvl commits files first      grows from');
for (const b of BRANCHES) {
  console.log(`-- ${b.name}`);
  for (const n of nodes.filter((x) => x.kind === 'skill' && x.branch === b.id)) {
    console.log(`${n.name.padEnd(33)} ${n.level}   ${String(n.commits).padEnd(7)} ${String(n.files).padEnd(5)} ${n.first} ${n.parent}`);
  }
}
const lookup = Object.fromEntries(nodes.map((n) => [n.id, n]));
for (const n of nodes) {
  const p = lookup[n.parent];
  if (p && n.first < p.first) console.log(`ORDER PROBLEM: ${n.name} (${n.first}) is older than its parent ${p.name} (${p.first})`);
}
console.log('\ntotal skills', data.stats.skills);
