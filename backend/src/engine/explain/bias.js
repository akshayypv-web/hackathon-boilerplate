/**
 * JD bias / narrow-phrasing flagging. Owner: C. (Bonus feature 1.)
 *
 * From the problem statement: "Flag potential bias or overly narrow phrasing in
 * the JD itself that could unfairly exclude qualified candidates."
 *
 * Rules-based and fully offline — same reasoning as decompose.js. Each flag
 * names WHO it may exclude, because "this word is biased" is an assertion while
 * "this excludes career-changers" is an argument.
 *
 * Deliberately conservative. A detector that flags every JD is noise, and a
 * false accusation of bias is worse than a miss.
 */

const RULES = [
  // --- gendered language -------------------------------------------------
  {
    pattern: /\b(he|him|his)\s*\/\s*(she|her|hers)\b|\b(s?he)\b(?!\s*\/)|\bhis\/her\b/i,
    category: 'gendered',
    note: 'Gendered pronouns as the default. Neutral phrasing ("they", "the candidate") avoids signalling a preferred gender.',
  },
  {
    pattern: /\b(manpower|man[- ]hours|chairman|salesman|craftsman|workmanlike)\b/i,
    category: 'gendered',
    note: 'Masculine-coded job noun. Research links these to lower application rates from women.',
  },
  {
    pattern: /\b(rockstar|ninja|guru|wizard|superstar|hacker|jedi|beast)\b/i,
    category: 'gendered',
    note: 'Bro-culture coded term. Correlates with lower application rates from women and older candidates, and says nothing about the actual skill required.',
  },
  {
    pattern: /\b(aggressive|dominant|fearless|relentless|cutthroat|killer instinct)\b/i,
    category: 'gendered',
    note: 'Masculine-coded personality language; measurable deterrent in application studies.',
  },

  // --- age proxies -------------------------------------------------------
  {
    pattern: /\b(young|youthful|energetic|digital native|recent grad(uate)?s? only|fresh(er)?s? only|new blood)\b/i,
    category: 'age',
    note: 'Age proxy. Excludes career-changers and experienced candidates returning to study, and in many jurisdictions is legally risky.',
  },
  {
    pattern: /\b(born after|under\s+\d{2}\s*(years old|yrs))\b/i,
    category: 'age',
    note: 'Explicit age limit.',
  },

  // --- institutional elitism --------------------------------------------
  {
    pattern: /\b(tier[- ]?1|tier[- ]?one|iit|nit|bits|ivy league|top[- ](tier|ranked)\s+(college|university|institute)|premier institute)\b/i,
    category: 'elitism',
    note: 'Institutional filter. Excludes strong candidates from non-elite colleges, who are the majority of the applicant pool, and correlates with socioeconomic background rather than ability.',
  },
  {
    pattern: /\b(cgpa|gpa)\s*(of\s*)?(above|over|minimum|min\.?|at least)?\s*[89](\.\d)?\b|\b(first class|distinction)\s+(only|mandatory|required)\b/i,
    category: 'elitism',
    note: 'High academic cutoff used as a hard filter. Weak predictor of engineering performance and excludes candidates who worked through their degree.',
  },
  {
    pattern: /\b(from|of)\s+(a\s+)?(reputed|reputable|prestigious|well[- ]known)\s+(college|university|institute|company)\b/i,
    category: 'elitism',
    note: 'Prestige filter with no objective definition.',
  },

  // --- vague culture language -------------------------------------------
  {
    pattern: /\b(culture[- ]fit|cultural fit|work hard,? play hard|like a family|wear many hats|thrive under pressure|no[- ]excuses)\b/i,
    category: 'vague',
    note: 'Unmeasurable culture language. "Culture fit" in particular is widely documented as a channel for in-group preference.',
  },
  {
    pattern: /\b(must be able to|should be willing to)\s+work\s+(long hours|weekends|nights|overtime|24\/7)\b/i,
    category: 'vague',
    note: 'Availability demand that disproportionately excludes carers and candidates with disabilities, and is rarely a genuine requirement.',
  },
  {
    pattern: /\b(native|mother[- ]tongue)\s+(english|speaker)\b/i,
    category: 'vague',
    note: 'Native-speaker requirement. "Professional working proficiency" describes the actual need without excluding fluent second-language speakers.',
  },
];

/** Seniority implied by the title, and the years-of-experience it can justify. */
const SENIORITY = [
  { pattern: /\b(intern|internship|trainee|apprentice)\b/i, label: 'intern', maxYears: 0 },
  { pattern: /\b(junior|entry[- ]level|graduate|fresher|associate|jr\.?)\b/i, label: 'junior', maxYears: 1 },
  { pattern: /\b(mid[- ]level|intermediate)\b/i, label: 'mid-level', maxYears: 4 },
  { pattern: /\b(senior|lead|principal|staff|head of|manager|architect)\b/i, label: 'senior', maxYears: 99 },
];

const YEARS = /(\d+)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)\b[^.]{0,40}?(?:experience|exp\b)/gi;

function detectSeniority(text) {
  for (const s of SENIORITY) if (s.pattern.test(text)) return s;
  return null;
}

/**
 * Experience demands that exceed what the seniority implies.
 *
 * This is the highest-value check for our JD specifically: asking an INTERN for
 * multiple years of professional experience is the classic entry-level catch-22,
 * and it excludes exactly the students the role is aimed at.
 */
function flagExperienceOverreach(rawText) {
  const seniority = detectSeniority(rawText);
  if (!seniority) return [];

  const out = [];
  let m;
  YEARS.lastIndex = 0;
  while ((m = YEARS.exec(rawText)) !== null) {
    const years = parseInt(m[1], 10);
    if (Number.isNaN(years) || years <= seniority.maxYears) continue;
    out.push({
      phrase: m[0].trim(),
      category: 'overreach',
      note:
        `Asks for ${years}+ years of experience on a role titled "${seniority.label}". ` +
        (seniority.label === 'intern'
          ? 'Interns are students — this is the entry-level catch-22 and excludes the exact population the role targets.'
          : `A ${seniority.label} role rarely justifies ${years}+ years; this filters out capable candidates for an arbitrary number.`),
    });
  }
  return out;
}

/**
 * @param {string} rawJdText
 * @returns {{phrase:string, category:string, note:string}[]}
 */
function flagBias(rawJdText) {
  const text = String(rawJdText || '');
  if (!text.trim()) return [];

  const flags = [];
  const seen = new Set();

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let m;
    while ((m = re.exec(text)) !== null) {
      const phrase = m[0].trim();
      const key = `${rule.category}:${phrase.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push({ phrase, category: rule.category, note: rule.note, context: contextAround(text, m.index, phrase.length) });
      if (!re.global) break;
    }
  }

  for (const f of flagExperienceOverreach(text)) {
    const key = `${f.category}:${f.phrase.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ ...f, context: contextAround(text, text.indexOf(f.phrase), f.phrase.length) });
  }

  return flags;
}

/** A readable snippet so a recruiter can see where the phrase sits. */
function contextAround(text, index, len, pad = 45) {
  if (index < 0) return '';
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + len + pad);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

if (require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  const text = file
    ? fs.readFileSync(file, 'utf8')
    : require('../fixtures/jd.fixture.json').rawText;
  const flags = flagBias(text);
  console.log(`${flags.length} flag(s)\n`);
  for (const f of flags) {
    console.log(`  [${f.category}] "${f.phrase}"`);
    console.log(`     ${f.note}`);
    if (f.context) console.log(`     context: ${f.context}`);
    console.log('');
  }
}

module.exports = { flagBias, detectSeniority };
