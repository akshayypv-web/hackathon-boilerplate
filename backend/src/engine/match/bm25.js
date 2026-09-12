/**
 * BM25 from scratch. Node has libraries for this, but I need to defend each
 * line to judges, so it is hand-written.
 *
 * Corpus = every evidence unit from every candidate, pooled. One evidence
 * unit = one document. That's what lets us take a per-candidate MAX later
 * (in score.js): a candidate can have one killer bullet even if the rest
 * of their resume is mediocre.
 *
 * Formula (Okapi BM25):
 *   score(D, Q) = sum over q in Q of
 *     idf(q) * ( tf(q, D) * (k1 + 1) )
 *              / ( tf(q, D) + k1 * (1 - b + b * |D| / avgdl) )
 *   idf(q) = ln( (N - n(q) + 0.5) / (n(q) + 0.5) + 1 )
 *
 * Tokenizer keeps '+' '#' '.' inside tokens so 'c++', 'c#', 'node.js' survive.
 */

const { bm25: { k1, b } } = require('./config');

const TOKEN_RE = /[a-z0-9+#.]+/g;

function tokenize(text) {
  if (!text) return [];
  return (text.toLowerCase().match(TOKEN_RE) || []).filter(t => t.length > 0);
}

/**
 * Build a BM25 index over an array of {id, text} documents.
 * Returns an opaque index object consumed by score().
 */
function buildIndex(docs) {
  const N = docs.length;
  const docLen = new Map();       // id -> length in tokens
  const tf = new Map();           // id -> Map(term -> freq)
  const df = new Map();           // term -> doc-frequency

  let totalLen = 0;
  for (const d of docs) {
    const toks = tokenize(d.text);
    docLen.set(d.id, toks.length);
    totalLen += toks.length;

    const localTf = new Map();
    for (const t of toks) {
      localTf.set(t, (localTf.get(t) || 0) + 1);
    }
    tf.set(d.id, localTf);
    // df counts unique terms per doc
    for (const t of localTf.keys()) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const avgdl = N > 0 ? totalLen / N : 0;

  // Precompute IDF for every term seen.
  const idf = new Map();
  for (const [term, n] of df.entries()) {
    idf.set(term, Math.log((N - n + 0.5) / (n + 0.5) + 1));
  }

  return { N, avgdl, docLen, tf, idf, docIds: docs.map(d => d.id) };
}

/**
 * Score a query (already tokenized) against one document by id.
 * Returns 0 if the doc is unknown.
 */
function score(index, queryTokens, docId) {
  const local = index.tf.get(docId);
  if (!local) return 0;
  const dl = index.docLen.get(docId) || 0;
  const denomBase = k1 * (1 - b + b * (index.avgdl > 0 ? dl / index.avgdl : 0));

  let s = 0;
  for (const q of queryTokens) {
    const f = local.get(q);
    if (!f) continue;
    const idfq = index.idf.get(q);
    if (!idfq) continue;
    s += idfq * ((f * (k1 + 1)) / (f + denomBase));
  }
  return s;
}

/** Convenience: score against all indexed docs at once. */
function scoreAll(index, queryTokens) {
  const out = new Map();
  for (const id of index.docIds) {
    out.set(id, score(index, queryTokens, id));
  }
  return out;
}

module.exports = { tokenize, buildIndex, score, scoreAll };
