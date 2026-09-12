/**
 * Run the matching pipeline on the real 18 resumes at data/resumes/.
 *
 * JD is loaded from fixtures for now (C's decompose.js is not wired yet).
 * Prints the ablation table + final hybrid scores + a spread summary so we
 * can tune weights against real distribution shape.
 *
 *   node backend/src/engine/match/runReal.js
 */

const path = require('path');
const jd = require(path.join(__dirname, '..', 'fixtures', 'jd.fixture.json'));
const { loadFromDir } = require('../parse/loadCandidates');
const { runAblation, printAblation } = require('./ablate');

const RESUMES_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'resumes');

function stats(scores) {
  const s = [...scores].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const median = s[Math.floor(s.length / 2)];
  return {
    min: s[0],
    p25: s[Math.floor(s.length * 0.25)],
    median,
    p75: s[Math.floor(s.length * 0.75)],
    max: s[s.length - 1],
    mean: Math.round(mean * 10) / 10,
    stddev: Math.round(
      Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length) * 10,
    ) / 10,
  };
}

(async () => {
  console.log(`Loading resumes from ${RESUMES_DIR} ...`);
  const t0 = Date.now();
  const candidates = await loadFromDir(RESUMES_DIR);
  console.log(`Parsed ${candidates.length} candidates in ${Date.now() - t0} ms\n`);

  const t1 = Date.now();
  const { rows, hybrid, lexical, semantic } = await runAblation(jd, candidates);
  console.log(`Ran 3 modes in ${Date.now() - t1} ms\n`);

  printAblation({ rows });
  console.log();

  console.log('Hybrid final ranking:');
  for (const c of hybrid) {
    const miss = c.missingMustHaves.length
      ? `  missing MUSTs: [${c.missingMustHaves.join(', ')}]`
      : '';
    console.log(`  ${String(c.rank).padStart(2)}. ${c.name.padEnd(20)} ${String(c.finalScore).padStart(5)}${miss}`);
  }
  console.log();

  console.log('Score spread by mode:');
  for (const [label, results] of [['lexical', lexical], ['semantic', semantic], ['hybrid', hybrid]]) {
    const s = stats(results.map(c => c.finalScore));
    console.log(
      `  ${label.padEnd(10)} min=${s.min} p25=${s.p25} med=${s.median} p75=${s.p75} max=${s.max}  mean=${s.mean}  sd=${s.stddev}`,
    );
  }

  const zeroCount = hybrid.filter(c => c.finalScore === 0).length;
  const hundredCount = hybrid.filter(c => c.finalScore === 100).length;
  console.log(`\nSanity: ${zeroCount} scored 0, ${hundredCount} scored 100.`);
  if (zeroCount > 2) console.log('  ⚠ many zero scores — gate penalty may be too harsh.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
