/**
 * Multi-format resume text extraction. Owner: Person A.
 *
 * The graded set is PDF, but the organisers' 220-resume training set is 55%
 * .docx, 10% .xml and 10% .txt. Supporting all four turns 54 usable validation
 * files into 220, and insures us against a mixed-format evaluation set.
 *
 * Every format is normalised into the SAME shape: plain text with section
 * headings on their own lines, so evidence.js handles all of them identically.
 */

const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { extractText: extractPdfText } = require('./pdf');

// ---------------------------------------------------------------- docx

/**
 * Word drops line breaks between a value and the next label during raw text
 * extraction, producing run-together tokens: "SQLBackend:", "Express.jsDatabases:",
 * "SurathkalCGPA:". Left alone, those match nothing and silently delete whole
 * skill groups from a candidate.
 */
function repairRunTogether(text) {
  return text
    // value immediately followed by a "Label:" — the common case
    .replace(/([A-Za-z0-9.)\]])([A-Z][a-z][a-zA-Z&/ ]{0,20}:)/g, '$1\n$2')
    // word followed by an ALL-CAPS label: "SurathkalCGPA:". Requires 3+ trailing
    // lowercase so "MySQL:" is not shredded into "My" / "SQL:".
    .replace(/([a-z]{3,})([A-Z]{2,}[a-zA-Z]*:)/g, '$1\n$2')
    // NOTE: a generic /([A-Z]{2,})([A-Z][a-z])/ rule was tried here to split
    // "MongoDBCloud". It also shreds "APIs" -> "AP"/"Is" and "SQLite" -> "SQ"/"Lite",
    // destroying the exact skill tokens we need. The label rules above already
    // split "MongoDBCloud & Tools:" via its colon, so the generic rule is both
    // redundant and harmful. Do not reintroduce it.
    // ")National Institute" after a date range
    .replace(/(\))([A-Z])/g, '$1\n$2')
    // bullets glued to the previous sentence
    .replace(/([^\n])(•)/g, '$1\n$2')
    .replace(/\n{3,}/g, '\n\n');
}

async function extractDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return repairRunTogether(result.value || '');
}

// ---------------------------------------------------------------- xml

/** XML container tag -> the section heading evidence.js already understands. */
const XML_SECTION_HEADINGS = {
  summary: 'Summary',
  education: 'Education',
  technicalskills: 'Skills',
  skills: 'Skills',
  experience: 'Experience',
  work: 'Experience',
  projects: 'Projects',
  certifications: 'Certifications',
  achievements: 'Achievements',
  activities: 'Activities',
};

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * These XML resumes are semantically tagged, which is richer than any PDF. We
 * walk the tags and emit sectioned plain text so the normal splitter applies.
 */
function extractXml(raw) {
  const out = [];
  const tokenRe = /<(\/?)([a-zA-Z]+)[^>]*>([^<]*)/g;
  let m;

  while ((m = tokenRe.exec(raw)) !== null) {
    const [, closing, tagRaw, tail] = m;
    const tag = tagRaw.toLowerCase();
    const content = decodeEntities((tail || '').replace(/\s+/g, ' ').trim());

    if (!closing && XML_SECTION_HEADINGS[tag]) {
      out.push('', XML_SECTION_HEADINGS[tag]);
    }
    if (!content) continue;

    if (tag === 'name') out.unshift(content);
    else if (tag === 'bullet') out.push(`• ${content}`);
    else if (tag === 'skillgroup' || tag === 'stack') out.push(content);
    else out.push(content);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------- dispatch

const SUPPORTED = ['.pdf', '.docx', '.txt', '.xml'];

/**
 * @param {string} filePath
 * @returns {Promise<{ text: string, ok: boolean, error: string|null, format: string }>}
 */
async function extractAny(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);

  try {
    let text = '';
    if (ext === '.pdf') {
      const r = await extractPdfText(filePath);
      text = r.text;
      if (!r.ok) return { text: '', ok: false, error: r.error, format: 'pdf' };
    } else if (ext === '.docx') {
      text = await extractDocx(filePath);
    } else if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.xml') {
      text = extractXml(fs.readFileSync(filePath, 'utf8'));
    } else {
      return { text: '', ok: false, error: `unsupported extension ${ext}`, format: ext };
    }

    if (text.trim().length < 100) {
      console.warn(`[extract] ${name}: only ${text.trim().length} chars — likely unreadable`);
    }
    return { text, ok: true, error: null, format: ext.slice(1) };
  } catch (err) {
    console.warn(`[extract] ${name}: FAILED — ${err.message}`);
    return { text: '', ok: false, error: err.message, format: ext.slice(1) };
  }
}

/** All supported resume files in a directory, sorted for stable ids. */
function listResumes(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`[extract] directory not found: ${dirPath}`);
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((f) => SUPPORTED.includes(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(dirPath, f));
}

module.exports = { extractAny, listResumes, repairRunTogether, extractXml, SUPPORTED };
