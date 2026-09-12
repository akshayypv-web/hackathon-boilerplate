/**
 * PDF text extraction. Owner: Person A.
 *
 * NOTE: pdf-parse v2 is class-based. The v1 API — `pdf(buffer).then(d => d.text)`
 * — that most tutorials and AI assistants will hand you does NOT work here.
 * The working call is `new PDFParse({ data }).getText()`.
 *
 * Contract: this module NEVER throws. Real resumes arrive at 2pm and we have not
 * seen them. A resume we cannot read must degrade to an empty string and a loud
 * warning, not take the whole run down with it.
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

/** Page furniture that should never become evidence. */
const PAGE_MARKER = /^\s*(--\s*\d+\s+of\s+\d+\s*--|page\s+\d+(\s+of\s+\d+)?|\d+\s*\|\s*page)\s*$/i;

/**
 * Extract raw text from one PDF.
 * @param {string} filePath
 * @returns {Promise<{ text: string, pages: number, ok: boolean, error: string|null }>}
 */
async function extractText(filePath) {
  const name = path.basename(filePath);
  let parser = null;

  try {
    const data = fs.readFileSync(filePath);
    parser = new PDFParse({ data });
    const result = await parser.getText();
    const text = stripPageFurniture(result.text || '');

    if (text.trim().length < 100) {
      console.warn(
        `[pdf] ${name}: only ${text.trim().length} chars extracted. ` +
        `Likely a scanned/image PDF — it will score near zero. Flag this one.`
      );
    }

    return { text, pages: result.total || 0, ok: true, error: null };
  } catch (err) {
    console.warn(`[pdf] ${name}: extraction FAILED — ${err.message}`);
    return { text: '', pages: 0, ok: false, error: err.message };
  } finally {
    // Without this the parser holds worker resources and the CLI hangs on exit.
    if (parser) {
      try { await parser.destroy(); } catch (_) { /* already gone */ }
    }
  }
}

/** Remove page numbers and footer furniture, line by line. */
function stripPageFurniture(text) {
  return text
    .split('\n')
    .filter((line) => !PAGE_MARKER.test(line))
    .join('\n');
}

/** List PDFs in a directory, sorted by filename for stable candidate ids. */
function listPdfs(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`[pdf] directory not found: ${dirPath}`);
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((f) => path.join(dirPath, f));
}

module.exports = { extractText, listPdfs, stripPageFurniture };
