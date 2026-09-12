/**
 * Ground-truth ranking validation against the organisers' 220-resume set.
 *
 * WHY THIS EXISTS
 * The organisers' training filenames encode each resume's target role —
 * "SDE_Resume_1", "Sales_Resume_2", "HR_A", "Video_Editing_Resume_1". Roughly
 * ten resumes per role across ~20 roles.
 *
 * Our JD is a Junior Full Stack Developer Intern. So we already know the answer:
 * SDE and Web Developer resumes belong at the top, Sales and HR at the bottom.
 * That turns "our ranking looks sensible" — which every team will claim — into a
 * measurement we can put a number on.
 *
 *   node backend/src/engine/eval/validateRoles.js
 *   node backend/src/engine/eval/validateRoles.js --limit 60   (faster smoke run)
 */

const path = require('path');
const jd = require(path.join(__dirname, '..', 'fixtures', 'jd.fixture.json'));
const { loadFromDir } = require('../parse/loadCandidates');
const { runPipeline } = require('../match/score');

const RESUME_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'dummy_resumes');

/**
 * Relevance of each role to a Junior Full Stack Developer Intern JD.
 *   RELEVANT   - should rank top
 *   ADJACENT   - technical but wrong specialisation; mid is correct
 *   IRRELEVANT - should rank bottom
 */
const ROLE_CLASS = [
  [/\bsde\b|software.?dev|web.?dev|webdev|full.?stack|app.?dev|python|backend|frontend|mern|javascript/i, 'RELEVANT'],
  [/ai.?dev|ml.?eng|machine.?learning|data.?scien|\bds\b|devops|cyber.?sec|it.?support|cloud|blockchain|\bqa\b|test/i, 'ADJACENT'],
  [/sales|\bhr\b|human.?resource|market|content|video|social.?media|design|founder|business|operations|customer/i, 'IRRELEVANT'],
];

/** Role label from filename: "SDE_Resume_1_Aditya_Joshi.txt" -> "sde". */
function roleFromFilename(file) {
  const base = file.replace(/\.[a-z]+$/i, '');
  const cut = base.split(/_?(resume|Resume)/)[0];
  return cut.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() || base.toLowerCase();
}

/**
 * Classify by the NORMALISED role string, not the raw filename.
 *
 * Underscore is a word character, so /\bsde\b/ never matches "SDE_Resume_1" —
 * which quietly dropped all ten SDE resumes into UNKNOWN and understated
 * precision@top25%. Normalising to "sde" first makes the boundaries behave.
 */
function classify(file) {
  const role = roleFromFilename(file);
  for (const [pattern, cls] of ROLE_CLASS) {
    if (pattern.test(role)) return cls;
  }
  return 'UNKNOWN';
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

  console.log('loading resumes...');
  let candidates = await loadFromDir(RESUME_DIR);
  if (Number.isFinite(limit)) candidates = candidates.slice(0, limit);

  const units = candidates.reduce((a, c) => a + c.evidence.length, 0);
  console.log(`${candidates.length} candidates, ${units} evidence units`);
  console.log('scoring (first run embeds everything; later runs hit the cache)...');

  const t0 = Date.now();
  const results = await runPipeline(jd, candidates, { alpha: 0.5, mode: 'hybrid' });
  console.log(`scored in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rows = results.map((r) => {
    const file = byId.get(r.candidateId).sourceFile;
    return {
      name: r.name,
      file,
      role: roleFromFilename(file),
      cls: classify(file),
      rank: r.rank,
      score: r.finalScore,
      percentile: r.rank / results.length,
    };
  });

  // ---------------- headline metric
  const n = rows.length;
  const relevant = rows.filter((r) => r.cls === 'RELEVANT');
  const irrelevant = rows.filter((r) => r.cls === 'IRRELEVANT');
  const adjacent = rows.filter((r) => r.cls === 'ADJACENT');
  const topQ = rows.filter((r) => r.rank <= n / 4);
  const botQ = rows.filter((r) => r.rank > (n * 3) / 4);

  console.log('='.repeat(72));
  console.log('GROUND-TRUTH RANKING VALIDATION');
  console.log(`JD: ${jd.title} @ ${jd.company}`);
  console.log('='.repeat(72));
  console.log('CLASS        N    MEAN RANK   MEAN SCORE   IN TOP 25%   IN BOTTOM 25%');
  for (const [label, set] of [['RELEVANT', relevant], ['ADJACENT', adjacent], ['IRRELEVANT', irrelevant]]) {
    if (!set.length) continue;
    const inTop = set.filter((r) => r.rank <= n / 4).length;
    const inBot = set.filter((r) => r.rank > (n * 3) / 4).length;
    console.log(
      label.padEnd(13) +
      String(set.length).padEnd(5) +
      mean(set.map((r) => r.rank)).toFixed(1).padEnd(12) +
      mean(set.map((r) => r.score)).toFixed(1).padEnd(13) +
      `${inTop}/${set.length}`.padEnd(13) +
      `${inBot}/${set.length}`
    );
  }

  console.log('');
  const precTop = topQ.filter((r) => r.cls === 'RELEVANT').length / Math.max(topQ.length, 1);
  const purityBot = botQ.filter((r) => r.cls === 'IRRELEVANT').length / Math.max(botQ.length, 1);
  console.log(`precision@top25%  : ${(precTop * 100).toFixed(0)}%  (RELEVANT share of the top quartile)`);
  console.log(`purity@bottom25%  : ${(purityBot * 100).toFixed(0)}%  (IRRELEVANT share of the bottom quartile)`);

  const sepOk = mean(relevant.map((r) => r.rank)) < mean(irrelevant.map((r) => r.rank));
  console.log(`separation        : ${sepOk ? 'PASS' : 'FAIL'} — relevant roles outrank irrelevant ones on average`);

  // ---------------- per-role detail
  console.log('\nMEAN RANK BY ROLE (lower is better)');
  const roles = {};
  for (const r of rows) {
    roles[r.role] = roles[r.role] || { ranks: [], cls: r.cls };
    roles[r.role].ranks.push(r.rank);
  }
  Object.entries(roles)
    .map(([role, v]) => ({ role, cls: v.cls, n: v.ranks.length, mean: mean(v.ranks) }))
    .sort((a, b) => a.mean - b.mean)
    .forEach((r) => {
      console.log(
        '  ' + r.role.slice(0, 26).padEnd(28) +
        r.cls.padEnd(12) +
        `n=${r.n}`.padEnd(6) +
        `mean rank ${r.mean.toFixed(1)}`
      );
    });

  // ---------------- misplacements are the interesting part
  console.log('\nMISPLACEMENTS');
  const badTop = topQ.filter((r) => r.cls === 'IRRELEVANT');
  const badBot = botQ.filter((r) => r.cls === 'RELEVANT');
  if (!badTop.length && !badBot.length) {
    console.log('  none — no irrelevant role in the top quartile, no relevant role in the bottom');
  }
  badTop.forEach((r) => console.log(`  IRRELEVANT ranked #${r.rank} (${r.score}): ${r.name} — ${r.file}`));
  badBot.forEach((r) => console.log(`  RELEVANT ranked #${r.rank} (${r.score}): ${r.name} — ${r.file}`));
  console.log('');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { roleFromFilename, classify };
