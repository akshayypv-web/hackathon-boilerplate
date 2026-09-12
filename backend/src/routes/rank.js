/**
 * Person D — integration route.
 *
 * Wires parse -> decompose -> score -> explain into POST /api/rank, plus
 * /api/ablation, /api/chat, /api/health.
 *
 * B and C's engine modules (jd/decompose.js, match/score.js, match/ablate.js,
 * explain/explain.js, explain/bias.js, explain/chat.js) don't exist in the repo
 * yet. Rather than block on them, this route tries to require each one and
 * falls back to a small deterministic stub scorer when a module is missing,
 * so the API shape, caching, and frontend can all be built and demoed against
 * the fixtures right now. Once a teammate's file lands, this route picks it up
 * automatically on next server restart — no route changes needed.
 */

const path = require('path');
const fs = require('fs');
const { validatePipelineResult, MODES } = require('../engine/contract');

const CACHE_DIR = path.join(__dirname, '..', 'engine', '.cache');
const CACHE_PATH = path.join(CACHE_DIR, 'pipeline.json');
const RESUMES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'resumes');

const JD_FIXTURE = require('../engine/fixtures/jd.fixture.json');
const CANDIDATES_FIXTURE = require('../engine/fixtures/candidates.fixture.json');

function tryRequire(relPath) {
  try {
    return require(relPath);
  } catch (err) {
    return null;
  }
}

const decomposeEngine = tryRequire('../engine/jd/decompose');
const scoreEngine = tryRequire('../engine/match/score');
const ablateEngine = tryRequire('../engine/match/ablate');
const explainEngine = tryRequire('../engine/explain/explain');
const biasEngine = tryRequire('../engine/explain/bias');

function readCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('[rank] failed to read cache:', err.message);
  }
  return null;
}

function writeCache(result) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2));
  } catch (err) {
    console.warn('[rank] failed to write cache:', err.message);
  }
}

/**
 * STUB scorer — deterministic alias-hit counting, no LLM, no pool
 * normalisation. Only used until Person B's match/score.js exists.
 * Delete this whole function once scoreEngine is real.
 */
function stubScore(jd, candidates, mode) {
  const candidateScores = candidates.map((c) => {
    const requirementScores = jd.requirements.map((r) => {
      const needles = [r.text.toLowerCase(), ...(r.aliases || []).map((a) => a.toLowerCase())];
      let best = { hits: 0, unit: null };
      (c.evidence || []).forEach((e) => {
        const haystack = (e.expanded || e.normalized || e.text || '').toLowerCase();
        const hits = needles.filter((n) => haystack.includes(n)).length;
        if (hits > best.hits) best = { hits, unit: e };
      });
      const raw = best.hits > 0 ? Math.min(1, best.hits / 3) : 0;
      return {
        requirementId: r.id,
        candidateId: c.id,
        lexicalRaw: raw,
        semanticRaw: raw,
        lexicalNorm: raw,
        semanticNorm: raw,
        fused: raw,
        satisfied: raw >= 0.34,
        evidenceId: best.unit ? best.unit.id : null,
        evidenceText: best.unit ? best.unit.text : '',
        matchedBy: best.hits > 0 ? 'lexical' : 'none',
      };
    });

    const missingMustHaves = requirementScores
      .filter((rs, i) => jd.requirements[i].kind === 'MUST' && !rs.satisfied)
      .map((rs) => rs.requirementId);
    const gatePenalty = Math.pow(0.75, missingMustHaves.length);
    const weightSum = jd.requirements.reduce((s, r) => s + r.weight, 0) || 1;
    const base = requirementScores.reduce(
      (s, rs, i) => s + rs.fused * jd.requirements[i].weight,
      0
    ) / weightSum;

    return {
      candidateId: c.id,
      name: c.name,
      finalScore: 0,
      rank: 0,
      requirementScores,
      missingMustHaves,
      gatePenalty,
      explanation: null,
      _raw: base * gatePenalty,
    };
  });

  const rawScores = candidateScores.map((c) => c._raw);
  const min = Math.min(...rawScores);
  const max = Math.max(...rawScores);
  const spread = max - min || 1;

  candidateScores.forEach((c) => {
    c.finalScore = Math.round(((c._raw - min) / spread) * 1000) / 10;
    delete c._raw;
  });

  candidateScores.sort((a, b) => b.finalScore - a.finalScore);
  candidateScores.forEach((c, i) => {
    c.rank = i + 1;
  });

  candidateScores.slice(0, 3).forEach((c) => {
    const matched = c.requirementScores
      .filter((rs) => rs.satisfied)
      .sort((a, b) => b.fused - a.fused)
      .slice(0, 4)
      .map((rs) => ({
        requirementText: jd.requirements.find((r) => r.id === rs.requirementId).text,
        evidenceText: rs.evidenceText,
        score: rs.fused,
        matchedBy: rs.matchedBy,
      }));
    const missing = c.missingMustHaves.map((id) => ({
      requirementText: jd.requirements.find((r) => r.id === id).text,
      kind: 'MUST',
    }));
    const satisfiedCount = c.requirementScores.filter((rs) => rs.satisfied).length;
    c.explanation = {
      summary: `${c.name} satisfies ${satisfiedCount}/${jd.requirements.length} requirements. (stub scoring — replace with match/score.js)`,
      matched,
      missing,
    };
  });

  return candidateScores;
}

function resolveJd(body) {
  if (body && body.jd && Array.isArray(body.jd.requirements)) return body.jd;
  if (decomposeEngine && decomposeEngine.decompose) {
    return decomposeEngine.decompose(JD_FIXTURE.rawText);
  }
  return JD_FIXTURE;
}

function resolveCandidates(body) {
  if (body && Array.isArray(body.candidates) && body.candidates.length) return body.candidates;
  return CANDIDATES_FIXTURE;
}

function buildResult({ jd, candidates, mode }) {
  const usingRealEngine = !!(scoreEngine && scoreEngine.scoreAll);
  let candidateScores;

  if (usingRealEngine) {
    candidateScores = scoreEngine.scoreAll(jd, candidates, mode);
    if (explainEngine && explainEngine.explainTop) {
      explainEngine.explainTop(candidateScores, jd, 3);
    }
  } else {
    candidateScores = stubScore(jd, candidates, mode);
  }

  const biasFlags = biasEngine && biasEngine.flagBias ? biasEngine.flagBias(jd.rawText) : [];

  const result = {
    jd,
    candidates: candidateScores,
    mode,
    biasFlags,
    meta: {
      stub: !usingRealEngine,
      generatedAt: new Date().toISOString(),
    },
  };

  validatePipelineResult(result);
  return result;
}

function runAblation(jd, candidates) {
  if (ablateEngine && ablateEngine.runAblation) {
    return ablateEngine.runAblation(jd, candidates);
  }
  const modes = ['lexical_only', 'semantic_only', 'hybrid'];
  const ranksByCandidate = {};
  modes.forEach((mode) => {
    stubScore(jd, candidates, mode).forEach((c) => {
      ranksByCandidate[c.candidateId] = ranksByCandidate[c.candidateId] || { name: c.name };
      ranksByCandidate[c.candidateId][mode] = c.rank;
    });
  });
  return {
    candidates: candidates.map((c) => {
      const r = ranksByCandidate[c.id];
      return {
        name: r.name,
        lexicalRank: r.lexical_only,
        semanticRank: r.semantic_only,
        hybridRank: r.hybrid,
        delta: r.lexical_only - r.hybrid,
      };
    }),
    meta: { stub: !(ablateEngine && ablateEngine.runAblation) },
  };
}

function handleRank(req, res) {
  const mode = MODES.includes(req.query.mode) ? req.query.mode : 'hybrid';
  const forceFresh = req.query.fresh === 'true' || req.query.fresh === '1';
  const usingCustomInput = !!(req.body && (req.body.jd || req.body.candidates));

  if (!usingCustomInput && !forceFresh) {
    const cached = readCache();
    if (cached && cached.mode === mode) {
      return res.json(cached);
    }
  }

  try {
    const jd = resolveJd(req.body);
    const candidates = resolveCandidates(req.body);
    const result = buildResult({ jd, candidates, mode });
    if (!usingCustomInput) writeCache(result);
    res.json(result);
  } catch (err) {
    console.error('[rank] failed:', err);
    res.status(500).json({ error: err.message });
  }
}

function registerRankRoutes(app) {
  app.post('/api/rank', handleRank);
  app.get('/api/rank', handleRank);

  app.get('/api/ablation', (req, res) => {
    try {
      const jd = resolveJd(null);
      const result = runAblation(jd, CANDIDATES_FIXTURE);
      res.json(result);
    } catch (err) {
      console.error('[ablation] failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat', (req, res) => {
    const chatEngine = tryRequire('../engine/explain/chat');
    const { question, pipelineResult } = req.body || {};
    if (!question || !pipelineResult) {
      return res.status(400).json({ error: 'question and pipelineResult are required' });
    }
    if (chatEngine && chatEngine.answer) {
      Promise.resolve(chatEngine.answer(question, pipelineResult))
        .then((answer) => res.json(answer))
        .catch((err) => res.status(500).json({ error: err.message }));
      return;
    }
    res.json({
      text: `Chat engine not wired yet (stub). You asked: "${question}"`,
      citedCandidates: [],
      quotes: [],
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({
      cache: {
        pipelineCached: fs.existsSync(CACHE_PATH),
        path: CACHE_PATH,
      },
      engines: {
        decompose: !!(decomposeEngine && decomposeEngine.decompose),
        score: !!(scoreEngine && scoreEngine.scoreAll),
        ablate: !!(ablateEngine && ablateEngine.runAblation),
        explain: !!(explainEngine && explainEngine.explainTop),
        bias: !!(biasEngine && biasEngine.flagBias),
        chat: !!tryRequire('../engine/explain/chat'),
      },
      data: {
        resumesDirExists: fs.existsSync(RESUMES_DIR),
        resumesDirCount: fs.existsSync(RESUMES_DIR) ? fs.readdirSync(RESUMES_DIR).length : 0,
      },
    });
  });
}

module.exports = { registerRankRoutes };
