/**
 * Ablation harness — the single highest-ROI differentiator we have.
 *
 * Runs the ranker three times: alpha=1 (lexical-only), alpha=0 (semantic-only),
 * alpha=0.5 (hybrid). Returns a table showing each candidate's rank in all
 * three modes and the delta.
 *
 * This is what proves to judges that both signals genuinely matter — without
 * it, judges just have to take our word for it that hybrid > either alone.
 *
 * Priya Nair (cand_02 in the fixtures) is the built-in regression test:
 * lexical-only should bury her; hybrid should rescue her. If not, the engine
 * regressed.
 */

const { runPipeline } = require('./score');

async function runAblation(jd, candidates) {
  const [lexical, semantic, hybrid] = await Promise.all([
    runPipeline(jd, candidates, { alpha: 1.0, mode: 'lexical_only' }),
    runPipeline(jd, candidates, { alpha: 0.0, mode: 'semantic_only' }),
    runPipeline(jd, candidates, { alpha: 0.5, mode: 'hybrid' }),
  ]);

  const rankBy = (results) => {
    const m = new Map();
    for (const c of results) m.set(c.candidateId, c.rank);
    return m;
  };
  const lex = rankBy(lexical);
  const sem = rankBy(semantic);
  const hyb = rankBy(hybrid);

  const rows = candidates
    .map(c => ({
      candidateId: c.id,
      name: c.name,
      lexicalRank: lex.get(c.id),
      semanticRank: sem.get(c.id),
      hybridRank: hyb.get(c.id),
    }))
    .map(r => ({
      ...r,
      // Positive delta = hybrid ranked candidate BETTER than the extremes' worst.
      // A lexically invisible candidate (like Priya) will show a big improvement
      // between lexicalRank and hybridRank — that's the proof point.
      lexToHybridDelta: r.lexicalRank - r.hybridRank,
      semToHybridDelta: r.semanticRank - r.hybridRank,
    }))
    .sort((a, b) => a.hybridRank - b.hybridRank);

  return { rows, lexical, semantic, hybrid };
}

/** Print a simple console table for the CLI. */
function printAblation({ rows }) {
  const w = { name: 20, num: 6, delta: 8 };
  const header = [
    'name'.padEnd(w.name),
    'lex'.padStart(w.num),
    'sem'.padStart(w.num),
    'hyb'.padStart(w.num),
    'lex→hyb'.padStart(w.delta),
    'sem→hyb'.padStart(w.delta),
  ].join(' | ');
  const sep = '-'.repeat(header.length);
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log([
      String(r.name).slice(0, w.name).padEnd(w.name),
      String(r.lexicalRank).padStart(w.num),
      String(r.semanticRank).padStart(w.num),
      String(r.hybridRank).padStart(w.num),
      String(r.lexToHybridDelta).padStart(w.delta),
      String(r.semToHybridDelta).padStart(w.delta),
    ].join(' | '));
  }
}

module.exports = { runAblation, printAblation };
