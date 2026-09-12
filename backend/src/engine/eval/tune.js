/**
 * Parameter sweep against the organisers' 220 role-labelled resumes.
 *
 * WHY THIS EXISTS
 * "Why is alpha 0.5?" and "why is the gate 0.35?" are the two questions a judge
 * will ask about our config, and "it felt right" is a losing answer. This sweeps
 * each parameter and reports the metric it moves, so every number in config.js
 * traces to a measurement.
 *
 * The label is the resume's TARGET ROLE from the organisers' filename. Against a
 * Junior Full Stack Developer Intern JD, SDE/web/app/python resumes should rank
 * top and sales/HR/marketing should rank bottom.
 *
 *   node backend/src/engine/eval/tune.js            # both sweeps
 *   node backend/src/engine/eval/tune.js --alpha    # alpha only
 *   node backend/src/engine/eval/tune.js --gate     # gate only
 */

const path = require('path');
const jd = require(path.join(__dirname, '..', 'fixtures', 'jd.fixture.json'));
const { loadFromDir } = require('../parse/loadCandidates');
const { runPipeline } = require('../match/score');
const { classify } = require('./validateRoles');

const RESUME_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'dummy_resumes');

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function stddev(xs) {
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}

/**
 * Score one configuration.
 *
 * Headline metric is precision@top25% — of the candidates we would actually
 * shortlist, how many are genuinely relevant. That is what a recruiter feels.
 * `separation` (mean rank gap between irrelevant and relevant) is the tiebreak,
 * because it keeps improving after precision saturates.
 */
async function evaluate(candidates, opts) {
  const results = await runPipeline(jd, candidates, opts);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const n = results.length;

  const rows = results.map((r) => ({
    cls: classify(byId.get(r.candidateId).sourceFile),
    rank: r.rank,
    score: r.finalScore,
  }));

  const relevant = rows.filter((r) => r.cls === 'RELEVANT');
  const irrelevant = rows.filter((r) => r.cls === 'IRRELEVANT');
  const topQ = rows.filter((r) => r.rank <= n / 4);
  const botQ = rows.filter((r) => r.rank > (n * 3) / 4);

  return {
    precTop: topQ.filter((r) => r.cls === 'RELEVANT').length / Math.max(topQ.length, 1),
    purityBot: botQ.filter((r) => r.cls === 'IRRELEVANT').length / Math.max(botQ.length, 1),
    separation: mean(irrelevant.map((r) => r.rank)) - mean(relevant.map((r) => r.rank)),
    relevantInTop: topQ.filter((r) => r.cls === 'RELEVANT').length,
    irrelevantInTop: topQ.filter((r) => r.cls === 'IRRELEVANT').length,
    spread: stddev(rows.map((r) => r.score)),
  };
}

function row(label, m, flag) {
  return (
    String(label).padEnd(10) +
    (m.precTop * 100).toFixed(0).padStart(5) + '%' +
    (m.purityBot * 100).toFixed(0).padStart(8) + '%' +
    m.separation.toFixed(1).padStart(12) +
    String(m.irrelevantInTop).padStart(10) +
    m.spread.toFixed(1).padStart(9) +
    (flag ? '   <-- ' + flag : '')
  );
}

async function main() {
  const onlyAlpha = process.argv.includes('--alpha');
  const onlyGate = process.argv.includes('--gate');

  console.log('loading 220 resumes...');
  const candidates = await loadFromDir(RESUME_DIR);
  console.log(`${candidates.length} candidates, ${candidates.reduce((a, c) => a + c.evidence.length, 0)} evidence units\n`);

  const HEAD = 'PARAM      prec@25   purity@25   separation   bad@top    spread';

  if (!onlyGate) {
    console.log('='.repeat(72));
    console.log('ALPHA SWEEP  (1.0 = keyword only, 0.0 = semantic only)');
    console.log('='.repeat(72));
    console.log(HEAD);
    const results = [];
    for (const alpha of [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]) {
      const m = await evaluate(candidates, { alpha, mode: 'hybrid' });
      results.push({ alpha, m });
      console.log(row(alpha.toFixed(1), m));
    }
    const best = results.reduce((a, b) =>
      (b.m.precTop > a.m.precTop || (b.m.precTop === a.m.precTop && b.m.separation > a.m.separation)) ? b : a);
    console.log(`\nbest alpha by precision then separation: ${best.alpha}`);
    console.log('(pure 1.0 and 0.0 are the ablation endpoints — if the middle beats both,');
    console.log(' that IS the evidence that hybrid earns its place)\n');
  }

  if (!onlyAlpha) {
    console.log('='.repeat(72));
    console.log('GATE SWEEP  (fused score below this = must-have counted missing)');
    console.log('='.repeat(72));
    console.log(HEAD);
    const results = [];
    for (const g of [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]) {
      const m = await evaluate(candidates, { alpha: 0.5, mode: 'hybrid', gateThreshold: g });
      results.push({ g, m });
      console.log(row(g.toFixed(2), m));
    }
    const best = results.reduce((a, b) =>
      (b.m.precTop > a.m.precTop || (b.m.precTop === a.m.precTop && b.m.separation > a.m.separation)) ? b : a);
    console.log(`\nbest gate by precision then separation: ${best.g}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { evaluate };
