/**
 * Raw resume text -> EvidenceUnit[]. Owner: Person A.
 *
 * An "evidence unit" is one atomic claim, usually a single bullet. This is the
 * granularity the whole system depends on: B scores each requirement against
 * these units, and C quotes the winning unit verbatim in explanations. Units that
 * are too coarse (a whole paragraph) match everything weakly; units that are too
 * fine (three words) match nothing.
 *
 * Every rule below was derived from inspecting a real resume PDF, not guessed.
 */

const { normalize, expandAliases } = require('./aliases');

const SECTION_PATTERNS = [
  [/^(work\s+)?experience|^employment|^internships?|^professional/i, 'experience'],
  [/^projects?|^portfolio|^personal\s+work/i, 'projects'],
  [/^(technical\s+|core\s+)?skills?|^technolog|^competenc|^expertise|^proficienc|^tools/i, 'skills'],
  [/^education|^academic|^qualification/i, 'education'],
  [/^summary|^objective|^profile|^about/i, 'other'],
  [/^certification|^awards?|^achievement|^publication|^activities|^extracurricular|^interests?|^hobbies|^languages|^references/i, 'other'],
];

const BULLET_GLYPH = /^[\s]*[•▪●○◦‣∙*−–—-]+\s*/;
const BULLET_SPLIT = /[•▪●○◦‣∙]\s*/;

/** Lines that are only a date or date range carry no matchable signal. */
const DATE_ONLY = new RegExp(
  '^\\(?\\s*(' +
    '\\d{4}' +
    '|\\d{4}\\s*[\\u2013\\u2014-]\\s*(\\d{4}|present|current|now|ongoing)' +
    '|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d{4}' +
      '(\\s*[\\u2013\\u2014-]\\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+)?(\\d{4}|present|current|now))?' +
    '|\\d{1,2}/\\d{4}(\\s*[\\u2013\\u2014-]\\s*(\\d{1,2}/\\d{4}|present))?' +
  ')\\s*\\)?$',
  'i'
);

/** A skills-section label prefix we strip before splitting, e.g. "Technical Skills:" */
const SKILL_LABEL = /^(technical\s+|core\s+|programming\s+|key\s+)?(skills?|technologies|tools|languages|frameworks)\s*[:\-–]\s*/i;

/**
 * Minimum useful length, BY SECTION.
 *
 * A generic 15-char floor looks reasonable and silently destroys skills sections:
 * "Basic SQL" is 9 chars, "Pandas" is 6, "Canva" is 5. Those are exactly the
 * tokens a JD asks for. Prose sections keep a higher floor to drop fragments.
 */
const MIN_LEN = { skills: 2, experience: 12, projects: 12, education: 8, other: 12 };

const MAX_LEN = 300;

function isSectionHeader(line) {
  const t = line.trim().replace(/[:\s]+$/, '');
  if (!t || t.length > 45) return false;
  if (BULLET_GLYPH.test(line)) return false;
  if (/[.!?,]$/.test(t)) return false;
  if (t.split(/\s+/).length > 5) return false;
  for (const [pattern, section] of SECTION_PATTERNS) {
    if (pattern.test(t)) return section;
  }
  return false;
}

/**
 * Rejoin lines that a PDF broke at the right margin.
 * Merge only when BOTH hold: the previous line did not end a sentence, AND this
 * line starts lowercase. Either alone produces false merges.
 */
function mergeWrappedLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const prev = out[out.length - 1];
    const continues =
      prev &&
      !isSectionHeader(prev) &&
      !/[.!?:;]$/.test(prev) &&
      /^[a-z]/.test(line) &&
      !BULLET_GLYPH.test(raw) &&
      !DATE_ONLY.test(line);

    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/** One line -> one or more claim strings, depending on section. */
function splitIntoClaims(line, section) {
  let text = line.replace(BULLET_GLYPH, '').trim();
  if (!text) return [];

  if (section === 'skills') {
    text = text.replace(SKILL_LABEL, '');
    // Skills are usually enumerations; split so each becomes its own unit.
    return text
      .split(/[,;|]|\s{2,}|[•▪●○◦‣∙]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Elsewhere, only split on explicit bullet glyphs. Splitting prose on commas
  // shreds sentences into meaningless fragments.
  return text.split(BULLET_SPLIT).map((s) => s.trim()).filter(Boolean);
}

/** Contact lines are never matchable signal, only index noise. */
const CONTACT_LINE = /^(phone|tel|telephone|mobile|mail|e-?mail|location|address|linked\s?in|github|gitlab|portfolio|website|dob|date of birth)\s*[:\-–]/i;

function isNoise(text, section) {
  if (!text) return true;
  if (DATE_ONLY.test(text)) return true;
  if (!/[a-z]/i.test(text)) return true;              // no letters at all
  if (text.length < (MIN_LEN[section] ?? 12)) return true;
  if (CONTACT_LINE.test(text)) return true;
  if (/^[\w.+-]+@[\w.-]+$/.test(text)) return true;   // bare email
  if (/^(\+?\d[\d\s()-]{7,})$/.test(text)) return true; // bare phone
  if (/^https?:\/\//i.test(text)) return true;        // bare url
  return false;
}

/**
 * Long prose blocks match everything weakly and nothing precisely, because B
 * scores by best-matching unit. Split summaries into sentences so each claim
 * can win on its own merits.
 */
const PROSE_SPLIT_THRESHOLD = 200;

function splitLongProse(claim, section) {
  if (section === 'skills' || claim.length <= PROSE_SPLIT_THRESHOLD) return [claim];
  const sentences = claim
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences.length > 1 ? sentences : [claim];
}

/**
 * @param {string} rawText
 * @param {string} candidateId
 * @returns {import('../contract').EvidenceUnit[]}
 */
function toEvidenceUnits(rawText, candidateId) {
  if (!rawText || !rawText.trim()) {
    console.warn(`[evidence] ${candidateId}: empty text, 0 units`);
    return [];
  }

  const lines = mergeWrappedLines(String(rawText).split('\n'));
  const units = [];
  let section = 'other';
  let index = 0;

  for (const line of lines) {
    const header = isSectionHeader(line);
    if (header) {
      section = header;
      continue; // the header itself is not evidence
    }

    const claims = splitIntoClaims(line, section)
      .flatMap((c) => splitLongProse(c, section));

    for (const claim of claims) {
      const text = claim.length > MAX_LEN ? `${claim.slice(0, MAX_LEN).trim()}…` : claim;
      if (isNoise(text, section)) continue;

      index += 1;
      units.push({
        id: `${candidateId}::ev_${String(index).padStart(3, '0')}`,
        candidateId,
        text,
        normalized: normalize(text),   // literal, no alias expansion
        expanded: expandAliases(text), // literal + implied canonical terms
        section,
      });
    }
  }

  if (units.length < 5) {
    console.warn(`[evidence] ${candidateId}: only ${units.length} units — check parsing quality`);
  }
  return units;
}

/** Best-effort candidate name: first substantial line before any section header. */
function extractName(rawText, fallback) {
  const lines = String(rawText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    if (isSectionHeader(line)) break;
    if (/@|\d{5}|http/.test(line)) continue;                 // contact lines
    const words = line.split(/\s+/);
    if (words.length >= 1 && words.length <= 5 && /^[A-Za-z][A-Za-z.\s'-]+$/.test(line)) {
      return line.replace(/\s+/g, ' ').trim();
    }
  }
  return fallback;
}

module.exports = {
  toEvidenceUnits,
  extractName,
  mergeWrappedLines,
  isSectionHeader,
  splitIntoClaims,
  isNoise,
};
