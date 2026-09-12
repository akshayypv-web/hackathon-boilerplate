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

/**
 * Section header patterns, deliberately generous.
 *
 * Real resumes do not agree on headings. Observed in our own test batch:
 * "Work History", "Personal Project", "My Journey So Far", "Things I Did".
 * A tight regex silently dumps those whole sections into "other" and leaves the
 * heading itself sitting in the index as a bogus evidence unit.
 */
/**
 * ORDER IS SIGNIFICANT — first match wins.
 *
 * "PROFESSIONAL SUMMARY" contains both "professional" and "summary". With the
 * experience pattern first it is classified as experience and the candidate's
 * summary prose lands in the wrong section, so summary is tested first.
 * Likewise "Academic Projects" must reach the projects rule before education.
 */
const SECTION_PATTERNS = [
  [/summary|objective|profile|^about|introduction|overview/i, 'other'],
  // "technolog" is anchored: unanchored it swallows "Bachelor of Technology"
  // and "B.Sc. Information Technology" as skills HEADINGS, and headings are
  // never emitted as evidence — so the degree line disappears entirely.
  [/^(technical\s+|core\s+|key\s+|relevant\s+)?skills?|^technolog|competenc|expertise|proficienc|^tools|tech\s+stack/i, 'skills'],
  [/projects?|portfolio|personal\s+(work|project)|side\s+project|things\s+i\s+(did|built|made)|what\s+i\s+built|builds?/i, 'projects'],
  [/experience|employment|work\s+(history|background)|internships?|professional|career|positions?\s+held|journey|roles?/i, 'experience'],
  [/education|academic|qualification|schooling|coursework|degrees?/i, 'education'],
  [/certification|awards?|achievement|publication|activities|extracurricular|interests?|hobbies|languages|references|volunteer/i, 'other'],
];

/**
 * Does this line LOOK like a heading, regardless of wording? Short, titled, no
 * sentence punctuation, not contact info. Used to catch headers we have no
 * keyword for, so they are removed from the index and can be classified by
 * what follows them.
 */
function looksLikeHeader(line) {
  const t = line.trim().replace(/[:\s]+$/, '');
  if (!t || t.length > 40) return false;
  if (BULLET_GLYPH.test(line)) return false;
  if (/[.!?,]$/.test(t)) return false;
  if (t.split(/\s+/).length > 5) return false;
  if (/[@|]|https?:\/\//.test(t)) return false;        // contact / link lines
  if (/\d{4}/.test(t)) return false;                    // "Habit Tracker -- Jan 2023"
  if (!/^[A-Z]/.test(t)) return false;                  // headings start capitalised
  if (LABELLED_CONTENT.test(line)) return false;        // "Languages: Python, SQL"
  if (DEGREE_LINE.test(t)) return false;                // "Bachelor of Technology"
  return true;
}

/**
 * Classify an unrecognised header by the content underneath it.
 * "Things I Did" followed by dated company lines is experience; followed by
 * "Built a ..." is projects.
 */
function inferSectionFromFollowing(lines, startIdx) {
  const lookahead = lines.slice(startIdx + 1, startIdx + 5).join(' ').toLowerCase();
  if (!lookahead.trim()) return 'other';

  const projectish = /\b(built|developed|created|designed|made|implemented)\b.*\b(app|application|website|site|platform|tool|bot|game|clone|system)\b/.test(lookahead);
  const experienceish =
    /\b(intern|internship|engineer|developer|analyst|associate|manager|assistant|executive|consultant)\b/.test(lookahead) ||
    /\b(ltd|inc|pvt|llp|technologies|solutions|labs|systems|corp)\b/.test(lookahead) ||
    /\b(20\d{2})\s*[–—-]\s*(20\d{2}|present|current)\b/.test(lookahead);

  if (experienceish && !projectish) return 'experience';
  if (projectish) return 'projects';
  return 'experience'; // unlabelled narrative on a resume is usually work history
}

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

/**
 * A label with content after it is data, not a heading.
 *
 * "Languages: Python, SQL, C++" matched the spoken-languages rule and flipped the
 * section to "other" right after a real Skills heading, silently costing 55 of
 * 220 resumes their entire skills section. A heading never carries a populated
 * value, so a colon followed by two or more words disqualifies the line.
 */
const LABELLED_CONTENT = /:\s*\S+(\s+|,)\S+/;

/**
 * A degree line is content, never a heading.
 *
 * "Bachelor of Technology" and "B.Sc. Information Technology" are short, titled
 * and unpunctuated, so every structural test passes and they get absorbed as
 * headings — deleting the degree from the evidence entirely, on a JD that has a
 * degree requirement.
 */
const DEGREE_LINE = /\b(b\.?\s?tech|b\.?\s?sc|b\.?\s?e\b|b\.?\s?a\b|m\.?\s?tech|m\.?\s?sc|m\.?\s?a\b|mba|bachelor|master|diploma|ph\.?\s?d)\b/i;

function isSectionHeader(line) {
  const t = line.trim().replace(/[:\s]+$/, '');
  if (!t || t.length > 45) return false;
  if (BULLET_GLYPH.test(line)) return false;
  if (/[.!?,]$/.test(t)) return false;
  if (t.split(/\s+/).length > 5) return false;
  if (LABELLED_CONTENT.test(line)) return false;
  if (DEGREE_LINE.test(t)) return false;
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

/**
 * Negated capability statements. Resumes really do say "No coding, web
 * development, or technical background."
 *
 * Comma-splitting that sentence produces a standalone "web development" unit for
 * a candidate who just told us they have none — a false positive that inflates
 * precisely the candidates who should rank last. We drop the whole clause.
 */
const NEGATION_START = /^(no|not|none|never|without|lacking|zero)\b|^(no|limited|minimal)\s+(coding|technical|programming|software|development|professional)\b/i;

/**
 * Negation stated MID-sentence, which the start-anchored rule misses:
 *
 *   "(Note: no formal source control tooling used outside of zipping folders)"
 *
 * Embeddings match topic, not polarity — "source control tooling" scores as a
 * strong match for a "version control" requirement no matter what precedes it.
 * A candidate who explicitly disclaims a skill must not match on it.
 *
 * Deliberately narrow: a negation cue must be followed by a capability noun, so
 * ordinary phrasing like "not only did I ..." does not trip it.
 */
const NEGATION_ANYWHERE = new RegExp(
  '\\b(no|not|never|without|lacking|zero|nil)\\s+' +
  '(formal\\s+|any\\s+|prior\\s+|professional\\s+|hands[- ]on\\s+|real\\s+|direct\\s+)?' +
  '(experience|exposure|background|knowledge|training|familiarity|tooling|coding|programming' +
  '|technical|software|development|source\\s+control|version\\s+control)\\b',
  'i'
);

/**
 * Verb-form denial: "have never built anything with Node.js", "haven't used
 * React", "no longer work with Java".
 *
 * Caught a real failure: a candidate wrote "Comfortable with backend logic and
 * databases but have never built anything with Node.js" and the engine cited
 * that exact sentence as EVIDENCE SHE HAS NODE.JS. The noun-form patterns above
 * miss it because the negation attaches to a verb, not a capability noun.
 */
const NEGATION_VERB = new RegExp(
  '\\b(never|not|n\'t|nor)\\s+' +
  '(really\\s+|actually\\s+|formally\\s+|yet\\s+|ever\\s+)?' +
  '(built|build|used|use|worked|work|written|write|wrote|touched|coded|code' +
  '|developed|develop|implemented|implement|shipped|deployed|studied|learned)\\b',
  'i'
);

/** "but have never ...", "although I have not ..." — a clause-level reversal. */
const NEGATION_CLAUSE = /\b(but|though|although|however)\s+(i\s+)?(have\s+|has\s+|had\s+)?(never|not|no)\b/i;

/**
 * Hedged capability: "limited hands-on React experience", "minimal exposure to
 * Docker", "basic familiarity with SQL".
 *
 * This is a candidate telling you they are weak at something. Quoting it as
 * evidence that they HAVE the skill — which is what was happening — inverts the
 * meaning. Treated as negated so it never becomes a supporting citation.
 */
const NEGATION_HEDGE = new RegExp(
  '\\b(limited|minimal|little|only\\s+basic|basic|some|no\\s+real)\\s+' +
  '(hands[- ]on\\s+|practical\\s+|professional\\s+|formal\\s+|direct\\s+)?' +
  '(experience|exposure|knowledge|familiarity|understanding|background)\\b',
  'i'
);

function isNegated(text) {
  const t = text.trim();
  return NEGATION_START.test(t) || NEGATION_ANYWHERE.test(t) || NEGATION_VERB.test(t)
    || NEGATION_CLAUSE.test(t) || NEGATION_HEDGE.test(t);
}

/** One line -> one or more claim strings, depending on section. */
function splitIntoClaims(line, section) {
  let text = line.replace(BULLET_GLYPH, '').trim();
  if (!text) return [];

  if (section === 'skills') {
    text = text.replace(SKILL_LABEL, '');

    // Sentence-split FIRST. A skills section often ends with a prose disclaimer,
    // and enumerating "No coding, web development, or technical background"
    // is what manufactures phantom skills. A negated sentence is kept whole and
    // flagged rather than dropped, so the disclaimer stays visible in the parsed
    // output while scoring skips it.
    return text
      .split(/(?<=[.!?])\s+/)
      .flatMap((sentence) => {
        const s = sentence.trim();
        if (!s) return [];
        if (isNegated(s)) return [s];             // keep whole, do not enumerate
        // Protect commas inside parentheses: "AWS (EC2, S3, Lambda)" must not
        // become "AWS (EC2" / "S3" / "Lambda)".
        const guarded = s.replace(/\(([^)]*)\)/g, (m) => m.replace(/,/g, ''));
        return guarded.split(/[,;|]|\s{2,}|[•▪●○◦‣∙]/).map((p) => p.replace(//g, ','));
      })
      .map((s) => s.replace(/[.\s]+$/, '').trim())
      .filter(Boolean);
  }

  // Elsewhere, only split on explicit bullet glyphs. Splitting prose on commas
  // shreds sentences into meaningless fragments.
  return text.split(BULLET_SPLIT).map((s) => s.trim()).filter(Boolean);
}

/** Contact lines are never matchable signal, only index noise. */
const CONTACT_LINE = /^(phone|tel|telephone|mobile|mail|e-?mail|location|address|linked\s?in|github|gitlab|portfolio|website|dob|date of birth)\s*[:\-–]/i;

/**
 * The composite identity banner: "Aditi Sharma a@b.com | +91 98… | github.com/x | Bengaluru".
 * CONTACT_LINE only catches the labelled form ("Email: …"), so this one was
 * passing through as scorable evidence on every single resume.
 */
const CONTACT_MARKER = /@|https?:\/\/|(?:github|linkedin|gitlab)\.com|\+?\d[\d\s()-]{8,}/i;

/**
 * A name, email or handle is not a claim about capability, but scored as one it
 * can satisfy a requirement and then be quoted as the evidence for it. Keep only
 * the place — a location requirement may legitimately match that — and discard
 * the rest of the banner.
 */
function identityLocation(line, name) {
  const nameNorm = normalize(name || '');
  for (const seg of line.split(/\s*[|·•]\s*/)) {
    const s = seg.trim().replace(/[,;]+$/, '');
    if (!s || CONTACT_MARKER.test(s)) continue;
    const n = normalize(s);
    if (!n) continue;
    if (nameNorm && (n === nameNorm || nameNorm.includes(n) || n.includes(nameNorm))) continue;
    if (s.split(/\s+/).length > 4 || !/^[A-Z]/.test(s)) continue;
    return s;
  }
  return null;
}

/**
 * Contact details appearing ANYWHERE in a line, not just as a "Label:" prefix.
 *
 * Resume header lines look like:
 *   "Karthik Iyer karthik.iyer.dev@gmail.com | +91 98xxxxxx03 | github.com/kiyer | Chennai"
 *
 * That line was being cited as EVIDENCE OF GIT EXPERIENCE, because it contains
 * "github.com". A profile URL is not proof you have used version control, and
 * quoting it in an explanation looks careless to anyone reading closely.
 */
const EMAIL_ANYWHERE = /[\w.+-]+@[\w.-]+\.\w{2,}/;
const PROFILE_URL = /\b(?:github|gitlab|linkedin|leetcode|behance|dribbble)\.com\/[\w.-]+/i;

function isNoise(text, section) {
  if (!text) return true;
  if (DATE_ONLY.test(text)) return true;
  if (!/[a-z]/i.test(text)) return true;              // no letters at all
  if (text.length < (MIN_LEN[section] ?? 12)) return true;
  if (CONTACT_LINE.test(text)) return true;
  if (EMAIL_ANYWHERE.test(text)) return true;         // header line with an email
  if (PROFILE_URL.test(text) && /[|·•]|\+?\d{6,}/.test(text)) return true; // contact header
  if (/^(\+?\d[\d\s()-]{7,})$/.test(text)) return true; // bare phone
  if (/^https?:\/\//i.test(text)) return true;        // bare url
  return false;
}

/** Segments that name an institution rather than a qualification. */
const INSTITUTION_WORD = /\b(University|College|Institute|Vidyapeetham|Vishwavidyalaya|Technical Board|Polytechnic|School)\b/i;

/** Degree markers, used to locate the qualification within an education line. */
const DEGREE_MARKER = /\b(B\.?\s?E\.?|B\.?\s?Tech|B\.?\s?Sc|B\.?\s?C\.?A|BBA|B\.?Com|BHM|M\.?\s?Tech|M\.?\s?Sc|MBA|MCA|Diploma|Bachelor|Master)\b/i;

/**
 * Remove the institution from an education line, keeping degree, field, dates
 * and grades.
 *
 * The requirement is "pursuing a degree in Computer Science or related" — the
 * college is not the qualification. Left in, it decided rankings: institution
 * names carry requirement keywords, so "RV College of Engineering" helped
 * satisfy the education must-have while "PES University" did not, and a
 * counterfactual swap of the college alone moved one candidate 26 points of 100.
 * That is institution bias whether or not it tracks anyone's tier list.
 *
 * The name stays in `text` so a recruiter still sees it; only the scored
 * projection drops it. Returns null when no institution can be identified, so
 * the caller leaves the line alone rather than mangling it.
 */
function stripInstitution(line) {
  const segments = String(line).split(/\s*,\s*/);
  if (segments.length < 2) return null;

  const keep = [];
  let dropped = 0;
  segments.forEach((seg, idx) => {
    const isInstitution =
      INSTITUTION_WORD.test(seg) ||
      // Acronym forms carry no keyword ("VIT Vellore", "MANIT Bhopal") and sit
      // directly after the degree.
      (idx === 1 && DEGREE_MARKER.test(segments[0]) && /[A-Z]{2,}/.test(seg));
    if (!isInstitution) { keep.push(seg); return; }
    // A trailing date or grade sharing the segment is not part of the name.
    const tail = seg.match(/\((?:[^)]*)\)\s*.*$/);
    if (tail) keep.push(tail[0]);
    dropped += 1;
  });

  if (!dropped) return null;
  return keep.join(', ').replace(/\s{2,}/g, ' ').replace(/(^[,\s]+|[,\s]+$)/g, '');
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
  const candidateName = extractName(rawText, '');
  let section = 'other';
  let index = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const header = isSectionHeader(line);
    if (header) {
      section = header;
      continue; // the header itself is not evidence
    }

    // Unrecognised wording, but structurally a heading — e.g. "Things I Did".
    // Skip the very first line, which is the candidate's name.
    if (i > 0 && looksLikeHeader(line)) {
      section = inferSectionFromFollowing(lines, i);
      continue;
    }

    // Identity banner in the header region: emit the place, drop everything else.
    if (section === 'other' && i < 6 && CONTACT_MARKER.test(line)) {
      const place = identityLocation(line, candidateName);
      if (place) {
        const text = `Based in ${place}`;
        index += 1;
        units.push({
          id: `${candidateId}::ev_${String(index).padStart(3, '0')}`,
          candidateId,
          text,
          normalized: normalize(text),
          expanded: expandAliases(text),
          section: 'other',
          negated: false,
        });
      }
      continue;
    }

    const claims = splitIntoClaims(line, section)
      .flatMap((c) => splitLongProse(c, section));

    for (const claim of claims) {
      const text = claim.length > MAX_LEN ? `${claim.slice(0, MAX_LEN).trim()}…` : claim;
      if (isNoise(text, section)) continue;

      // Education lines are scored on the qualification, not the institution.
      // `text` keeps the college for display; everything scored comes from
      // `scoredText`.
      const scoredText = (section === 'education' && stripInstitution(text)) || text;

      index += 1;
      units.push({
        id: `${candidateId}::ev_${String(index).padStart(3, '0')}`,
        candidateId,
        text,
        scoredText,
        normalized: normalize(scoredText),   // literal, no alias expansion
        expanded: expandAliases(scoredText), // literal + implied canonical terms
        section,
        negated: isNegated(text),      // candidate is DISCLAIMING this, not claiming it
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
  looksLikeHeader,
  inferSectionFromFollowing,
  toEvidenceUnits,
  extractName,
  mergeWrappedLines,
  isSectionHeader,
  splitIntoClaims,
  isNoise,
};
