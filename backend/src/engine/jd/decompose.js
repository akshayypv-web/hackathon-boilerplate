/**
 * Job Description -> Requirement[]. Owner: C.
 *
 * Rules-based and fully offline BY DESIGN. The real JD arrives at 2pm with the
 * clock running; an LLM call here is a dependency that can rate-limit, time out,
 * or hallucinate a requirement that never existed, at the worst possible moment.
 * Everything below is deterministic and inspectable.
 *
 * ATOMICITY IS THE WHOLE JOB. "Experience with React and Node.js" must become
 * TWO requirements. If it stays one, the matcher can never tell you which half
 * a candidate is missing — and "which required skills appear to be missing" is
 * an explicit deliverable in the problem statement.
 */

const { ALIASES, normalize } = require('../parse/aliases');

/** Headings that flip us between required and preferred. */
const MUST_HEADING = /\b(requirements?|must[- ]haves?|what\s+we(?:'re|\s+are)\s+looking\s+for|you\s+(should|will)\s+have|essential|qualifications|who\s+you\s+are|minimum)\b/i;
const NICE_HEADING = /\b(nice[- ]to[- ]have|bonus|preferred|plus|good[- ]to[- ]have|desirable|optional|advantage|extra\s+credit)\b/i;
const IGNORE_HEADING = /\b(about\s+(us|the\s+(company|role))|responsibilities|what\s+you(?:'ll|\s+will)\s+do|benefits|perks|compensation|how\s+to\s+apply|location|salary)\b/i;

/** Soft/behavioural asks — kept, but weighted down so they cannot drive rank. */
const SOFT = /\b(team\s?player|communication|collaborat|interpersonal|attitude|passionate|self[- ]motivated|eager|willing|proactive|detail[- ]oriented|work\s+ethic|fast[- ]paced)\b/i;
const EDUCATION = /\b(degree|b\.?\s?tech|b\.?\s?sc|bachelor|master|graduate|pursuing|university|college|cgpa|computer\s+science)\b/i;
const EXPERIENCE = /\b(\d+\+?\s*(years?|yrs?)|internship|prior\s+experience|track\s+record|portfolio)\b/i;

const BULLET = /^[\s]*[•▪●○◦‣∙*\-–—]+\s*/;

/** Every alias phrase we know, longest first, for skill detection. */
const SKILL_TERMS = [];
for (const [canonical, aliases] of Object.entries(ALIASES)) {
  SKILL_TERMS.push(canonical, ...aliases);
}
SKILL_TERMS.sort((a, b) => b.length - a.length);

/** Canonical terms present in a phrase, plus their alias sets. */
function skillsIn(phrase) {
  const hay = ` ${normalize(phrase)} `;
  const found = new Set();
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    if (hay.includes(` ${canonical} `)) { found.add(canonical); continue; }
    if (aliases.some((a) => hay.includes(` ${a} `))) found.add(canonical);
  }
  return [...found];
}

function aliasesFor(canonicals) {
  const out = new Set();
  for (const c of canonicals) {
    out.add(c);
    for (const a of ALIASES[c] || []) out.add(a);
  }
  return [...out];
}

/**
 * Split a compound requirement into atomic ones.
 *
 * "Experience with React and Node.js" -> ["Experience with React", "Node.js"]
 * but "Experience with React and a willingness to learn" stays whole, because
 * only one side names a skill. Splitting on every conjunction shreds prose.
 */
function atomise(line) {
  const parts = line
    .split(/\s*(?:,|;|\band\b|\bor\b|\/)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 2) return [line];

  // Only split where at least two fragments independently name a skill.
  const skillful = parts.filter((p) => skillsIn(p).length > 0);
  if (skillful.length < 2) return [line];

  // Re-attach the leading verb phrase to the first fragment only; later
  // fragments stand alone ("Node.js"), which is what we want to match against.
  return parts.filter((p) => p.length > 1);
}

function categoryOf(text) {
  if (EDUCATION.test(text)) return 'education';
  if (SOFT.test(text)) return 'soft';
  if (EXPERIENCE.test(text) && !skillsIn(text).length) return 'experience';
  return 'skill';
}

const WEIGHTS = { skill: 1.0, experience: 0.8, education: 0.6, soft: 0.3 };

/** Core stack terms get a bump — they are what the role actually is. */
const CORE = new Set(['node.js', 'react', 'javascript', 'python', 'java']);

function weightFor(category, canonicals, kind) {
  let w = WEIGHTS[category] ?? 1.0;
  if (category === 'skill' && canonicals.some((c) => CORE.has(c))) w = 1.2;
  if (kind === 'NICE') w = Math.min(w, 0.5);
  return Math.round(w * 100) / 100;
}

const ROLE_NOUN = /\b(Developer|Engineer|Intern|Designer|Analyst|Scientist|Manager|Architect|Consultant)\b/;
const TITLE_WORD = /^[A-Z][A-Za-z+/.]*$/;
const NOT_TITLE = new Set(['A', 'An', 'The', 'For', 'Our', 'We', 'Is', 'At', 'To', 'And', 'Or', 'Join']);

/**
 * Title / company from the opening lines.
 *
 * A single greedy regex grabs the whole sentence — "TechNova Solutions is
 * looking for a Junior Full Stack Developer" all matches [A-Z][A-Za-z ]*Developer
 * because the match starts at the leftmost capital. Instead: find the role noun,
 * then walk LEFT while the preceding words are still title-case.
 */
function extractHeader(lines) {
  const head = lines.slice(0, 6).join(' ');
  const m = head.match(ROLE_NOUN);

  let title = (lines[0] || 'Untitled Role').trim();
  if (m) {
    const words = head.slice(0, m.index + m[0].length).trim().split(/\s+/);
    let start = words.length - 1;
    while (start > 0 && TITLE_WORD.test(words[start - 1]) && !NOT_TITLE.has(words[start - 1])) start -= 1;
    const picked = words.slice(start).join(' ');
    // Trailing qualifier: "... Developer Intern"
    const after = head.slice(m.index + m[0].length).match(/^\s+(Intern|Internship|I{1,3}|Trainee)\b/);
    title = (picked + (after ? ` ${after[1]}` : '')).trim();
  }

  const coMatch = head.match(/\bat\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/)
    || head.match(/^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})\s+(?:is|are)\b/);
  return { title, company: coMatch ? coMatch[1].trim() : '' };
}

/**
 * @param {string} rawText
 * @returns {{title:string, company:string, rawText:string, requirements:object[]}}
 */
function decompose(rawText) {
  const lines = String(rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const { title, company } = extractHeader(lines);

  let kind = 'MUST';   // before any heading, treat asks as required
  let skipping = false;
  const seen = new Set();
  const requirements = [];

  for (const line of lines) {
    const bare = line.replace(BULLET, '').trim();
    if (!bare) continue;

    // Heading lines switch mode and are not themselves requirements.
    const isHeadingish = bare.length < 60 && !/[.!]$/.test(bare);
    if (isHeadingish) {
      if (NICE_HEADING.test(bare)) { kind = 'NICE'; skipping = false; continue; }
      if (MUST_HEADING.test(bare)) { kind = 'MUST'; skipping = false; continue; }
      if (IGNORE_HEADING.test(bare)) { skipping = true; continue; }
    }
    if (skipping) continue;

    // Requirements are bullets, or short declarative lines. Long prose in an
    // "about us" blurb is not a requirement.
    const isBullet = BULLET.test(line);
    if (!isBullet && bare.length > 140) continue;
    if (!isBullet && !skillsIn(bare).length && !EDUCATION.test(bare) && !EXPERIENCE.test(bare)) continue;

    for (const piece of atomise(bare)) {
      const text = piece.replace(/[.;,]+$/, '').trim();
      if (text.length < 3) continue;

      const key = normalize(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const canonicals = skillsIn(text);
      const category = categoryOf(text);

      // A fragment with no skill, no education and no experience signal is
      // filler ("a great attitude") — keep it only as a low-weight soft ask.
      if (!canonicals.length && category === 'skill') continue;

      requirements.push({
        id: `req_${String(requirements.length + 1).padStart(2, '0')}`,
        text,
        kind,
        category,
        aliases: aliasesFor(canonicals),
        weight: weightFor(category, canonicals, kind),
      });
    }
  }

  return { title, company, rawText: String(rawText || ''), requirements };
}

/** CLI: node src/engine/jd/decompose.js path/to/jd.txt */
if (require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  if (!file) { console.log('usage: node decompose.js <jd.txt>'); process.exit(1); }
  const jd = decompose(fs.readFileSync(file, 'utf8'));
  console.log(`${jd.title}${jd.company ? ` @ ${jd.company}` : ''}`);
  console.log(`${jd.requirements.length} requirements\n`);
  for (const r of jd.requirements) {
    console.log(`  ${r.id}  [${r.kind.padEnd(4)} ${r.category.padEnd(10)} w=${r.weight}]  ${r.text}`);
    console.log(`         aliases: ${r.aliases.slice(0, 8).join(', ') || '(none)'}`);
  }
}

module.exports = { decompose, atomise, skillsIn };
