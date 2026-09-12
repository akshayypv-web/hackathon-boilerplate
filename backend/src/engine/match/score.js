/**
 * The core matching engine. Pipeline order matters and is called out below —
 * this is what I walk judges through when they ask "how does your matching
 * actually work."
 *
 * Inputs (frozen by contract.js):
 *   requirements: Requirement[]  (from JD decomposition, owner: C)
 *   candidates:   Candidate[]    (from PDF parsing, owner: A)
 *
 * Output:
 *   CandidateScore[] sorted by rank, with .requirementScores populated for
 *   every (req x cand) cell. `.explanation` is left null — that's C's job.
 */

const { tokenize, buildIndex, score: bm25Score } = require('./bm25');
const { embedAll, cosine } = require('./embed');
const cfg = require('./config');

function _sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function _mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function _stddev(xs, mu) {
  if (xs.length < 2) return 0;
  const s2 = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(s2);
}

/** z-score an array; if std is 0, everyone is average (0). */
function _zscore(xs) {
  const mu = _mean(xs);
  const sd = _stddev(xs, mu);
  if (sd < 1e-9) return xs.map(() => 0);
  return xs.map(x => (x - mu) / sd);
}

/**
 * runPipeline(jd, candidates, { alpha, mode }) -> CandidateScore[]
 *
 * `mode` is one of MODES; only used to label the output.
 * `alpha` defaults to cfg.alpha. Ablation passes 1.0 (lexical-only) and 0.0
 * (semantic-only) here.
 */
async function runPipeline(jd, candidates, opts = {}) {
  const alpha = opts.alpha != null ? opts.alpha : cfg.alpha;
  const mode = opts.mode || 'hybrid';

  // Every threshold is either a per-call override or the module default.
  // This is what makes /api/tune and the live slider work without touching cfg.
  const gateThreshold        = opts.gateThreshold        != null ? opts.gateThreshold        : cfg.gateThreshold;
  const gatePenaltyPerMiss   = opts.gatePenaltyPerMiss   != null ? opts.gatePenaltyPerMiss   : cfg.gatePenaltyPerMiss;
  const satisfyThreshold     = opts.satisfyThreshold     != null ? opts.satisfyThreshold     : cfg.satisfyThreshold;
  const matchBothThreshold   = opts.matchBothThreshold   != null ? opts.matchBothThreshold   : cfg.matchBothThreshold;

  if (!candidates.length) return [];

  // --- (0) Collect the whole pool of evidence units into a flat corpus.
  const allEvidence = [];
  for (const c of candidates) {
    for (const e of c.evidence) allEvidence.push(e);
  }

  // --- (0a) BM25 over the pooled corpus. One doc = one evidence unit.
  //
  // CONTRACT NOTE: evidence units carry TWO text fields.
  //   .normalized -> literal, cleaned, NO alias expansion
  //   .expanded   -> normalized PLUS canonical terms implied by aliases
  // Default to .expanded so "Express" is findable when the JD says "Node.js".
  // Pass lexicalField:'normalized' for the literal-keyword ablation row, which
  // is what demonstrates the vocabulary-mismatch problem to judges.
  const lexicalField = opts.lexicalField || 'expanded';
  const bm25Docs = allEvidence.map(e => ({
    id: e.id,
    text: e[lexicalField] || e.normalized || e.text,
  }));
  const bm25Index = buildIndex(bm25Docs);

  // --- (0b) Embed everything: each requirement text, and each evidence unit.
  //         Requirement query = "text | alias1 alias2 ..." so aliases nudge
  //         the semantic similarity too, not just BM25.
  const reqQueries = jd.requirements.map(r => `${r.text} | ${(r.aliases || []).join(' ')}`);
  const evTexts = allEvidence.map(e => e.text);

  const [reqEmbeds, evEmbeds] = await Promise.all([
    embedAll(reqQueries),
    embedAll(evTexts),
  ]);

  // Index embedding vectors by evidence unit id.
  const evEmbedById = new Map();
  for (let i = 0; i < allEvidence.length; i += 1) {
    evEmbedById.set(allEvidence[i].id, evEmbeds[i]);
  }

  // --- (a,b) For every (req, cand) pair: max-over-evidence for BM25 and cosine.
  //          Also remember the winning evidence unit so explanations can quote it.
  //
  // Result layout: matrix[reqIdx][candIdx] = {
  //   lexicalRaw, semanticRaw, lexicalEvId, semanticEvId
  // }
  const matrix = jd.requirements.map(() => []);

  for (let ri = 0; ri < jd.requirements.length; ri += 1) {
    const req = jd.requirements[ri];
    const queryTokens = [...tokenize(req.text), ...(req.aliases || []).flatMap(a => tokenize(a))];
    const reqEmb = reqEmbeds[ri];

    for (let ci = 0; ci < candidates.length; ci += 1) {
      const cand = candidates[ci];

      let lexBest = -Infinity;
      let lexBestId = null;
      let semBest = -Infinity;
      let semBestId = null;
      const traceLex = opts.trace ? [] : null;
      const traceSem = opts.trace ? [] : null;

      for (const ev of cand.evidence) {
        // A negated unit DISCLAIMS a capability: "no formal source control
        // tooling used". Embeddings match topic, not polarity, so such a unit
        // otherwise scores as a strong match for the very requirement the
        // candidate is denying. Never let a disclaimer satisfy a requirement.
        if (ev.negated) continue;

        const lex = bm25Score(bm25Index, queryTokens, ev.id);
        if (lex > lexBest) { lexBest = lex; lexBestId = ev.id; }

        const evEmb = evEmbedById.get(ev.id);
        const sem = evEmb ? cosine(reqEmb, evEmb) : 0;
        if (sem > semBest) { semBest = sem; semBestId = ev.id; }

        if (opts.trace) {
          traceLex.push({ evidenceId: ev.id, section: ev.section, rawScore: lex });
          traceSem.push({ evidenceId: ev.id, section: ev.section, rawScore: sem });
        }
      }
      // If a candidate has zero evidence, default to 0 (not -Infinity).
      if (lexBest === -Infinity) lexBest = 0;
      if (semBest === -Infinity) semBest = 0;

      // Trim traces to the top 5 per side to keep response size sane.
      if (opts.trace) {
        traceLex.sort((a, b) => b.rawScore - a.rawScore);
        traceSem.sort((a, b) => b.rawScore - a.rawScore);
      }

      matrix[ri].push({
        lexicalRaw: lexBest,
        semanticRaw: semBest,
        lexicalEvId: lexBestId,
        semanticEvId: semBestId,
        traceLex: opts.trace ? traceLex.slice(0, 5) : null,
        traceSem: opts.trace ? traceSem.slice(0, 5) : null,
      });
    }
  }

  // --- (c) Z-normalise per requirement across the candidate pool.
  //         THIS is what creates real score spread. Raw cosine clusters
  //         everything in 0.6..0.8 and produces a mushy ranking.
  const zNormed = matrix.map(row => {
    const lexZ = _zscore(row.map(cell => cell.lexicalRaw));
    const semZ = _zscore(row.map(cell => cell.semanticRaw));
    return row.map((cell, ci) => ({
      ...cell,
      lexicalNorm: lexZ[ci],
      semanticNorm: semZ[ci],
    }));
  });

  // --- (d,e,f) Fuse per cell, classify matchedBy, apply must-have gate.
  //             Assemble RequirementScore[] per candidate.
  const evById = new Map(allEvidence.map(e => [e.id, e]));

  const candidateResults = candidates.map((cand, ci) => {
    const reqScores = [];
    let gatePenalty = 1.0;
    const missingMustHaves = [];

    for (let ri = 0; ri < jd.requirements.length; ri += 1) {
      const req = jd.requirements[ri];
      const cell = zNormed[ri][ci];

      const fusedZ = alpha * cell.lexicalNorm + (1 - alpha) * cell.semanticNorm;
      const fused = _sigmoid(fusedZ); // 0..1

      const satisfied = fused >= satisfyThreshold;

      let matchedBy = 'none';
      const lexOK = cell.lexicalNorm > matchBothThreshold;
      const semOK = cell.semanticNorm > matchBothThreshold;
      if (lexOK && semOK) matchedBy = 'both';
      else if (semOK) matchedBy = 'semantic';
      else if (lexOK) matchedBy = 'lexical';

      // Choose which evidence to CITE: prefer the winning side of the fusion.
      // In hybrid we prefer the higher normalised signal; in semantic-only
      // always semantic; in lexical-only always lexical.
      let cited = cell.semanticEvId;
      if (alpha >= 0.999) cited = cell.lexicalEvId;
      else if (alpha <= 0.001) cited = cell.semanticEvId;
      else cited = cell.semanticNorm >= cell.lexicalNorm ? cell.semanticEvId : cell.lexicalEvId;

      const citedText = cited && evById.get(cited) ? evById.get(cited).text : '';

      const rs = {
        requirementId: req.id,
        candidateId: cand.id,
        lexicalRaw: cell.lexicalRaw,
        semanticRaw: cell.semanticRaw,
        lexicalNorm: cell.lexicalNorm,
        semanticNorm: cell.semanticNorm,
        fused,
        satisfied,
        evidenceId: cited,
        evidenceText: citedText,
        matchedBy,
      };
      // Audit trail for the "click any cell" trace feature.
      if (opts.trace) {
        const evText = (evId) => (evId && evById.get(evId) ? evById.get(evId).text : '');
        rs.trace = {
          lexical: cell.traceLex.map(t => ({ ...t, text: evText(t.evidenceId) })),
          semantic: cell.traceSem.map(t => ({ ...t, text: evText(t.evidenceId) })),
        };
      }
      reqScores.push(rs);

      if (req.kind === 'MUST' && fused < gateThreshold) {
        missingMustHaves.push(req.id);
        gatePenalty *= gatePenaltyPerMiss;
      }
    }

    // --- (g) Weighted mean of fused across requirements, then gate.
    const totalW = jd.requirements.reduce((a, r) => a + (r.weight || 1), 0);
    const weightedSum = reqScores.reduce(
      (acc, rs, i) => acc + rs.fused * (jd.requirements[i].weight || 1),
      0,
    );
    const base = totalW > 0 ? weightedSum / totalW : 0;
    const raw = base * gatePenalty;

    return {
      candidateId: cand.id,
      name: cand.name,
      _rawScore: raw,
      requirementScores: reqScores,
      missingMustHaves,
      gatePenalty,
      explanation: null,
    };
  });

  // --- (h) Min-max scale raw across the pool to [scoreMin, scoreMax].
  //         Then sort descending and assign rank.
  const rawVals = candidateResults.map(c => c._rawScore);
  const rMin = Math.min(...rawVals);
  const rMax = Math.max(...rawVals);
  const span = rMax - rMin;

  for (const c of candidateResults) {
    const norm = span < 1e-9 ? 0.5 : (c._rawScore - rMin) / span;
    c.finalScore = Math.round((cfg.scoreMin + norm * (cfg.scoreMax - cfg.scoreMin)) * 10) / 10;
  }

  // Sort on FULL PRECISION, not the rounded display score.
  //
  // finalScore is rounded to 1dp, and across 220 candidates that produced 40
  // shared values with one tie group 8 deep. Sorting on the rounded number left
  // those ranks decided by array order — i.e. by filename. Rank now follows the
  // actual score; rounding is display only. Remaining exact ties fall back to
  // name so the order is at least deterministic across runs.
  candidateResults.sort((a, b) => (b._rawScore - a._rawScore) || a.name.localeCompare(b.name));
  candidateResults.forEach((c, i) => { c.rank = i + 1; delete c._rawScore; });

  // --- "Why not #1?" — for each non-top candidate, find the requirement
  //     where they trail the top by the most. Gap is on the 0..1 fused scale.
  if (candidateResults.length > 1) {
    const top = candidateResults[0];
    const topFusedByReq = new Map(top.requirementScores.map(rs => [rs.requirementId, rs.fused]));
    for (const c of candidateResults.slice(1)) {
      let bestGap = -Infinity;
      let bestReqId = null;
      let bestReqText = '';
      for (const rs of c.requirementScores) {
        const gap = (topFusedByReq.get(rs.requirementId) || 0) - rs.fused;
        if (gap > bestGap) {
          bestGap = gap;
          bestReqId = rs.requirementId;
          const req = jd.requirements.find(r => r.id === bestReqId);
          bestReqText = req ? req.text : '';
        }
      }
      if (bestReqId && bestGap > 0) {
        c.whyNotTop = {
          requirementId: bestReqId,
          requirementText: bestReqText,
          gap: Math.round(bestGap * 100) / 100,
          topScore: Math.round((topFusedByReq.get(bestReqId) || 0) * 100) / 100,
          candidateScore: Math.round(((topFusedByReq.get(bestReqId) || 0) - bestGap) * 100) / 100,
        };
      } else {
        c.whyNotTop = null;
      }
    }
    top.whyNotTop = null;
  }

  return candidateResults;
}

module.exports = { runPipeline };
