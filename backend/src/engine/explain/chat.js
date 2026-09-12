/**
 * Recruiter chat. Owner: C. (Bonus feature 2.)
 *
 * "Build a simple UI or chat layer where a recruiter can ask, e.g. 'Why is
 * Candidate X ranked above Candidate Y?' and get a natural-language answer."
 *
 * EXTRACTIVE, NOT GENERATIVE. Team rule: no LLM may touch resume content — no
 * extraction, no summarisation, no rephrasing. So every answer here is
 * assembled from the scoring matrix and quotes resume lines verbatim. Nothing
 * is paraphrased and nothing is invented.
 *
 * That constraint turns out to be a feature: a recruiter asking "why is X above
 * Y" wants the actual evidence, not a fluent summary that might drift from it.
 *
 * Four intents, most specific first:
 *   compare   "why is Priya above Kabir"
 *   whoHas    "who knows AWS", "who has used Docker"
 *   whyNot    "why isn't Meera in the top 3"
 *   search    anything else -> semantic retrieval over evidence units
 */

const { embedAll, cosine } = require('../match/embed');
const { normalize } = require('../parse/aliases');

// ---------------------------------------------------------------- helpers

function candidatesByName(result) {
  const m = new Map();
  for (const c of result.candidates) m.set(c.name.toLowerCase(), c);
  return m;
}

/** Resolve a loosely-typed name ("priya", "Priya Sharma") to a candidate. */
function findCandidate(result, fragment) {
  if (!fragment) return null;
  const f = fragment.toLowerCase().trim().replace(/[?.!,]+$/, '');
  const byName = candidatesByName(result);
  if (byName.has(f)) return byName.get(f);

  const partial = result.candidates.filter(
    (c) => c.name.toLowerCase().includes(f) || f.includes(c.name.toLowerCase().split(' ')[0])
  );
  return partial.length === 1 ? partial[0] : (partial[0] || null);
}

function reqTextById(result) {
  const m = new Map();
  for (const r of result.jd.requirements) m.set(r.id, r.text);
  return m;
}

// ---------------------------------------------------------------- intents

/**
 * "Why is X above Y?" — diff the two requirement columns and report the
 * requirements with the largest gaps, quoting both sides.
 */
function answerCompare(result, nameA, nameB) {
  const a = findCandidate(result, nameA);
  const b = findCandidate(result, nameB);
  if (!a || !b) {
    return { text: `I couldn't find ${!a ? `"${nameA}"` : `"${nameB}"`} in this shortlist.`, citedCandidates: [] };
  }
  if (a.candidateId === b.candidateId) {
    return { text: `Those are the same candidate — ${a.name}, ranked #${a.rank}.`, citedCandidates: [a.candidateId] };
  }

  // Ensure "above" reads correctly even if the question named them in the
  // opposite order to their actual ranking.
  const [hi, lo] = a.rank < b.rank ? [a, b] : [b, a];
  const reqText = reqTextById(result);
  const loById = new Map(lo.requirementScores.map((rs) => [rs.requirementId, rs]));

  const gaps = hi.requirementScores
    .map((rs) => ({
      req: reqText.get(rs.requirementId) || rs.requirementId,
      gap: rs.fused - (loById.get(rs.requirementId)?.fused ?? 0),
      hiEv: rs.evidenceText,
      loScore: loById.get(rs.requirementId)?.fused ?? 0,
      loEv: loById.get(rs.requirementId)?.evidenceText,
      loSatisfied: loById.get(rs.requirementId)?.satisfied,
    }))
    .filter((g) => g.gap > 0.02)
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 3);

  const lines = [];
  lines.push(
    `${hi.name} is ranked #${hi.rank} (${hi.finalScore}) and ${lo.name} #${lo.rank} (${lo.finalScore}). ` +
    `The gap comes from ${gaps.length === 1 ? 'one requirement' : `${gaps.length} requirements`}:`
  );

  for (const g of gaps) {
    lines.push('');
    lines.push(`• ${g.req}`);
    if (g.hiEv) lines.push(`   ${hi.name}: "${g.hiEv}"`);
    if (!g.loSatisfied) {
      lines.push(`   ${lo.name}: no supporting evidence found.`);
    } else if (g.loEv) {
      lines.push(`   ${lo.name}: "${g.loEv}"`);
    }
  }

  const loMissing = lo.missingMustHaves || [];
  if (loMissing.length) {
    lines.push('');
    lines.push(
      `${lo.name} is also missing ${loMissing.length} must-have${loMissing.length > 1 ? 's' : ''}: ` +
      `${loMissing.map((id) => reqText.get(id) || id).join('; ')}.`
    );
  }

  return { text: lines.join('\n'), citedCandidates: [hi.candidateId, lo.candidateId], intent: 'compare' };
}

/** "Who knows AWS?" — literal + alias-expanded evidence search. */
function answerWhoHas(result, candidates, skill) {
  const needle = normalize(skill).replace(/[?.!]/g, '').trim();
  if (!needle) return { text: 'Which skill did you mean?', citedCandidates: [] };

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const hits = [];

  for (const c of result.candidates) {
    const parsed = byId.get(c.candidateId);
    if (!parsed) continue;
    for (const ev of parsed.evidence) {
      if (ev.negated) continue;
      const hay = ` ${ev.expanded || ev.normalized} `;
      if (hay.includes(` ${needle} `) || hay.includes(needle)) {
        hits.push({ c, ev });
        break; // one quote per candidate is enough
      }
    }
  }

  if (!hits.length) {
    // Being explicit about a negative result matters — silence reads as a bug.
    const disclaimed = [];
    for (const c of result.candidates) {
      const parsed = byId.get(c.candidateId);
      if (!parsed) continue;
      const neg = parsed.evidence.find((e) => e.negated && e.text.toLowerCase().includes(needle));
      if (neg) disclaimed.push(`${c.name} explicitly says: "${neg.text}"`);
    }
    return {
      text: `No candidate in this shortlist mentions "${skill.trim()}".` +
        (disclaimed.length ? `\n\n${disclaimed.join('\n')}` : ''),
      citedCandidates: [],
      intent: 'whoHas',
    };
  }

  hits.sort((x, y) => x.c.rank - y.c.rank);
  const lines = [`${hits.length} candidate${hits.length > 1 ? 's' : ''} mention "${skill.trim()}":`, ''];
  for (const h of hits.slice(0, 6)) {
    lines.push(`• #${h.c.rank} ${h.c.name} — "${h.ev.text}"`);
  }
  if (hits.length > 6) lines.push(`…and ${hits.length - 6} more.`);

  return { text: lines.join('\n'), citedCandidates: hits.map((h) => h.c.candidateId), intent: 'whoHas' };
}

/** "Why isn't X in the top 3?" */
function answerWhyNot(result, name) {
  const c = findCandidate(result, name);
  if (!c) return { text: `I couldn't find "${name}" in this shortlist.`, citedCandidates: [] };

  const reqText = reqTextById(result);
  const top = result.candidates[0];
  const topById = new Map(top.requirementScores.map((rs) => [rs.requirementId, rs.fused]));

  const worst = c.requirementScores
    .map((rs) => ({ req: reqText.get(rs.requirementId), gap: (topById.get(rs.requirementId) || 0) - rs.fused, rs }))
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 3);

  const lines = [`${c.name} is ranked #${c.rank} of ${result.candidates.length} with a score of ${c.finalScore}.`];

  const missing = c.missingMustHaves || [];
  if (missing.length) {
    lines.push('');
    lines.push(`Missing must-have${missing.length > 1 ? 's' : ''}: ${missing.map((id) => reqText.get(id) || id).join('; ')}.`);
  }
  lines.push('');
  lines.push(`Biggest gaps against #1 (${top.name}):`);
  for (const w of worst) {
    lines.push(`• ${w.req} — ${c.name} scores ${w.rs.fused.toFixed(2)} vs ${(topById.get(w.rs.requirementId) || 0).toFixed(2)}`);
    if (w.rs.evidenceText) lines.push(`   best evidence: "${w.rs.evidenceText}"`);
  }

  return { text: lines.join('\n'), citedCandidates: [c.candidateId, top.candidateId], intent: 'whyNot' };
}

/** Fallback: semantic retrieval over the evidence pool. */
async function answerSearch(result, candidates, question) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const units = [];
  for (const c of result.candidates) {
    const parsed = byId.get(c.candidateId);
    if (!parsed) continue;
    for (const ev of parsed.evidence) {
      if (!ev.negated) units.push({ c, ev });
    }
  }
  if (!units.length) return { text: 'No resume content is loaded.', citedCandidates: [] };

  const [qVec] = await embedAll([question]);
  const vecs = await embedAll(units.map((u) => u.ev.text));

  const scored = units
    .map((u, i) => ({ ...u, score: cosine(qVec, vecs[i]) }))
    .sort((a, b) => b.score - a.score);

  // One quote per candidate, best first.
  const seen = new Set();
  const picks = [];
  for (const s of scored) {
    if (seen.has(s.c.candidateId)) continue;
    seen.add(s.c.candidateId);
    picks.push(s);
    if (picks.length >= 5) break;
  }

  if (!picks.length || picks[0].score < 0.25) {
    return {
      text: `Nothing in these resumes closely matches that. Try naming a skill ("who knows Docker") or comparing two candidates ("why is Priya above Kabir").`,
      citedCandidates: [],
      intent: 'search',
    };
  }

  const lines = ['Closest matches in the resumes:', ''];
  for (const p of picks) {
    lines.push(`• #${p.c.rank} ${p.c.name} — "${p.ev.text}"`);
  }
  return { text: lines.join('\n'), citedCandidates: picks.map((p) => p.c.candidateId), intent: 'search' };
}

// ---------------------------------------------------------------- router

const RE_COMPARE = /why\s+(?:is|was)\s+(.+?)\s+(?:ranked\s+)?(?:above|higher than|better than|over|ahead of|before)\s+(.+?)[?.!]*$/i;
const RE_COMPARE2 = /compare\s+(.+?)\s+(?:and|with|to|vs\.?)\s+(.+?)[?.!]*$/i;
// The verb group repeats: "who HAS USED Docker" stacks two verbs, and matching
// only the first leaves the skill as "used Docker" — a literal string no resume
// contains, so the answer is a confident "nobody", which is worse than an error.
const RE_WHO = /^(?:who|which candidates?)\s+(?:(?:knows?|has|have|had|used?|worked\s+with|is\s+familiar\s+with|familiar\s+with|mentions?|tried|done)\s+)+(.+?)[?.!]*$/i;
const RE_WHYNOT = /why\s+(?:isn'?t|is\s+not|aren'?t)\s+(.+?)\s+(?:in\s+the\s+top|ranked|higher|#?\d)/i;

/**
 * @param {string} question
 * @param {object} pipelineResult  the PipelineResult the UI is showing
 * @param {object[]} candidates    parsed Candidates (for evidence lookup)
 */
async function chat(question, pipelineResult, candidates = []) {
  const q = String(question || '').trim();
  if (!q) return { text: 'Ask me something about this shortlist.', citedCandidates: [] };
  if (!pipelineResult || !pipelineResult.candidates || !pipelineResult.candidates.length) {
    return { text: 'No ranking is loaded yet.', citedCandidates: [] };
  }

  let m = q.match(RE_COMPARE) || q.match(RE_COMPARE2);
  if (m) return answerCompare(pipelineResult, m[1], m[2]);

  m = q.match(RE_WHYNOT);
  if (m) return answerWhyNot(pipelineResult, m[1]);

  m = q.match(RE_WHO);
  if (m) return answerWhoHas(pipelineResult, candidates, m[1]);

  return answerSearch(pipelineResult, candidates, q);
}

module.exports = { chat, answerCompare, answerWhoHas, answerWhyNot };
