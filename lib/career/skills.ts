/**
 * Career: skill and title vocabulary. Client-safe and pure.
 *
 * Skills are compared by canonical name, so "ReactJS", "react.js" and "React"
 * are one skill everywhere: profile, requirements, match and tailoring. Titles
 * are compared by token and by synonym group, for the prefilter and role fit.
 */

/**
 * The skill vocabulary: canonical name first, then the spellings people write
 * for it. Canonical names are lowercase and are what gets stored.
 */
export const SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Languages
  javascript: ['js', 'ecmascript', 'es6', 'es2015', 'vanilla js', 'vanilla javascript'],
  typescript: ['ts'],
  python: ['py', 'python3', 'python 3'],
  java: ['core java', 'java 8', 'java 11', 'java 17'],
  kotlin: [],
  swift: ['swiftui'],
  'objective-c': ['objc', 'obj-c'],
  go: ['golang'],
  rust: [],
  c: [],
  'c++': ['cpp', 'cplusplus'],
  'c#': ['csharp', 'c sharp'],
  '.net': ['dotnet', 'asp.net', 'asp.net core', '.net core', 'net core'],
  ruby: [],
  'ruby on rails': ['rails', 'ror'],
  php: [],
  laravel: [],
  scala: [],
  elixir: [],
  dart: [],
  r: [],
  bash: ['shell', 'shell scripting', 'bash scripting'],
  sql: ['structured query language'],
  html: ['html5'],
  css: ['css3'],
  // Frontend
  react: ['react.js', 'reactjs', 'react js', 'react hooks'],
  'react native': ['rn', 'react-native'],
  'next.js': ['nextjs', 'next', 'next js'],
  preact: [],
  remix: [],
  gatsby: ['gatsbyjs'],
  vue: ['vue.js', 'vuejs', 'vue js', 'vue 3'],
  nuxt: ['nuxt.js', 'nuxtjs'],
  angular: ['angularjs', 'angular.js', 'angular 2'],
  svelte: ['sveltekit'],
  jquery: [],
  redux: ['redux toolkit', 'rtk'],
  zustand: [],
  mobx: [],
  graphql: ['gql'],
  apollo: ['apollo graphql', 'apollo client'],
  sass: ['scss'],
  less: [],
  'tailwind css': ['tailwind', 'tailwindcss'],
  bootstrap: [],
  'styled-components': ['styled components'],
  'material ui': ['mui', 'material-ui'],
  webpack: [],
  vite: [],
  babel: [],
  storybook: [],
  'three.js': ['threejs'],
  d3: ['d3.js', 'd3js'],
  webgl: [],
  'responsive design': ['responsive web design', 'mobile-first design'],
  accessibility: ['a11y', 'wcag', 'web accessibility'],
  'web performance': ['performance optimization', 'performance optimisation', 'core web vitals'],
  pwa: ['progressive web apps', 'progressive web app'],
  seo: ['search engine optimization', 'search engine optimisation'],
  'design systems': ['design system'],
  // Testing
  jest: [],
  vitest: [],
  mocha: [],
  cypress: [],
  playwright: [],
  selenium: [],
  'testing library': ['react testing library', 'rtl'],
  'unit testing': ['unit tests'],
  'e2e testing': ['end-to-end testing', 'end to end testing', 'e2e tests'],
  tdd: ['test driven development', 'test-driven development'],
  // Backend
  'node.js': ['node', 'nodejs', 'node js'],
  express: ['express.js', 'expressjs'],
  nestjs: ['nest.js', 'nest'],
  deno: [],
  bun: [],
  django: [],
  flask: [],
  fastapi: [],
  'spring boot': ['spring', 'springboot', 'spring framework'],
  'rest api': ['rest', 'restful', 'restful api', 'restful apis', 'rest apis'],
  grpc: [],
  websockets: ['websocket', 'socket.io'],
  microservices: ['microservice', 'microservices architecture'],
  kafka: ['apache kafka'],
  rabbitmq: [],
  'system design': [],
  'data structures and algorithms': ['dsa', 'data structures', 'algorithms'],
  oauth: ['oauth2', 'oauth 2.0'],
  jwt: [],
  security: ['cybersecurity', 'cyber security', 'application security'],
  // Data stores
  postgresql: ['postgres', 'psql', 'pg', 'postgre sql'],
  mysql: [],
  mariadb: [],
  sqlite: [],
  'sql server': ['mssql', 'ms sql', 'microsoft sql server'],
  oracle: ['oracle db', 'oracle database'],
  mongodb: ['mongo', 'mongo db'],
  redis: [],
  elasticsearch: ['elastic search', 'elastic'],
  cassandra: [],
  dynamodb: ['dynamo db'],
  firebase: ['firestore'],
  supabase: [],
  prisma: [],
  // Cloud and ops
  aws: ['amazon web services'],
  'google cloud': ['gcp', 'google cloud platform'],
  azure: ['microsoft azure'],
  docker: [],
  kubernetes: ['k8s'],
  terraform: [],
  ansible: [],
  'ci/cd': ['cicd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  jenkins: [],
  'github actions': [],
  'gitlab ci': ['gitlab ci/cd'],
  git: ['github', 'gitlab', 'version control'],
  linux: ['unix'],
  nginx: [],
  serverless: ['aws lambda', 'lambda'],
  vercel: [],
  // Data and AI
  'machine learning': ['ml'],
  'deep learning': ['dl'],
  'artificial intelligence': ['ai'],
  nlp: ['natural language processing'],
  llm: ['llms', 'large language models', 'large language model', 'generative ai', 'genai'],
  tensorflow: ['tf'],
  pytorch: ['torch'],
  'scikit-learn': ['sklearn', 'scikit learn'],
  pandas: [],
  numpy: [],
  spark: ['apache spark', 'pyspark'],
  hadoop: [],
  airflow: ['apache airflow'],
  'data analysis': ['data analytics'],
  'data visualization': ['data visualisation', 'dataviz'],
  tableau: [],
  'power bi': ['powerbi'],
  looker: [],
  excel: ['ms excel', 'microsoft excel', 'advanced excel'],
  statistics: [],
  // Mobile
  android: ['android development'],
  ios: ['ios development'],
  flutter: [],
  // Design
  figma: [],
  sketch: [],
  'adobe xd': ['xd'],
  'ui design': ['ui', 'user interface design'],
  'ux design': ['ux', 'user experience', 'user experience design'],
  'ui/ux design': ['ui/ux', 'ux/ui', 'ui ux'],
  // Ways of working and business
  agile: [],
  scrum: [],
  kanban: [],
  jira: [],
  'project management': [],
  'product management': [],
  'stakeholder management': [],
  communication: ['communication skills'],
  leadership: ['team leadership', 'people management'],
  mentoring: ['mentorship'],
  sales: [],
  'b2b sales': [],
  'business development': ['bd'],
  'account management': [],
  'customer success': [],
  marketing: [],
  'digital marketing': [],
  'content marketing': [],
  salesforce: [],
  crm: [],
  hubspot: [],
  'financial modeling': ['financial modelling'],
  accounting: [],
  sap: [],
  recruiting: ['recruitment', 'talent acquisition'],
};

// Near-equivalents: a requirement for one, met by another, earns partial credit.
const RELATED_GROUPS: string[][] = [
  ['react', 'next.js', 'preact', 'remix', 'gatsby'],
  ['react', 'react native'],
  ['vue', 'nuxt'],
  ['javascript', 'typescript'],
  ['postgresql', 'mysql', 'mariadb', 'sql', 'sqlite', 'sql server', 'oracle'],
  ['mongodb', 'dynamodb', 'firebase', 'cassandra'],
  ['aws', 'google cloud', 'azure'],
  ['node.js', 'express', 'nestjs', 'deno', 'bun'],
  ['django', 'flask', 'fastapi'],
  ['jest', 'vitest', 'mocha'],
  ['cypress', 'playwright', 'selenium', 'e2e testing'],
  ['redux', 'zustand', 'mobx'],
  ['css', 'sass', 'less'],
  ['tailwind css', 'bootstrap', 'material ui', 'styled-components'],
  ['vite', 'webpack', 'babel'],
  ['ci/cd', 'github actions', 'gitlab ci', 'jenkins'],
  ['terraform', 'ansible'],
  ['kafka', 'rabbitmq'],
  ['tensorflow', 'pytorch'],
  ['machine learning', 'deep learning', 'scikit-learn'],
  ['nlp', 'llm'],
  ['spark', 'hadoop'],
  ['tableau', 'power bi', 'looker'],
  ['java', 'kotlin'],
  ['c#', '.net'],
  ['swift', 'objective-c', 'ios'],
  ['kotlin', 'android'],
  ['flutter', 'react native'],
  ['figma', 'sketch', 'adobe xd'],
  ['ui design', 'ux design', 'ui/ux design'],
  ['agile', 'scrum', 'kanban'],
  ['graphql', 'apollo', 'rest api'],
  ['salesforce', 'hubspot', 'crm'],
  ['sales', 'b2b sales', 'business development', 'account management'],
  ['marketing', 'digital marketing', 'content marketing', 'seo'],
];

/** Interchangeable title phrases. Kept narrow on purpose: data scientist and ML engineer are different jobs. */
export const TITLE_SYNONYMS: readonly string[][] = [
  ['frontend', 'front-end', 'front end', 'ui engineer', 'ui developer', 'react developer', 'react engineer', 'vue developer', 'angular developer', 'javascript developer', 'javascript engineer'],
  ['backend', 'back-end', 'back end', 'server-side engineer'],
  ['full stack', 'fullstack', 'full-stack'],
  ['software engineer', 'software developer', 'software development engineer', 'sde', 'swe', 'programmer'],
  ['devops', 'dev ops', 'sre', 'site reliability engineer', 'site reliability', 'platform engineer', 'infrastructure engineer'],
  ['data scientist', 'data science'],
  ['ml engineer', 'machine learning engineer', 'ai engineer', 'mlops engineer'],
  ['data engineer', 'big data engineer', 'etl developer'],
  ['data analyst', 'bi analyst', 'business intelligence analyst'],
  ['mobile developer', 'mobile engineer', 'app developer'],
  ['qa engineer', 'quality assurance', 'test engineer', 'sdet', 'qa automation', 'automation tester'],
  ['product manager', 'product owner'],
  ['product designer', 'ux designer', 'ui designer', 'ui/ux designer', 'ux/ui designer'],
  ['engineering manager', 'software engineering manager'],
];

const CANONICAL = new Set(Object.keys(SKILL_ALIASES));
const EXACT = new Map<string, string>();
const COMPACT = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
  for (const spelling of [canonical, ...aliases]) {
    EXACT.set(spelling, canonical);
    COMPACT.set(compactKey(spelling), canonical);
  }
}

/** Spelling-insensitive key: "React JS", "react-js" and "reactjs" collide on purpose. */
function compactKey(text: string) {
  let out = '';
  for (const char of text) {
    if (char !== ' ' && char !== '-' && char !== '_' && char !== '.' && char !== '/') out += char;
  }
  return out;
}

const EDGE_PUNCTUATION = new Set([',', ';', ':', '"', "'", '`', '*', '(', ')', '[', ']', '!', '?']);

function trimPunctuation(text: string) {
  let start = 0;
  let end = text.length;
  while (start < end && EDGE_PUNCTUATION.has(text[start])) start += 1;
  // A trailing dot is punctuation ("React."); a leading one is part of ".NET".
  while (end > start && (EDGE_PUNCTUATION.has(text[end - 1]) || text[end - 1] === '.')) end -= 1;
  return text.slice(start, end);
}

function lookup(text: string): string | null {
  const exact = EXACT.get(text);
  if (exact) return exact;
  const compact = compactKey(text);
  const loose = COMPACT.get(compact);
  if (loose) return loose;
  // Light stemming: "REST APIs", "Microservices".
  if (compact.length > 3 && compact.endsWith('s')) return COMPACT.get(compact.slice(0, -1)) ?? null;
  return null;
}

function isVersion(token: string) {
  if (!token) return false;
  for (const char of token) {
    if ((char < '0' || char > '9') && char !== '.' && char !== 'x') return false;
  }
  return token[0] >= '0' && token[0] <= '9';
}

/** The canonical lowercase name of a skill; unknown skills come back lowercased and tidied. */
export function normaliseSkill(raw: string): string {
  let text = raw.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  // "Java (Spring Boot)" is Java; the parenthetical is detail.
  const paren = text.indexOf('(');
  if (paren > 0) text = text.slice(0, paren).trim();
  text = trimPunctuation(text);
  const found = lookup(text);
  if (found) return found;
  // "Angular 14", "Python 3.11": the version doesn't make a different skill.
  const words = text.split(' ');
  if (words.length > 1 && isVersion(words.at(-1) ?? '')) {
    const base = words.slice(0, -1).join(' ');
    return lookup(base) ?? base;
  }
  return text;
}

/** True when the name is in the built-in vocabulary. */
export function isKnownSkill(name: string): boolean {
  return CANONICAL.has(normaliseSkill(name));
}

export function sameSkill(a: string, b: string): boolean {
  const left = normaliseSkill(a);
  return left !== '' && left === normaliseSkill(b);
}

/** Near-equivalents worth partial credit, canonical, never the skill itself. */
export function relatedSkills(name: string): string[] {
  const skill = normaliseSkill(name);
  const related = new Set<string>();
  for (const group of RELATED_GROUPS) {
    if (!group.includes(skill)) continue;
    for (const other of group) if (other !== skill) related.add(other);
  }
  return [...related];
}

// Words that are skills only in some sentences ("go live", "REST of the team",
// "next quarter"). Scanning prose skips them; an explicit skill list keeps them.
const AMBIGUOUS_IN_PROSE = new Set(['go', 'r', 'c', 'rest', 'express', 'spring', 'swift', 'ai', 'pg', 'ts', 'ml', 'rn', 'bd', 'nest', 'next', 'node', 'elastic', 'lambda', 'shell', 'ui', 'ux', 'xd', 'tf', 'torch', 'dl', 'less', 'sketch', 'sales', 'marketing', 'security', 'statistics', 'communication', 'leadership', 'accounting', 'bootstrap', 'excel', 'bun', 'apollo', 'remix', 'jest', 'spark', 'oracle', 'elixir']);

const PROSE_SEPARATORS = new Set([' ', '\t', '\n', '\r', ',', ';', ':', '(', ')', '[', ']', '{', '}', '!', '?', '"', '|', '&']);

function proseTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const char of text.toLowerCase()) {
    if (PROSE_SEPARATORS.has(char)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens.map(trimPunctuation).filter(Boolean);
}

function isAmbiguous(word: string) {
  return AMBIGUOUS_IN_PROSE.has(word) || (word.endsWith('s') && AMBIGUOUS_IN_PROSE.has(word.slice(0, -1)));
}

/** Known skills a piece of prose names, longest phrase first ("react native" before "react"). */
export function skillsMentioned(text: string): string[] {
  const tokens = proseTokens(text);
  const found = new Set<string>();
  let index = 0;
  while (index < tokens.length) {
    let step = 1;
    for (let size = 3; size >= 1; size -= 1) {
      if (index + size > tokens.length) continue;
      const phrase = tokens.slice(index, index + size).join(' ');
      if (size === 1 && isAmbiguous(phrase)) continue;
      const hit = lookup(phrase);
      if (hit && CANONICAL.has(hit)) {
        found.add(hit);
        step = size;
        break;
      }
    }
    index += step;
  }
  return [...found];
}

// ─── Titles ─────────────────────────────────────────────────────────────

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'with', 'on', 'by', 'as', 'we', 'are', 'our', 'you',
  'remote', 'hybrid', 'onsite', 'wfh', 'contract', 'contractor', 'freelance', 'permanent', 'temporary', 'urgent',
  'hiring', 'immediate', 'joiner', 'job', 'opening', 'role', 'position', 'm', 'f', 'd', 'w', 'x', 'time',
]);

const SENIORITY_WORDS = new Set([
  'senior', 'sr', 'snr', 'junior', 'jr', 'lead', 'principal', 'staff', 'head', 'chief', 'intern', 'internship',
  'trainee', 'fresher', 'graduate', 'associate', 'mid', 'level', 'entry', 'experienced', 'i', 'ii', 'iii', 'iv', 'v',
]);

// Two words that mean one ("front end" is "frontend"), so "end" never matches on its own.
const JOINED_WORDS = new Map([
  ['front end', 'frontend'],
  ['back end', 'backend'],
  ['full stack', 'fullstack'],
  ['dev ops', 'devops'],
]);

const TITLE_KEEP = new Set(['+', '#', '.']);

function isWordChar(char: string) {
  return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || TITLE_KEEP.has(char) || char > '\u007f';
}

/** Lowercase words of a title or phrase, punctuation as spaces, compound words joined. */
export function titleWords(text: string): string[] {
  const raw: string[] = [];
  let current = '';
  for (const char of text.toLowerCase()) {
    if (isWordChar(char)) {
      current += char;
    } else {
      if (current) raw.push(current);
      current = '';
    }
  }
  if (current) raw.push(current);
  const words = raw.map((word) => trimDots(word)).filter(Boolean);
  const joined: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const pair = JOINED_WORDS.get(`${words[index]} ${words[index + 1] ?? ''}`);
    if (pair) {
      joined.push(pair);
      index += 1;
    } else {
      joined.push(words[index]);
    }
  }
  return joined;
}

function trimDots(word: string) {
  let start = 0;
  let end = word.length;
  while (start < end && word[start] === '.') start += 1;
  while (end > start && word[end - 1] === '.') end -= 1;
  return word.slice(start, end);
}

function isNumber(word: string) {
  for (const char of word) if (char < '0' || char > '9') return false;
  return true;
}

/** The words of a title that say what the job is: no stopwords, seniority or numbers. */
export function titleTokens(title: string): string[] {
  const tokens: string[] = [];
  for (const word of titleWords(title)) {
    if (TITLE_STOPWORDS.has(word) || SENIORITY_WORDS.has(word) || isNumber(word)) continue;
    if (!tokens.includes(word)) tokens.push(word);
  }
  return tokens;
}

/**
 * The synonym groups a title belongs to, by whole-phrase containment, so
 * "Sr. Front-End Developer" is in the frontend group. `extra` is the owner's own groups.
 */
export function titleSynonymGroups(title: string, extra: readonly string[][] = []): string[][] {
  const padded = ` ${titleWords(title).join(' ')} `;
  const groups: string[][] = [];
  for (const group of [...TITLE_SYNONYMS, ...extra]) {
    const hit = group.some((phrase) => {
      const words = titleWords(phrase);
      return words.length > 0 && padded.includes(` ${words.join(' ')} `);
    });
    if (hit) groups.push(group);
  }
  return groups;
}
