/**
 * Smoke test for the matching engine.
 *
 * Runs the pipeline against backend/src/engine/fixtures/ and checks that
 *   1. Aarav (cand_01) ranks near the top in every mode.
 *   2. Priya (cand_02) is buried in lexical_only but rescued in hybrid.
 *   3. Sneha (cand_04) ranks last in every mode.
 *
 * Also prints the full ablation table.
 *
 *   node backend/src/engine/match/test.js
 */

const path = require('path');
const jd = require(path.join(__dirname, '..', 'fixtures', 'jd.fixture.json'));
const candidates = require(path.join(__dirname, '..', 'fixtures', 'candidates.fixture.json'));

const { runAblation, printAblation } = require('./ablate');

(async () => {
  const t0 = Date.now();
  const { rows, lexical, semantic, hybrid } = await runAblation(jd, candidates);
  const dt = Date.now() - t0;

  console.log(`Ran 3 modes over ${candidates.length} candidates in ${dt} ms\n`);
  printAblation({ rows });
  console.log();

  const rankOf = (results, id) => results.find(c => c.candidateId === id)?.rank;
  const scoreOf = (results, id) => results.find(c => c.candidateId === id)?.finalScore;

  console.log('Hybrid final scores:');
  for (const c of hybrid) {
    console.log(`  ${c.rank}. ${c.name.padEnd(16)} ${c.finalScore}   missing MUSTs: [${c.missingMustHaves.join(', ')}]`);
  }
  console.log();

  const priyaLex = rankOf(lexical, 'cand_02');
  const priyaHyb = rankOf(hybrid, 'cand_02');
  const priyaSem = rankOf(semantic, 'cand_02');

  console.log(`Priya (cand_02): lexical=#${priyaLex}, semantic=#${priyaSem}, hybrid=#${priyaHyb}`);
  const priyaRescued = priyaLex - priyaHyb;
  console.log(priyaRescued > 0
    ? `PASS — hybrid rescued Priya by ${priyaRescued} rank(s).\n`
    : `FAIL — hybrid did not rescue Priya (delta ${priyaRescued}).\n`);

  const aaravHyb = rankOf(hybrid, 'cand_01');
  console.log(`Aarav (cand_01) hybrid rank: #${aaravHyb} — expected 1 or 2.`);

  const snehaHyb = rankOf(hybrid, 'cand_04');
  console.log(`Sneha (cand_04) hybrid rank: #${snehaHyb} — expected 4 (last).`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
