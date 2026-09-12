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
  const found = new Set();

  for (const alias of SORTED_ALIASES) {
    if (padded.includes(` ${alias} `)) {
      for (const canonical of REVERSE.get(alias)) {
        if (!padded.includes(` ${canonical} `)) found.add(canonical);
      }
    }
  }

  return found.size ? `${base} ${[...found].join(' ')}` : base;
}

/** Canonical skills mentioned in a blob of text. Used for Candidate.skillsDeclared. */
function detectSkills(text) {
  const padded = ` ${normalize(text)} `;
  const found = new Set();
  for (const alias of SORTED_ALIASES) {
    if (padded.includes(` ${alias} `)) {
      REVERSE.get(alias).forEach((c) => found.add(c));
    }
  }
  return [...found].sort();
}

module.exports = { ALIASES, normalize, expandAliases, detectSkills };
