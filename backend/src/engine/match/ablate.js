/**
 * Ablation harness — the single highest-ROI differentiator we have.
 *
 * FOUR modes now, so every layer of the stack has to visibly earn its keep:
 *
 *   literal        alpha=1.0  lexicalField='normalized'
 *                             BM25 over the resume as the candidate wrote it.
 *                             Zero alias expansion. Zero semantic. This is the
 *                             baseline — vocabulary mismatch is fatal here.
 *
 *   lexical_only   alpha=1.0  lexicalField='expanded'
 *                             BM25 with alias expansion. Now "Express" on the
 *                             resume matches the "Node.js" requirement. This
 *                             row proves the skill graph earns its place.
 *
 *   semantic_only  alpha=0.0
 *                             Pure cosine over sentence embeddings. This row
 *                             proves the embedding layer earns its place.
 *
 *   hybrid         alpha=0.5
 *                             The full stack. Wins where either alone loses.
 *
 * Priya Sharma (real cand_01) is the canonical top-of-pool; Kabir Nair is
 * the semantic-rescue proof. If Kabir drops materially in literal or
 * lexical_only but climbs back in hybrid, the story is intact.
 */

const { runPipeline } = require('./score');

async function runAblation(jd, candidates) {
  const [literal, lexical, semantic, hybrid] = await Promise.all([
    runPipeline(jd, candidates, { alpha: 1.0, mode: 'lexical_only', lexicalField: 'normalized' }),
    runPipeline(jd, candidates, { alpha: 1.0, mode: 'lexical_only', lexicalField: 'expanded' }),
    runPipeline(jd, candidates, { alpha: 0.0, mode: 'semantic_only' }),
    runPipeline(jd, candidates, { alpha: 0.5, mode: 'hybrid' }),
  ]);

  const rankBy = (results) => {
    const m = new Map();
    for (const c of results) m.set(c.candidateId, c.rank);
    return m;
  };
  const lit = rankBy(literal);
  const lex = rankBy(lexical);
  const sem = rankBy(semantic);
  const hyb = rankBy(hybrid);

  const rows = candidates
    .map(c => ({
      candidateId: c.id,
      name: c.name,
      literalRank: lit.get(c.id),
      lexicalRank: lex.get(c.id),
      semanticRank: sem.get(c.id),
      hybridRank: hyb.get(c.id),
    }))
    .map(r => ({
      ...r,
      litToHybridDelta: r.literalRank - r.hybridRank,   // how much aliases + semantic together saved
      lexToHybridDelta: r.lexicalRank - r.hybridRank,   // how much semantic alone added on top of aliases
      semToHybridDelta: r.semanticRank - r.hybridRank,  // how much lexical added on top of semantic
    }))
    .sort((a, b) => a.hybridRank - b.hybridRank);

  return { rows, literal, lexical, semantic, hybrid };
}

/** Print a simple console table for the CLI. */
function printAblation({ rows }) {
  const w = { name: 20, num: 5, delta: 8 };
  const header = [
    'name'.padEnd(w.name),
    'lit'.padStart(w.num),
    'lex'.padStart(w.num),
    'sem'.padStart(w.num),
    'hyb'.padStart(w.num),
    'lit→hyb'.padStart(w.delta),
    'lex→hyb'.padStart(w.delta),
    'sem→hyb'.padStart(w.delta),
  ].join(' | ');
  const sep = '-'.repeat(header.length);
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log([
      String(r.name).slice(0, w.name).padEnd(w.name),
      String(r.literalRank).padStart(w.num),
      String(r.lexicalRank).padStart(w.num),
      String(r.semanticRank).padStart(w.num),
      String(r.hybridRank).padStart(w.num),
      String(r.litToHybridDelta).padStart(w.delta),
      String(r.lexToHybridDelta).padStart(w.delta),
      String(r.semToHybridDelta).padStart(w.delta),
    ].join(' | '));
  }
}

module.exports = { runAblation, printAblation };
