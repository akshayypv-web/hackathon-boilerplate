/**
 * Institution-bias audit — does the engine score the college or the candidate?
 *
 * COUNTERFACTUAL, NOT CORRELATIONAL. Checking whether tier-1 graduates happen to
 * rank higher proves nothing: in any realistic pool they may genuinely have the
 * stronger skills, and the correlation would look identical either way.
 *
 * So instead we hold the candidate fixed and change ONLY the institution name,
 * then re-rank. Same skills, same projects, same wording — a different college.
 * If the score moves, the engine is paying attention to the institution.
 *
 * This also sidesteps the argument about which colleges belong in which tier:
 * if swapping an IIT for an unranked local college moves nothing, the ranking is
 * tier-blind regardless of whose tier list you use.
 *
 *   node backend/src/engine/eval/biasAudit.js
 *   node backend/src/engine/eval/biasAudit.js ./data/resumes
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const jd = require(path.join(__dirname, '..', 'fixtures', 'jd.fixture.json'));
const { extractAny, listResumes } = require('../parse/extract');
const { loadFromDir } = require('../parse/loadCandidates');
const { runPipeline } = require('../match/score');

/** Substitutes at opposite ends of any plausible prestige ordering. */
const SWAPS = {
  elite: 'Indian Institute of Technology Bombay',
  unranked: 'Shri Venkateshwara Degree College',
};

/**
 * Movement below this is not institution sensitivity.
 *
 * Every variant swaps all resumes at once, so the per-requirement mean and
 * standard deviation used for pool z-normalisation shift slightly, and that
 * nudges every candidate a fraction of a point. Scores are pool-relative by
 * design — that residual is the normalisation, not the college.
 */
const NOISE_FLOOR = 1.0;

/** Lines that look like a degree line, where the institution sits. */
const EDU_LINE = /\b(B\.?\s?E\.?|B\.?\s?Tech|B\.?\s?Sc|B\.?\s?C\.?A|BBA|B\.?Com|BHM|Diploma|Bachelor|M\.?\s?Tech)\b/i;

/** Institution-ish segment: carries one of these words, or is an acronym + place. */
const INSTITUTION_WORD = /\b(University|College|Institute|Vidyapeetham|Vishwavidyalaya|Technical Board|School)\b/i;

/**
 * Education lines in this corpus are comma-separated:
 *   "B.E. Computer Science, RV College of Engineering, Bengaluru (2023-2027), CGPA: 8.7/10"
 * The degree sits in the first segment and the institution in a later one, so we
 * replace the institution segment and leave the degree, field, year and CGPA
 * untouched. Anything we fail to identify is reported rather than skipped
 * silently — an audit that quietly tests nothing is worse than no audit.
 */
function swapInstitution(text, replacement) {
  const lines = text.split('\n');
  let swapped = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (!EDU_LINE.test(lines[i]) && !INSTITUTION_WORD.test(lines[i])) continue;

    const segments = lines[i].split(/\s*,\s*/);
    let hit = segments.findIndex((s, idx) => idx > 0 && INSTITUTION_WORD.test(s));

    // Acronym forms carry no keyword at all ("VIT Vellore", "MANIT Bhopal").
    // Fall back to the segment right after the degree.
    if (hit === -1 && segments.length > 1 && EDU_LINE.test(segments[0])) {
      const candidate = segments[1] || '';
      if (/[A-Z]{2,}/.test(candidate) || /^[A-Z]/.test(candidate.trim())) hit = 1;
    }
    if (hit === -1) continue;

    // Keep any trailing date/CGPA that shares the segment.
    const tail = segments[hit].match(/\s*\((?:[^)]*)\)\s*.*$/);
    segments[hit] = replacement + (tail ? tail[0] : '');
    lines[i] = segments.join(', ');
    swapped += 1;
  }

  return { text: lines.join('\n'), swapped };
}

async function writeVariant(dir, files, texts) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const base = path.basename(f).replace(/\.[^.]+$/, '.txt');
    fs.writeFileSync(path.join(dir, base), texts[f], 'utf8');
  }
  return dir;
}

async function scoreDir(dir) {
  const candidates = await loadFromDir(dir);
  const ranked = await runPipeline(jd, candidates, { alpha: 0.5, mode: 'hybrid' });
  const byName = new Map();
  for (const c of ranked) byName.set(c.name, { score: c.finalScore, rank: c.rank });
  return byName;
}

async function main() {
  const srcDir = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', 'data', 'testing_dataset', 'resumes');
  const files = listResumes(srcDir);
  if (!files.length) {
    console.error(`no resumes in ${srcDir}`);
    process.exit(1);
  }

  const original = {};
  for (const f of files) {
    const r = await extractAny(f);
    original[f] = r.text;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bias-audit-'));
  const variants = { baseline: {}, elite: {}, unranked: {} };
  const notSwapped = [];

  for (const f of files) {
    variants.baseline[f] = original[f];
    for (const key of ['elite', 'unranked']) {
      const { text, swapped } = swapInstitution(original[f], SWAPS[key]);
      variants[key][f] = text;
      if (!swapped && key === 'elite') notSwapped.push(path.basename(f));
    }
  }

  const dirs = {};
  for (const key of Object.keys(variants)) {
    dirs[key] = await writeVariant(path.join(root, key), files, variants[key]);
  }

  const scores = {};
  for (const key of Object.keys(dirs)) scores[key] = await scoreDir(dirs[key]);

  console.log('\n==========================================================================');
  console.log('INSTITUTION-BIAS AUDIT — same resume, different college');
  console.log(`pool: ${files.length} resumes from ${srcDir}`);
  console.log(`elite substitute   : ${SWAPS.elite}`);
  console.log(`unranked substitute: ${SWAPS.unranked}`);
  console.log('==========================================================================');
  console.log('NAME                 BASE   AS-ELITE  AS-UNRANKED   SPREAD');

  let worst = 0;
  let moved = 0;
  for (const [name, base] of scores.baseline) {
    const e = scores.elite.get(name);
    const u = scores.unranked.get(name);
    if (!e || !u) continue;
    const spread = Math.max(Math.abs(e.score - base.score), Math.abs(u.score - base.score), Math.abs(e.score - u.score));
    if (spread > NOISE_FLOOR) moved += 1;
    worst = Math.max(worst, spread);
    const mark = spread > NOISE_FLOOR ? '  <-- MOVED' : '';
    console.log(
      `${name.padEnd(20)} ${String(base.score).padStart(5)}  ${String(e.score).padStart(8)}  ${String(u.score).padStart(11)}   ${spread.toFixed(2)}${mark}`
    );
  }

  console.log('--------------------------------------------------------------------------');
  console.log(`candidates beyond the noise floor (${NOISE_FLOOR}): ${moved} / ${scores.baseline.size}`);
  console.log(`largest score swing                    : ${worst.toFixed(2)} points (of 100)`);
  if (notSwapped.length) {
    console.log(`\nWARNING — no institution identified, so these were NOT actually tested:`);
    for (const n of notSwapped) console.log(`  ${n}`);
  }
  console.log(
    worst <= NOISE_FLOOR
      ? `\nVERDICT: tier-blind. No score moves by more than ${NOISE_FLOOR} of 100 when the`
        + '\ninstitution changes, so the ranking does not reward the college.'
      : `\nVERDICT: institution affects scoring — up to ${worst.toFixed(2)} points. Investigate`
        + '\nwhich requirement the institution name is matching.'
  );

  fs.rmSync(root, { recursive: true, force: true });
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { swapInstitution, SWAPS };
