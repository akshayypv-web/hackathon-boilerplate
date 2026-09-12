/**
 * Precompute the ablation over the current pool and dump it to disk. Used as
 * demo insurance: the server can crash and restart and /api/ablation still
 * responds instantly with the saved artifact.
 *
 * Run before code freeze:
 *   node backend/src/engine/match/precompute.js
 *
 * Writes: backend/src/engine/.cache/ablation.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const jd = require(path.join(__dirname, '..', 'fixtures', 'jd.fixture.json'));
const { loadFromDir } = require('../parse/loadCandidates');
const { runAblation } = require('./ablate');

const RESUMES_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'resumes');
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const OUT_FILE = path.join(CACHE_DIR, 'ablation.json');

function jdKey(x) {
  return crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);
}

(async () => {
  console.log(`Loading resumes from ${RESUMES_DIR} ...`);
  const candidates = await loadFromDir(RESUMES_DIR);
  console.log(`Parsed ${candidates.length} candidates. Running ablation ...`);

  const t0 = Date.now();
  const { rows, lexical, semantic, hybrid } = await runAblation(jd, candidates);
  const dt = Date.now() - t0;

  const payload = {
    jdKey: jdKey(jd),
    generatedAt: new Date().toISOString(),
    elapsedMs: dt,
    candidates: rows.map(r => ({
      candidateId: r.candidateId,
      name: r.name,
      lexicalRank: r.lexicalRank,
      semanticRank: r.semanticRank,
      hybridRank: r.hybridRank,
      delta: r.lexToHybridDelta,
      lexToHybridDelta: r.lexToHybridDelta,
      semToHybridDelta: r.semToHybridDelta,
    })),
    scores: {
      lexical: lexical.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
      semantic: semantic.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
      hybrid: hybrid.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
    },
    meta: { poolSize: candidates.length },
  };

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE} (${dt} ms compute).`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
