/**
 * /api/rank, /api/ablation, /api/health.
 *
 * Owner in the plan is D (Charvis), but B is shipping this now to unblock
 * frontend work while C's decompose/explain/bias/chat is not yet in.
 *
 * Behaviour today:
 *   POST /api/rank
 *     body: { jd?: JobDescription, mode?: "hybrid"|"lexical_only"|"semantic_only" }
 *     Uses the TechNova JD fixture when no jd is supplied. When C ships
 *     jd/decompose.js, accept a raw string too and decompose it here.
 *
 *   GET /api/ablation
 *     Runs the three modes over the current pool and returns a rank
 *     comparison table.
 *
 *   GET /api/health
 *     Reports whether resumes have loaded, the current pool size, and which
 *     modes are cached.
 *
 * Everything is cached in memory the first time it runs. The 18 resumes get
 * parsed once. Per-mode CandidateScore[] arrays are cached per (jdHash, mode)
 * so the second call to /api/rank on the same JD is effectively free.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const jdFixture = require(path.join(__dirname, '..', 'engine', 'fixtures', 'jd.fixture.json'));
const { loadFromDir } = require('../engine/parse/loadCandidates');
const { runPipeline } = require('../engine/match/score');
const { explainTop } = require('../engine/explain/explain');
const { flagBias } = require('../engine/explain/bias');
const { chat } = require('../engine/explain/chat');
const { runAblation } = require('../engine/match/ablate');
const cfg = require('../engine/match/config');

const RESUMES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'resumes');
const ABLATION_DISK_CACHE = path.join(__dirname, '..', 'engine', '.cache', 'ablation.json');
const JD_TEMPLATES_DIR = path.join(__dirname, '..', 'engine', 'fixtures', 'jd_templates');

// Preload every JD template on boot. Also register the fixture as
// "full_stack" so the same UI can list all five.
function _loadJdTemplates() {
  const templates = {
    full_stack: { ...jdFixture, id: 'full_stack' },
  };
  try {
    for (const fname of fs.readdirSync(JD_TEMPLATES_DIR)) {
      if (!fname.endsWith('.json')) continue;
      const jd = JSON.parse(fs.readFileSync(path.join(JD_TEMPLATES_DIR, fname), 'utf8'));
      if (jd && jd.id) templates[jd.id] = jd;
    }
  } catch (err) {
    console.warn(`[jd-templates] load failed: ${err.message}`);
  }
  return templates;
}
const JD_TEMPLATES = _loadJdTemplates();

const router = express.Router();

// ---- module-level caches ---------------------------------------------------

let _candidatesPromise = null;      // Promise<Candidate[]>
const _rankCache = new Map();       // key(jd, mode) -> PipelineResult
const _ablationCache = new Map();   // key(jd) -> ablation payload

function _jdKey(jd) {
  return crypto.createHash('sha1').update(JSON.stringify(jd)).digest('hex').slice(0, 12);
}

function _getCandidates() {
  if (!_candidatesPromise) {
    _candidatesPromise = loadFromDir(RESUMES_DIR).then(cs => {
      console.log(`[rank] loaded ${cs.length} candidates from ${RESUMES_DIR}`);
      return cs;
    }).catch(err => {
      _candidatesPromise = null; // let a later retry succeed
      throw err;
    });
  }
  return _candidatesPromise;
}

function _resolveJd(body) {
  // Precedence: explicit jd object > jdId lookup > raw string > fixture default.
  if (body?.jd && typeof body.jd === 'object') return body.jd;
  if (body?.jdId && JD_TEMPLATES[body.jdId]) return JD_TEMPLATES[body.jdId];
  if (typeof body?.jd === 'string') {
    try {
      const { decompose } = require('../engine/jd/decompose');
      return decompose(body.jd);
    } catch (err) {
      return { ...jdFixture, _warning: 'jd/decompose.js not shipped; used fixture JD' };
    }
  }
  return jdFixture;
}

function _shapeResult(jd, ranked, mode, candidates) {
  // Top-3 explanations are a hard deliverable in the problem statement, not a
  // nice-to-have. `candidates` is passed through so explanations can quote a
  // candidate's own negated claims ("have never built anything with Node.js").
  explainTop(ranked, jd, { candidates, n: 3 });
  return {
    jd,
    candidates: ranked,
    mode,
    biasFlags: flagBias(jd.rawText),
    meta: {
      generatedAt: new Date().toISOString(),
      poolSize: ranked.length,
      config: {
        alpha: cfg.alpha,
        gateThreshold: cfg.gateThreshold,
        gatePenaltyPerMiss: cfg.gatePenaltyPerMiss,
      },
    },
  };
}

// ---- routes ----------------------------------------------------------------

// JD template library. Charvis binds these to a dropdown; picking one calls
// POST /api/rank with { jdId } and the whole pool re-ranks against a totally
// different role. Same 18 resumes, different rankings — great demo moment.
router.get('/jds', (req, res) => {
  const list = Object.values(JD_TEMPLATES).map(jd => ({
    id: jd.id,
    title: jd.title,
    company: jd.company,
    reqCount: (jd.requirements || []).length,
  }));
  res.json({ templates: list });
});

router.get('/jds/:id', (req, res) => {
  const jd = JD_TEMPLATES[req.params.id];
  if (!jd) return res.status(404).json({ error: `no template "${req.params.id}"` });
  res.json(jd);
});

router.get('/health', async (req, res) => {
  const loaded = _candidatesPromise !== null;
  let poolSize = null;
  if (loaded) {
    try { poolSize = (await _candidatesPromise).length; } catch (_) { poolSize = null; }
  }
  res.json({
    ok: true,
    candidatesLoaded: loaded,
    poolSize,
    cachedModes: [..._rankCache.keys()],
    cachedAblations: [..._ablationCache.keys()],
    resumesDir: RESUMES_DIR,
  });
});

// Which body fields count as tuning overrides. If ANY of these are present in
// the request body, we bypass the mode-preset alpha and skip caching (fresh
// compute per slider position). Everything else in cfg still applies unless
// overridden the same way.
const TUNABLE_KEYS = ['alpha', 'gateThreshold', 'gatePenaltyPerMiss', 'satisfyThreshold', 'matchBothThreshold'];

function _extractOverrides(body) {
  const out = {};
  for (const k of TUNABLE_KEYS) if (body && body[k] != null) out[k] = Number(body[k]);
  return out;
}

// Lexical field is a string, not a number — kept separate from the numeric
// tunables. 'expanded' (default) uses Akshay's alias-inflated text so the
// query matches "Node.js" through resume-side "Express". 'normalized' gives
// the literal-keyword ablation row.
function _extractLexicalField(body) {
  if (body && (body.lexicalField === 'normalized' || body.lexicalField === 'expanded')) {
    return body.lexicalField;
  }
  return undefined;
}

router.post('/rank', async (req, res) => {
  try {
    const modeParam = (req.query.mode || req.body?.mode || 'hybrid').toString();
    const validModes = { hybrid: 0.5, lexical_only: 1.0, semantic_only: 0.0 };
    if (!(modeParam in validModes)) {
      return res.status(400).json({ error: `bad mode "${modeParam}" (want hybrid|lexical_only|semantic_only)` });
    }

    const jd = _resolveJd(req.body);
    const overrides = _extractOverrides(req.body);
    const lexicalField = _extractLexicalField(req.body);
    const isTuned = Object.keys(overrides).length > 0 || lexicalField != null;
    const traceOn = String(req.query.trace || req.body?.trace || '') === '1' || req.body?.trace === true;

    const key = `${_jdKey(jd)}:${modeParam}${lexicalField ? `:${lexicalField}` : ''}${traceOn ? ':trace' : ''}`;
    if (!isTuned && _rankCache.has(key)) {
      return res.json(_rankCache.get(key));
    }

    const candidates = await _getCandidates();
    const runOpts = {
      alpha: overrides.alpha != null ? overrides.alpha : validModes[modeParam],
      mode: modeParam,
      trace: traceOn,
      ...overrides,
    };
    if (lexicalField) runOpts.lexicalField = lexicalField;
    const ranked = await runPipeline(jd, candidates, runOpts);
    const result = _shapeResult(jd, ranked, modeParam, candidates);
    if (isTuned) result.meta.tuned = overrides;
    if (traceOn) result.meta.trace = true;
    if (!isTuned) _rankCache.set(key, result);
    res.json(result);
  } catch (err) {
    console.error('[rank] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Persistent tune: mutate cfg + clear result cache. Judges love this during
// live demo — flip a slider on the frontend and every subsequent /api/rank
// respects the new value. Returns the effective config for confirmation.
router.post('/tune', (req, res) => {
  const overrides = _extractOverrides(req.body);
  if (!Object.keys(overrides).length) {
    return res.status(400).json({ error: `body must include at least one of: ${TUNABLE_KEYS.join(', ')}` });
  }
  Object.assign(cfg, overrides);
  _rankCache.clear();
  _ablationCache.clear();
  res.json({
    ok: true,
    applied: overrides,
    config: {
      alpha: cfg.alpha,
      gateThreshold: cfg.gateThreshold,
      gatePenaltyPerMiss: cfg.gatePenaltyPerMiss,
      satisfyThreshold: cfg.satisfyThreshold,
      matchBothThreshold: cfg.matchBothThreshold,
    },
  });
});

router.get('/ablation', async (req, res) => {
  try {
    const jd = jdFixture;
    const key = _jdKey(jd);
    if (_ablationCache.has(key)) return res.json(_ablationCache.get(key));

    // Demo insurance: if precompute.js has written .cache/ablation.json for
    // this jd, serve that directly. Server crashes stop being demo-lethal.
    if (fs.existsSync(ABLATION_DISK_CACHE)) {
      try {
        const disk = JSON.parse(fs.readFileSync(ABLATION_DISK_CACHE, 'utf8'));
        if (disk.jdKey === key) {
          _ablationCache.set(key, disk);
          return res.json(disk);
        }
      } catch (err) {
        console.warn(`[ablation] disk cache unreadable: ${err.message}`);
      }
    }

    const candidates = await _getCandidates();
    const { rows, literal, lexical, semantic, hybrid } = await runAblation(jd, candidates);

    const payload = {
      candidates: rows.map(r => ({
        candidateId: r.candidateId,
        name: r.name,
        literalRank: r.literalRank,
        lexicalRank: r.lexicalRank,
        semanticRank: r.semanticRank,
        hybridRank: r.hybridRank,
        delta: r.litToHybridDelta,
        litToHybridDelta: r.litToHybridDelta,
        lexToHybridDelta: r.lexToHybridDelta,
        semToHybridDelta: r.semToHybridDelta,
      })),
      scores: {
        literal:  literal.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
        lexical:  lexical.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
        semantic: semantic.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
        hybrid:   hybrid.map(c => ({ candidateId: c.candidateId, rank: c.rank, finalScore: c.finalScore })),
      },
      meta: { poolSize: candidates.length, generatedAt: new Date().toISOString() },
    };
    _ablationCache.set(key, payload);
    res.json(payload);
  } catch (err) {
    console.error('[ablation] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Clears the in-memory result caches — useful mid-demo if C ships new
// explanations or D wants to bust a stale cache. Never clears the on-disk
// embedding cache.
router.post('/reset-cache', (req, res) => {
  _rankCache.clear();
  _ablationCache.clear();
  res.json({ ok: true });
});

/**
 * POST /api/chat  { question, pipelineResult? }
 *
 * Extractive only — quotes resume lines, never generates prose about them.
 * If the client does not send a pipelineResult we compute the default ranking,
 * so the endpoint works standalone.
 */
router.post('/chat', async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    const candidates = await _getCandidates();
    let pipelineResult = req.body && req.body.pipelineResult;
    if (!pipelineResult || !pipelineResult.candidates) {
      const jd = _resolveJd(req.body || {});
      const ranked = await runPipeline(jd, candidates, { alpha: cfg.alpha, mode: 'hybrid' });
      pipelineResult = _shapeResult(jd, ranked, 'hybrid', candidates);
    }

    const answer = await chat(String(question), pipelineResult, candidates);
    res.json(answer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
