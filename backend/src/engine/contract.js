/**
 * ============================================================
 *  FROZEN DATA CONTRACT — Smart Shortlisting Engine
 * ============================================================
 *
 *  Every module under backend/src/engine/ reads and writes THESE shapes.
 *
 *  RULE: Do not rename or remove a field without announcing it out loud
 *  to the whole team. Adding an optional field is always fine.
 *
 *  Ownership:
 *    parse/   -> A (Data & Parsing)
 *    jd/      -> C (JD Decomposition)
 *    match/   -> B (Matching Engine)
 *    explain/ -> C (Explanations)
 *    route    -> D (Demo & Integration)
 */

/** Canonical resume sections. Anything unrecognised becomes 'other'. */
const SECTIONS = ['experience', 'projects', 'skills', 'education', 'other'];

/** How a requirement ended up satisfied. Powers the demo narrative. */
const MATCHED_BY = ['both', 'semantic', 'lexical', 'none'];

/** Pipeline modes — the ablation harness runs all three. */
const MODES = ['hybrid', 'lexical_only', 'semantic_only'];

/**
 * @typedef {Object} EvidenceUnit
 * One atomic claim pulled from a resume — usually a single bullet or line.
 * This is the unit that gets embedded and indexed. Keep them short.
 * @property {string} id           - "cand_03::ev_012"
 * @property {string} candidateId  - "cand_03"
 * @property {string} text         - original text, as written by the candidate
 * @property {string} normalized   - lowercased, punctuation-stripped. NO alias expansion.
 * @property {string} expanded     - normalized PLUS canonical terms implied by aliases
 * @property {string} section      - one of SECTIONS
 *
 * On normalized vs expanded — this distinction exists for the ablation demo.
 * Indexing BM25 on `expanded` lets keyword search find a candidate who wrote
 * "Express" when the JD says "Node.js". That is good for ranking, but it also
 * hides the vocabulary-mismatch problem our pitch depends on showing. Keeping
 * both lets B run literal-keyword and alias-keyword as separate ablation rows.
 */

/**
 * @typedef {Object} Candidate
 * @property {string} id            - "cand_03"
 * @property {string} name          - best-effort extracted name, else filename
 * @property {string} sourceFile    - "resume_03.pdf"
 * @property {string} rawText       - full extracted text (kept for debugging)
 * @property {EvidenceUnit[]} evidence
 * @property {string[]} skillsDeclared - normalized skills from a skills section, if found
 */

/**
 * @typedef {Object} Requirement
 * One atomic, individually-checkable ask from the JD.
 * "Experience with React" is a requirement. "Be a team player who knows
 * React and Node" is THREE requirements — split them.
 * @property {string} id        - "req_01"
 * @property {string} text      - human-readable, used verbatim in explanations
 * @property {string} kind      - "MUST" | "NICE"
 * @property {string} category  - "skill" | "experience" | "education" | "soft"
 * @property {string[]} aliases - expansion set, e.g. ["node","nodejs","express","nestjs"]
 * @property {number} weight    - relative importance, default 1.0
 */

/**
 * @typedef {Object} JobDescription
 * @property {string} title
 * @property {string} company
 * @property {string} rawText
 * @property {Requirement[]} requirements
 */

/**
 * @typedef {Object} RequirementScore
 * One cell of the requirement x candidate matrix. This is the heart of the
 * system — it is what makes explanations grounded instead of hand-wavy.
 * @property {string} requirementId
 * @property {string} candidateId
 * @property {number} lexicalRaw    - raw BM25 score
 * @property {number} semanticRaw   - raw cosine similarity, 0..1
 * @property {number} lexicalNorm   - z-scored across the candidate pool
 * @property {number} semanticNorm  - z-scored across the candidate pool
 * @property {number} fused         - 0..1 after fusion
 * @property {boolean} satisfied    - fused >= satisfyThreshold
 * @property {string|null} evidenceId   - argmax evidence unit (THE CITATION)
 * @property {string} evidenceText      - that unit's original text, for display
 * @property {string} matchedBy         - one of MATCHED_BY
 */

/**
 * @typedef {Object} Explanation
 * @property {string} summary                - 1-2 sentences, recruiter-readable
 * @property {Array<{requirementText: string, evidenceText: string, score: number, matchedBy: string}>} matched
 * @property {Array<{requirementText: string, kind: string}>} missing
 */

/**
 * @typedef {Object} CandidateScore
 * @property {string} candidateId
 * @property {string} name
 * @property {number} rank                  - 1 = best
 * @property {number} finalScore            - 0..100, spread across the pool
 * @property {RequirementScore[]} requirementScores
 * @property {string[]} missingMustHaves    - requirement ids
 * @property {number} gatePenalty           - multiplier applied for missing MUSTs, 0..1
 * @property {Explanation|null} explanation - populated for top 3 only
 */

/**
 * @typedef {Object} BiasFlag
 * @property {string} phrase    - the offending text found in the JD
 * @property {string} category  - "gendered" | "age" | "elitism" | "vague" | "overreach"
 * @property {string} note      - why it may exclude qualified candidates
 */

/**
 * @typedef {Object} PipelineResult
 * The single object the API returns and the UI renders.
 * @property {JobDescription} jd
 * @property {CandidateScore[]} candidates - sorted by rank ascending
 * @property {string} mode                 - one of MODES
 * @property {BiasFlag[]} biasFlags
 * @property {Object} meta
 */

// ------------------------------------------------------------------
// Validators. Call these at module boundaries during integration —
// they turn silent shape drift into a loud error, which is what you
// want at 3pm.
// ------------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) throw new Error(`[contract] ${msg}`);
}

function validateCandidate(c) {
  assert(c && typeof c.id === 'string', 'candidate.id must be a string');
  assert(typeof c.name === 'string', `candidate ${c.id}: name must be a string`);
  assert(Array.isArray(c.evidence), `candidate ${c.id}: evidence must be an array`);
  c.evidence.forEach((e, i) => {
    assert(typeof e.id === 'string', `candidate ${c.id} evidence[${i}]: missing id`);
    assert(typeof e.text === 'string' && e.text.length > 0, `candidate ${c.id} evidence[${i}]: empty text`);
    assert(SECTIONS.includes(e.section), `candidate ${c.id} evidence[${i}]: bad section "${e.section}"`);
  });
  return c;
}

function validateRequirement(r) {
  assert(r && typeof r.id === 'string', 'requirement.id must be a string');
  assert(typeof r.text === 'string' && r.text.length > 0, `requirement ${r.id}: empty text`);
  assert(r.kind === 'MUST' || r.kind === 'NICE', `requirement ${r.id}: kind must be MUST or NICE`);
  assert(Array.isArray(r.aliases), `requirement ${r.id}: aliases must be an array`);
  return r;
}

function validatePipelineResult(res) {
  assert(res && res.jd, 'result.jd missing');
  assert(Array.isArray(res.jd.requirements), 'result.jd.requirements must be an array');
  res.jd.requirements.forEach(validateRequirement);
  assert(Array.isArray(res.candidates), 'result.candidates must be an array');
  assert(MODES.includes(res.mode), `bad mode "${res.mode}"`);
  res.candidates.forEach((c, i) => {
    assert(typeof c.finalScore === 'number' && !Number.isNaN(c.finalScore),
      `candidate[${i}]: finalScore must be a number`);
    assert(c.rank === i + 1, `candidate[${i}]: rank ${c.rank} out of order (expected ${i + 1})`);
  });
  return res;
}

module.exports = {
  SECTIONS,
  MATCHED_BY,
  MODES,
  validateCandidate,
  validateRequirement,
  validatePipelineResult,
};
