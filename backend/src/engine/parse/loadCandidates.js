/**
 * Directory of PDFs -> Candidate[]. Owner: Person A.
 *
 * This is the module every other part of the system consumes. It also ships a
 * CLI quality report, which is the tool that matters most at 2pm: 18 unseen
 * resumes arrive and you need to know within a minute which ones parsed badly.
 *
 *   node src/engine/parse/loadCandidates.js ./data/resumes
 *   node src/engine/parse/loadCandidates.js ./data/resumes --json out.json
 *   node src/engine/parse/loadCandidates.js ./data/resumes --show cand_03
 */

const fs = require('fs');
const path = require('path');
const { extractAny, listResumes } = require('./extract');
const { toEvidenceUnits, extractName } = require('./evidence');
const { detectSkills } = require('./aliases');
const { validateCandidate } = require('../contract');

/**
 * @param {string} dirPath
 * @returns {Promise<import('../contract').Candidate[]>}
 */
async function loadFromDir(dirPath) {
  const files = listResumes(dirPath);
  if (!files.length) {
    console.warn(`[load] no resume files found in ${dirPath}`);
    return [];
  }

  const candidates = [];
  const width = String(files.length).length;
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const id = `cand_${String(i + 1).padStart(Math.max(width, 2), '0')}`;
    const { text, ok, format } = await extractAny(file);
    const base = path.basename(file, path.extname(file));

    const candidate = {
      id,
      name: ok ? extractName(text, base) : base,
      sourceFile: path.basename(file),
      sourceFormat: format,
      rawText: text,
      evidence: toEvidenceUnits(text, id),
      skillsDeclared: detectSkills(text),
    };

    try {
      validateCandidate(candidate);
    } catch (err) {
      // Never drop a candidate over a shape complaint — surface it and continue.
      console.warn(`[load] ${id} failed validation: ${err.message}`);
    }
    candidates.push(candidate);
  }
  return candidates;
}

// ---------------------------------------------------------------- quality report

/** Heuristics that flag a resume as probably mis-parsed. */
function diagnose(c) {
  const flags = [];
  const bySection = countSections(c);
  if (c.rawText.trim().length < 200) flags.push('NO_TEXT (scanned image?)');
  if (c.evidence.length < 8) flags.push('FEW_UNITS');
  if (!bySection.skills) flags.push('NO_SKILLS_SECTION');
  if (!bySection.experience && !bySection.projects) flags.push('NO_EXP_OR_PROJECTS');
  if ((bySection.other || 0) / Math.max(c.evidence.length, 1) > 0.6) flags.push('MOSTLY_UNSECTIONED');
  if (!c.skillsDeclared.length) flags.push('NO_KNOWN_SKILLS');
  return flags;
}

function countSections(c) {
  const out = {};
  for (const u of c.evidence) out[u.section] = (out[u.section] || 0) + 1;
  return out;
}

function report(candidates) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`PARSE QUALITY REPORT — ${candidates.length} candidates`);
  console.log('='.repeat(78));
  console.log(
    'ID'.padEnd(9) + 'NAME'.padEnd(22) + 'UNITS'.padEnd(7) +
    'exp/prj/skl/edu/oth'.padEnd(21) + 'FLAGS'
  );
  console.log('-'.repeat(78));

  let totalUnits = 0;
  const problems = [];

  for (const c of candidates) {
    const s = countSections(c);
    const dist = [s.experience || 0, s.projects || 0, s.skills || 0, s.education || 0, s.other || 0].join('/');
    const flags = diagnose(c);
    totalUnits += c.evidence.length;
    if (flags.length) problems.push(c.id);

    console.log(
      c.id.padEnd(9) +
      c.name.slice(0, 20).padEnd(22) +
      String(c.evidence.length).padEnd(7) +
      dist.padEnd(21) +
      (flags.length ? flags.join(', ') : 'ok')
    );
  }

  console.log('-'.repeat(78));
  const avg = (totalUnits / Math.max(candidates.length, 1)).toFixed(1);
  console.log(`total units: ${totalUnits}   avg/candidate: ${avg}`);

  if (problems.length) {
    console.log(`\n⚠  ${problems.length} candidate(s) need a look: ${problems.join(', ')}`);
    console.log(`   inspect with:  --show ${problems[0]}`);
  } else {
    console.log('\n✓ all candidates parsed cleanly');
  }

  // Healthy resumes land ~20-45 units. Far outside that means the splitter is
  // misbehaving on this batch's formatting.
  if (avg < 12) console.log('⚠  avg units very low — splitting may be too aggressive at dropping lines');
  if (avg > 70) console.log('⚠  avg units very high — lines may be over-split into fragments');
  console.log('');
}

function showCandidate(candidates, id) {
  const c = candidates.find((x) => x.id === id || x.sourceFile === id);
  if (!c) return console.log(`no such candidate: ${id}`);
  console.log(`\n${c.id} — ${c.name}  (${c.sourceFile})`);
  console.log(`skills detected: ${c.skillsDeclared.join(', ') || '(none)'}\n`);
  for (const u of c.evidence) {
    console.log(`[${u.section.padEnd(10)}] ${u.text}`);
  }
  console.log('');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir) {
    console.log('usage: node loadCandidates.js <dir> [--json out.json] [--show cand_03]');
    process.exit(1);
  }
  loadFromDir(dir).then((candidates) => {
    const showIdx = args.indexOf('--show');
    if (showIdx !== -1) showCandidate(candidates, args[showIdx + 1]);
    else report(candidates);

    const jsonIdx = args.indexOf('--json');
    if (jsonIdx !== -1) {
      const out = args[jsonIdx + 1] || 'candidates.json';
      fs.writeFileSync(out, JSON.stringify(candidates, null, 2));
      console.log(`wrote ${out}`);
    }
  });
}

module.exports = { loadFromDir, diagnose, countSections };
