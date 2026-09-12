/**
 * Skill alias dictionary. Owner: Person A.
 *
 * WHY THIS EXISTS
 * A candidate writes "Express". The JD says "Node.js". Lexical (BM25) matching
 * sees two unrelated tokens and scores zero, burying a strong candidate.
 *
 * expandAliases() APPENDS canonical terms to the normalized text rather than
 * replacing anything, so the candidate's original wording survives untouched for
 * quoting in explanations, while the search index gains the terms the JD uses.
 *
 * Adding entries here is the cheapest way to improve lexical recall. When a real
 * resume at 2pm uses a term we miss, add it here first.
 */

/** canonical term -> phrases that imply it */
const ALIASES = {
  'node.js': ['node', 'nodejs', 'node js', 'express', 'expressjs', 'express.js', 'nestjs', 'nest.js',
    'fastify', 'koa', 'server-side javascript', 'server side javascript', 'backend javascript'],
  react: ['reactjs', 'react.js', 'react js', 'jsx', 'react hooks', 'usestate', 'useeffect',
    'redux', 'next.js', 'nextjs', 'component-based ui', 'single page application', 'spa'],
  mongodb: ['mongo', 'mongoose', 'mongo db', 'nosql', 'document database'],
  sql: ['postgres', 'postgresql', 'mysql', 'sqlite', 'mariadb', 'relational database', 'rdbms',
    'joins', 'stored procedure'],
  database: ['mongodb', 'mongo', 'sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'supabase',
    'firebase', 'dynamodb', 'redis', 'persistence', 'schema design'],
  'rest api': ['rest', 'restful', 'rest apis', 'api endpoint', 'endpoints', 'crud', 'http api',
    'graphql', 'json api', 'web services'],
  git: ['github', 'gitlab', 'bitbucket', 'version control', 'pull request', 'pull requests',
    'merge request', 'branching', 'code review'],
  javascript: ['js', 'es6', 'es2015', 'ecmascript', 'typescript', 'vanilla js', 'async/await',
    'promises', 'node.js', 'react'],
  typescript: ['ts', 'typed javascript', 'tsx'],
  html: ['html5', 'markup', 'semantic html'],
  css: ['css3', 'scss', 'sass', 'tailwind', 'bootstrap', 'styled-components', 'responsive design'],
  cloud: ['aws', 'ec2', 's3', 'lambda', 'gcp', 'google cloud', 'azure', 'vercel', 'render',
    'heroku', 'netlify', 'digitalocean', 'docker', 'kubernetes', 'ci/cd', 'github actions',
    'deployed', 'deployment'],
  testing: ['jest', 'mocha', 'chai', 'vitest', 'cypress', 'playwright', 'pytest', 'junit',
    'automated tests', 'automated testing', 'tests', 'test automation', 'qa',
    'unit test', 'unit tests', 'integration test', 'test coverage', 'tdd'],
  python: ['py', 'django', 'flask', 'fastapi', 'pandas', 'numpy'],
  java: ['spring', 'spring boot', 'jvm'],
  'computer science': ['cse', 'cs', 'information technology', 'b.tech', 'btech', 'bachelor of technology',
    'bachelor of engineering', 'b.e.', 'software engineering'],
  'machine learning': ['ml', 'deep learning', 'tensorflow', 'pytorch', 'scikit-learn', 'sklearn',
    'neural network', 'cnn', 'nlp'],
  agile: ['scrum', 'sprint', 'kanban', 'standup', 'jira'],
};

/** Reverse index: alias phrase -> canonical term. Built once at load. */
const REVERSE = new Map();
for (const [canonical, aliasList] of Object.entries(ALIASES)) {
  for (const alias of aliasList) {
    if (!REVERSE.has(alias)) REVERSE.set(alias, []);
    REVERSE.get(alias).push(canonical);
  }
  REVERSE.set(canonical, [canonical]);
}

/** Longest phrases first, so "server-side javascript" wins over "javascript". */
const SORTED_ALIASES = [...REVERSE.keys()].sort((a, b) => b.length - a.length);

// ------------------------------------------------------------------
// Typo tolerance
//
// Resumes contain misspellings: "Javscript", "Pyhton", "MongoDb", "Recieved".
// An exact-match dictionary silently loses the skill, and the candidate loses
// the requirement, with no error anywhere to tell us it happened.
//
// Bounded deliberately: only single-token aliases, only tokens of 5+ chars
// (short ones produce nonsense matches — "java"/"jaba"/"js"), and candidates
// are pre-filtered by first letter and length. Without those bounds this is
// tokens x aliases on every unit and would dominate runtime across 7,600 units.
// ------------------------------------------------------------------

const SINGLE_TOKEN_ALIASES = SORTED_ALIASES.filter((a) => !a.includes(' ') && a.length >= 5);

/** Aliases bucketed by first character, for cheap candidate lookup. */
const BY_FIRST_CHAR = new Map();
for (const a of SINGLE_TOKEN_ALIASES) {
  const k = a[0];
  if (!BY_FIRST_CHAR.has(k)) BY_FIRST_CHAR.set(k, []);
  BY_FIRST_CHAR.get(k).push(a);
}

/**
 * Damerau-Levenshtein (optimal string alignment), early-exit past max.
 *
 * Plain Levenshtein charges 2 for a transposition, which is wrong for our use:
 * "Pyhton" and "Docekr" are adjacent-swap typos — by far the most common kind —
 * and a budget of 1 would reject both. Counting a swap as a single edit catches
 * them without widening the budget enough to create false matches.
 */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // adjacent transposition: "ht" <-> "th"
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already too far
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Nearest dictionary alias within a small edit budget, or null.
 * Budget scales with length: 1 typo for short words, 2 for long ones.
 */
function fuzzyAlias(token) {
  if (token.length < 5) return null;
  if (REVERSE.has(token)) return null; // exact match, nothing to correct
  const budget = token.length >= 8 ? 2 : 1;

  let best = null;
  let bestDist = budget + 1;
  for (const cand of BY_FIRST_CHAR.get(token[0]) || []) {
    if (Math.abs(cand.length - token.length) > budget) continue;
    const d = editDistance(token, cand, budget);
    if (d < bestDist) { bestDist = d; best = cand; }
    if (bestDist === 1) break; // good enough
  }
  return bestDist <= budget ? best : null;
}

/**
 * Lowercase, strip punctuation that isn't part of a tech term, collapse whitespace.
 * Keeps '.', '+', '#' so "node.js", "c++", "c#" survive.
 */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9.+#/\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Append canonical terms implied by aliases present in the text.
 * Does NOT alter the original wording — only adds.
 * @param {string} text
 * @returns {string} normalized text plus any implied canonical terms
 */
function expandAliases(text) {
  const base = normalize(text);
  if (!base) return '';

  const padded = ` ${base} `;
  // Slash-joined skills are extremely common on resumes and in JDs —
  // "HTML/CSS", "AWS/GCP/Azure", "agile/scrum", "Git/GitHub". Matching only on
  // space-delimited terms makes every one of them invisible. We test both forms:
  // `padded` so aliases that legitimately contain a slash still match ("ci/cd"),
  // and `slashed` so the components of a slash list are each findable.
  const slashed = padded.replace(/\//g, ' ');
  const found = new Set();

  for (const alias of SORTED_ALIASES) {
    if (padded.includes(` ${alias} `) || slashed.includes(` ${alias} `)) {
      for (const canonical of REVERSE.get(alias)) {
        if (!padded.includes(` ${canonical} `)) found.add(canonical);
      }
    }
  }

  // Second pass: misspelled skills. "Javscript" should still reach "javascript".
  for (const token of base.split(' ')) {
    const near = fuzzyAlias(token);
    if (!near) continue;
    for (const canonical of REVERSE.get(near)) {
      if (!padded.includes(` ${canonical} `)) found.add(canonical);
    }
  }

  return found.size ? `${base} ${[...found].join(' ')}` : base;
}

/** Canonical skills mentioned in a blob of text. Used for Candidate.skillsDeclared. */
function detectSkills(text) {
  const padded = ` ${normalize(text)} `;
  const slashed = padded.replace(/\//g, ' '); // see expandAliases: "HTML/CSS"
  const found = new Set();
  for (const alias of SORTED_ALIASES) {
    if (padded.includes(` ${alias} `) || slashed.includes(` ${alias} `)) {
      REVERSE.get(alias).forEach((c) => found.add(c));
    }
  }
  return [...found].sort();
}

module.exports = { ALIASES, normalize, expandAliases, detectSkills, fuzzyAlias };
