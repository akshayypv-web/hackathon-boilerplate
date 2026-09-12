# Smart Shortlisting Engine — Team Briefs & Master Prompts

**Hackathon:** InternLoom AI / MIT Manipal
**Task:** Given 1 Job Description + 18 resumes, return a ranked, explainable shortlist.
**Real JD + resumes arrive at 2:00 PM.** Everything before that is built against fixtures.

---

## The Rule That Matters Most

> Pasting a resume + JD into an LLM and asking for "a score out of 100" **does not meet the requirement**
> and scores **zero** on the 35% criterion. Judges will ask you to walk through your matching logic.

**Our boundary, memorise it:**
- LLM **may** be used to: parse the JD into structured requirements, and phrase a final sentence from facts we already computed.
- LLM **may never** produce a number that affects rank.
- **LLM may never touch a resume.** No extraction, no summarisation, no rephrasing of resume content. Resumes flow only through deterministic parsing (pdf-parse + regex + alias dictionary). This is a hard team rule — Person A's pipeline must be 100% rules-based, and no other role may send resume text to an LLM either.
- Test: *delete every LLM call — does the ranking still compute identically?* For us, yes.

---

## Bonus features (all three ship, worth 10%)

From the problem doc. Owner map is fixed — do not renegotiate.

| # | Feature | Owner | File |
|---|---------|-------|------|
| 1 | JD bias flagging (gendered, age proxy, elitism, overreach, vague filler) | **C — Achyuth** | `backend/src/engine/explain/bias.js` |
| 2 | Recruiter chat — "why is X above Y", "who has AWS", "candidates with startup experience" | **C — Achyuth** | `backend/src/engine/explain/chat.js` |
| 3 | Messy resume handling — varied headers, multi-column layout, typo-tolerant skill match, weird date formats | **A — Akshay** | inside `backend/src/engine/parse/*` |

Bonus 2 is broader than the existing `compare.js` scope: it's a small RAG endpoint that takes a free-text question plus the current `PipelineResult`, retrieves the top-K evidence units by embedding cosine (reuse `match/embed.js` — no new model), and returns a grounded answer that cites candidate names + quotes actual resume lines. `compare.js` becomes a special-case shortcut called by the chat when the question matches "why is X above Y".

**Hard gate:** bonuses only ship if the core pipeline is green by 1:45. Do not start bonus code before then.

---

## Rubric (this is the spec, build to it)

| Criterion | Weight | Owner |
|---|---|---|
| Effective use of **both** semantic + keyword matching | **35%** | B |
| Quality/sensibility of ranking | **20%** | B |
| Top-3 explanation accuracy & clarity | **20%** | C |
| Working end-to-end demo | 15% | D |
| Bonus features | 10% | C + D |

Parsing (A) has no direct criterion but gates all four.

---

## Architecture in one paragraph

Each resume is split into **evidence units** (individual bullets/lines). The JD is decomposed into
discrete **requirements** tagged MUST/NICE. For every (requirement × candidate) pair we compute two
independent scores — BM25 lexical and embedding cosine — each taken as the **max over that candidate's
evidence units**, keeping the winning unit as a **citation**. Both scores are z-normalised **across the
candidate pool** (this is what creates score spread), then fused. Missing MUST requirements apply a
multiplicative **gate penalty**. Explanations are generated from the matrix, so every claim cites a real
resume line.

---

## Roles

### A — Data & Parsing
Turns PDFs into clean `Candidate` objects with `EvidenceUnit[]`. Owns the skill alias dictionary.
**Gates everyone**, so ships a fixture first and real parsing second.

### B — Matching Engine *(strongest algorithms person — owns 55% of the score)*
BM25 + embeddings + pool normalisation + fusion + must-have gate + final calibration.
Also owns the **ablation harness** (the single highest-ROI differentiator we have).

### C — JD Decomposition & Explanations
JD text → structured `Requirement[]`. Then top-3 explanations with cited evidence and missing must-haves.
Later: JD bias flagging + "why is X ranked above Y?" comparison.

### D — Integration, Demo & Pitch
Express route, Next.js UI, deployment, and **owns the pitch narrative**. Runs integration checkpoints.
D is the only person who sees all four pieces — so D is the one who explains the system to judges.

---

## Timeline (anchored to the 2:00 PM data drop)

| When | What |
|---|---|
| **Now → +0:20** | Architecture lock. Read `contract.js` together. Nobody writes code yet. |
| **+0:20 → 2:00** | Build everything against fixtures. Target: **full pipeline running on fixtures by 1:45.** |
| **2:00 PM** | Real data drops. A parses it. Everyone else keeps tuning. |
| **2:00 → 2:30** | Swap fixtures for real data. Fix parsing breakage. Verify ranking spread. |
| **2:30 → 3:30** | Tune quality. Ablation table. Bonus features **only if core is green**. |
| **3:30** | **CODE FREEZE.** Cache all embeddings + parsed output to JSON. |
| **3:30 → 4:00** | Two full dry runs of the pitch. Not one. |

**Hard gate:** if the pipeline isn't end-to-end on fixtures by 1:45, cut all bonus features.

---

## Shared files (already in the repo)

- `backend/src/engine/contract.js` — **frozen data shapes.** Read before writing code.
- `backend/src/engine/fixtures/jd.fixture.json` — synthetic TechNova JD, already decomposed.
- `backend/src/engine/fixtures/candidates.fixture.json` — 4 candidates with known fit levels.

`cand_02` (Priya Nair) is deliberately built to be **lexically invisible** — she writes "Express" and
"JSX" but never "Node.js" or "React". Keyword-only search should bury her; hybrid should rescue her.
**She is our demo centrepiece.** If your changes stop rescuing her, something regressed.

---
---

# MASTER PROMPTS

Paste your own block into your AI assistant. Each is self-contained.

---

## PROMPT — Person A (Data & Parsing)

```
I'm in a 4-hour hackathon building a resume shortlisting engine. I own PDF parsing and data prep.
Stack: Node.js + Express, CommonJS (require, not import). Existing repo, backend/ folder.

GOAL: turn a folder of ~18 resume PDFs into clean structured objects that the matching engine consumes.

THE FROZEN DATA CONTRACT — produce exactly these shapes, do not invent fields:

EvidenceUnit = {
  id: "cand_03::ev_012",      // `${candidateId}::ev_${paddedIndex}`
  candidateId: "cand_03",
  text: string,                // original line as the candidate wrote it
  normalized: string,          // lowercased, punctuation stripped, aliases expanded
  section: "experience" | "projects" | "skills" | "education" | "other"
}

Candidate = {
  id: "cand_03",
  name: string,                // best-effort extracted, fall back to filename
  sourceFile: "resume_03.pdf",
  rawText: string,
  evidence: EvidenceUnit[],
  skillsDeclared: string[]     // normalized skills parsed from a skills section, [] if none
}

BUILD THESE FILES:

1. backend/src/engine/parse/pdf.js
   - extractText(filePath) -> Promise<string>. Use pdf-parse.
   - Must not throw on a malformed PDF; return "" and log a warning instead.

2. backend/src/engine/parse/evidence.js
   - toEvidenceUnits(rawText, candidateId) -> EvidenceUnit[]
   Splitting rules:
     * Split on newlines, then on bullet glyphs (•, -, *, ▪, ●) and on ";"
     * Drop lines under 15 chars or with no alphabetic content
     * Merge a line into the previous one if it starts lowercase (PDF line-wrap artifact)
     * Cap each unit at ~300 chars
   Section detection:
     * Track the current section via header lines matching, case-insensitively:
       experience|work|internship  -> "experience"
       project|portfolio           -> "projects"
       skill|technolog|technical   -> "skills"
       education|academic          -> "education"
       anything else               -> "other"
     * A header line is short (<60 chars) and has no sentence-ending punctuation.

3. backend/src/engine/parse/aliases.js
   - A dictionary mapping canonical skill -> alias array. Cover at minimum:
     node.js (node, nodejs, express, expressjs, nestjs, fastify, server-side javascript)
     react (reactjs, react.js, jsx, hooks, redux, next.js)
     mongodb (mongo, mongoose, nosql)
     sql (postgres, postgresql, mysql, sqlite, relational database)
     rest api (rest, restful, endpoint, crud, http api)
     git (github, gitlab, version control, pull request)
     javascript (js, es6, ecmascript, typescript)
     cloud (aws, gcp, azure, vercel, render, heroku, netlify, docker)
     testing (jest, mocha, cypress, vitest, unit test)
   - expandAliases(text) -> string: appends canonical forms when an alias is present, so
     "built with Express" normalizes to "...express... node.js". This is what makes lexical
     matching work on candidates who never write the canonical term.

4. backend/src/engine/parse/loadCandidates.js
   - loadFromDir(dirPath) -> Promise<Candidate[]>, sorted by filename, ids cand_01..cand_NN.

=== BONUS (Bonus 3 from the problem doc — messy resume robustness): ===

Only start this once the four core files above work end-to-end on the fixtures. Add:
- Fuzzy header detection: accept "Technical Skills", "Skillset", "Tech Stack" as `skills`;
  "Work Experience", "Employment", "Professional Experience" as `experience`, etc. Case-insensitive.
- Multi-column PDF handling: if pdf-parse output has wildly uneven line lengths and lots of
  short fragments, fall back to `pdf-parse` with `pagerender` reading `getTextContent()` and
  group `items` by x-coordinate ranges before joining. Keep this behind a flag; do not slow
  down the happy path.
- Date normaliser (`parse/dates.js`): `normaliseDateRange(str)` accepts "Jan 2020 - Present",
  "01/2020 - 03/2022", "2020-2023", "Since 2021", etc. Returns `{ start, end }` in ISO YYYY-MM
  or `null` where unknown. Attach `dateRange` on each EvidenceUnit when its section is "experience".
- Typo tolerance: when a skill token in a resume is within edit distance 1 of a canonical alias
  in `aliases.js`, treat it as a match. Cheap Levenshtein, cap candidate list at the known skill
  set — do not scan every token pair.
- Log a per-candidate parse quality signal (`parseWarnings: string[]`) so D can flag low-quality
  parses in the UI.

Still no LLM. Everything above stays deterministic.

CRITICAL CONSTRAINTS:
- **NO EXTERNAL LLM MAY TOUCH RESUME CONTENT.** Team rule. All extraction is deterministic:
  pdf-parse -> regex splitting -> alias dictionary. No OpenAI / Anthropic / any hosted model
  call anywhere in the parsing pipeline, and no such call may be added later "just for messy
  resumes." If parsing quality is bad, fix the regex and the alias list.
- The real resumes arrive at 2 PM. I have NOT seen them. Write defensively: never throw,
  always return a usable Candidate even if extraction is poor, log what failed.
- Every function must be pure and independently testable. No global state.
- Use only pdf-parse as a new dependency. No heavy NLP libraries.

Write the code with a small CLI I can run as:
  node backend/src/engine/parse/loadCandidates.js ./data/resumes
which prints candidate count, evidence-unit count per candidate, and section distribution,
so I can eyeball parsing quality fast at 2 PM.

Start by writing all four files in full. Then show me the CLI output format.
```

---

## PROMPT — Person B (Matching Engine)

```
I'm in a 4-hour hackathon building a resume shortlisting engine. I own the matching and ranking
engine — it is 55% of our score. Stack: Node.js + Express, CommonJS (require, not import).

THE TASK: given 1 Job Description decomposed into requirements, and ~18 candidates each split into
"evidence units" (individual resume bullets), produce a ranked list with scores plus a per-requirement
matrix that explains every score.

HARD RULE FROM THE ORGANISERS: we may NOT ask an LLM to score a resume. The matching must be our own
logic. Embeddings used as vectors for cosine similarity ARE allowed — that is semantic search, not
LLM scoring. No LLM call may produce a number that affects rank.

INPUT SHAPES (frozen, do not change):

Requirement = { id, text, kind: "MUST"|"NICE", category, aliases: string[], weight: number }
EvidenceUnit = { id, candidateId, text, normalized, section }
Candidate = { id, name, sourceFile, rawText, evidence: EvidenceUnit[], skillsDeclared: string[] }

OUTPUT SHAPES (frozen):

RequirementScore = {
  requirementId, candidateId,
  lexicalRaw, semanticRaw,      // raw BM25, raw cosine 0..1
  lexicalNorm, semanticNorm,    // z-scored ACROSS THE CANDIDATE POOL for this requirement
  fused,                        // 0..1
  satisfied: boolean,
  evidenceId: string|null,      // argmax evidence unit = the citation
  evidenceText: string,
  matchedBy: "both"|"semantic"|"lexical"|"none"
}

CandidateScore = {
  candidateId, name, rank, finalScore,   // finalScore 0..100
  requirementScores: RequirementScore[],
  missingMustHaves: string[],            // requirement ids
  gatePenalty: number,                   // 0..1 multiplier
  explanation: null                      // someone else fills this
}

BUILD THESE FILES:

1. backend/src/engine/match/bm25.js
   Implement BM25 from scratch (k1=1.5, b=0.75). Corpus = every evidence unit from every
   candidate, pooled. Query = requirement text + its aliases, tokenized.
   - buildIndex(allEvidenceUnits) -> index
   - score(index, queryTokens, evidenceId) -> number
   Do NOT use a library. I need to explain this to judges line by line.

2. backend/src/engine/match/embed.js
   - embedAll(texts: string[]) -> Promise<number[][]>
   Use @xenova/transformers with 'Xenova/all-MiniLM-L6-v2', running locally in Node, mean-pooled
   and L2-normalised. No API key, nothing external in the scoring loop — this is a deliberate
   talking point for judges.
   - Must cache to backend/src/engine/.cache/embeddings.json keyed by sha1 of the text, so
     re-runs are instant and the live demo never depends on the network.
   - cosine(a, b) helper.
   Also give me a one-line switch to an HTTP embedding API as a fallback in case the local model
   is too slow — same function signature.

3. backend/src/engine/match/score.js  — THE CORE. This exact order:
   a) For each (requirement, candidate): compute BM25 over that candidate's evidence units,
      take the MAX, remember which unit won.
   b) Same for cosine similarity between the requirement embedding and each evidence embedding.
      Take the MAX, remember the winning unit.
   c) For each requirement INDEPENDENTLY, z-score lexicalRaw and semanticRaw across all candidates.
      THIS STEP IS CRITICAL — raw cosine clusters every candidate in 0.6–0.8 and produces a mushy
      ranking. Pool normalisation is what creates real separation.
   d) fused = sigmoid(alpha * lexicalNorm + (1-alpha) * semanticNorm), alpha default 0.5,
      configurable. Map to 0..1.
   e) matchedBy: "both" if both norms > 0.5, else whichever is, else "none".
   f) MUST-HAVE GATE: if a MUST requirement has fused < gateThreshold (default 0.35), add it to
      missingMustHaves and multiply gatePenalty by 0.75 (compounding). The organisers explicitly
      said loosely-related experience must NOT satisfy an explicitly-named skill — so this cannot
      be a simple weighted average.
   g) base = weighted mean of fused across requirements, using requirement.weight.
      raw = base * gatePenalty.
   h) Scale raw across the pool to 0..100 with min-max, then round to 1 decimal. Sort desc, assign rank.

4. backend/src/engine/match/ablate.js
   - runAblation(jd, candidates) -> runs the pipeline three times: mode "lexical_only" (alpha=1),
     "semantic_only" (alpha=0), "hybrid" (alpha=0.5), and returns a comparison table showing each
     candidate's rank in all three modes plus rank delta.
   This is our single biggest differentiator — it proves to judges that BOTH signals genuinely
   matter. Make the output printable as a clean console table.

VALIDATE AGAINST: backend/src/engine/fixtures/candidates.fixture.json (4 candidates).
cand_02 "Priya Nair" writes "Express" and "JSX" but never "Node.js" or "React". She MUST rank poorly
in lexical_only mode and well in hybrid mode. If she doesn't, the engine is broken. Use her as your
regression test throughout.

All parameters (alpha, k1, b, gateThreshold, satisfyThreshold) must live in one exported config
object so I can tune them live during the demo.

Write bm25.js and score.js in full first — those are the critical path.
```

---

## PROMPT — Person C (JD Decomposition & Explanations)

```
I'm in a 4-hour hackathon building a resume shortlisting engine. I own two things: turning a Job
Description into structured requirements, and generating the top-3 candidate explanations.
Stack: Node.js + Express, CommonJS (require, not import).

Explanations are 20% of our total score, so they must be specific and evidence-backed, never generic.

HARD RULE: an LLM may NOT produce any number that affects ranking. It may extract structure from
the JD, and it may rephrase facts we already computed. Nothing else.

=== PART 1: JD DECOMPOSITION ===

Build backend/src/engine/jd/decompose.js
  decompose(rawJdText) -> { title, company, rawText, requirements: Requirement[] }

Requirement = {
  id: "req_01",
  text: string,               // human-readable, used verbatim in explanations
  kind: "MUST" | "NICE",
  category: "skill" | "experience" | "education" | "soft",
  aliases: string[],          // e.g. node.js -> [node, nodejs, express, nestjs, fastify]
  weight: number              // 1.2 core skills, 1.0 normal, 0.6 education, 0.5 nice-to-have
}

Rules-based, NO LLM required (must work offline — the real JD arrives at 2 PM and I can't risk
an API failure):
- Split the JD into lines/bullets.
- Detect section headers to set MUST vs NICE:
    "requirements", "must have", "what we're looking for", "you should have", "essential" -> MUST
    "nice to have", "bonus", "preferred", "plus", "good to have", "desirable"            -> NICE
    default when no header seen -> MUST
- ATOMICITY IS CRITICAL: "Experience with React and Node.js" must become TWO requirements. Split on
  " and ", " or ", ",", "/" when both sides contain a known skill token. One requirement = one
  checkable thing.
- Drop pure fluff lines ("team player", "good communication") into category "soft" with weight 0.3
  rather than deleting them.
- Attach aliases from the shared dictionary at backend/src/engine/parse/aliases.js (Person A owns it).
- Assign weight by category using the scheme above.

Also give me an optional decomposeWithLLM() that does the same thing via an LLM call for messier JDs,
but the rules version must be the default and must work with zero network access.

=== PART 2: EXPLANATIONS ===

Build backend/src/engine/explain/explain.js
  explainTop(candidateScores, jd, n = 3) -> mutates the top n, setting .explanation

You receive a per-requirement matrix already computed by the matching engine:

RequirementScore = { requirementId, candidateId, lexicalRaw, semanticRaw, lexicalNorm,
  semanticNorm, fused, satisfied, evidenceId, evidenceText, matchedBy }
  // matchedBy is "both" | "semantic" | "lexical" | "none"

Explanation = {
  summary: string,   // 1-2 sentences, recruiter-readable
  matched: [{ requirementText, evidenceText, score, matchedBy }],   // top 4 by fused
  missing: [{ requirementText, kind }]                              // all unsatisfied MUSTs first
}

Rules:
- EVERY matched claim must quote the actual evidenceText from the resume. Never paraphrase into a
  generic statement. "Matched 'Node.js backend' via: 'Built REST APIs with Express and MongoDB'"
  is the goal. "Has strong backend skills" is a failure.
- When matchedBy === "semantic", explicitly say the match was found by meaning rather than exact
  wording. This is the judge-facing proof that our semantic layer earns its place — surface it,
  don't hide it.
- Missing MUST requirements must be stated plainly. Do not soften them.
- Deterministic template first. Optionally add an LLM pass that ONLY rephrases the assembled facts
  into smoother prose — it must receive the structured facts, never the raw resume, and must not
  alter any number.

=== PART 3 (only after 1 and 2 work): BONUS ===

backend/src/engine/explain/bias.js
  flagBias(rawJdText) -> BiasFlag[]  where BiasFlag = { phrase, category, note }
  categories: "gendered" | "age" | "elitism" | "vague" | "overreach"
  Detect: gendered terms (he/she as default, "manpower", "rockstar", "ninja", "guru"),
  age proxies ("young", "digital native", "fresh"), elitism ("tier-1 college", "IIT/NIT only",
  "top university"), vague culture language ("culture fit", "work hard play hard"),
  and OVERREACH — years-of-experience demands that exceed what the seniority implies.
  Our JD is an INTERN role, so any request for 2+ years of professional experience is a flag.
  Each flag needs a one-line note on who it might unfairly exclude.

backend/src/engine/explain/compare.js
  compare(candidateA, candidateB, jd) -> natural-language answer to "Why is X ranked above Y?"
  This is nearly free: diff their requirementScores arrays, find the requirements with the largest
  fused-score gap, and narrate those with citations from both sides.

backend/src/engine/explain/chat.js  (BONUS 2 FROM THE PROBLEM DOC — recruiter chat)
  answer(question, pipelineResult) -> { text, citedCandidates: [candidateId], quotes: [evidenceId] }
  A thin RAG layer over the ranked pool, no new model — reuse Person B's embed.js.

  Question-routing:
    - If the question matches /why is (\w+) (above|higher|better|ranked over) (\w+)/i, delegate to
      compare.js and wrap the result.
    - If it matches /who (has|knows|uses) (.+)/i, embed the skill phrase, cosine-rank all evidence
      units, return top candidates whose top evidence exceeds threshold, with quotes.
    - Otherwise: embed the raw question, cosine-rank all evidence units across the pool,
      take the top-K (K=6) units with their candidate names + scores, and format a grounded answer.

  HARD rules for this file, mirroring the team boundary:
    - Every claim must cite a real evidenceText — never invent, never paraphrase away the quote.
    - No LLM number ever influences ranking. If you use an LLM to prettify the final sentence,
      it receives only the retrieved facts (candidate names, quotes, scores) and returns prose,
      never a number. Deterministic template output must work end-to-end before the LLM pass
      is added.
    - Do not send raw resume text to an LLM — retrieved evidenceText snippets are OK because
      they are already parsed, structured units.

TEST DATA: backend/src/engine/fixtures/jd.fixture.json and candidates.fixture.json.
Build Part 1 and Part 2 fully before touching Part 3.
```

---

## PROMPT — Person D (Integration, Demo & Pitch)

```
I'm in a 4-hour hackathon. I own integration, the demo UI, deployment, and the pitch.
Existing deployed stack: Next.js 15 App Router (JavaScript, not TypeScript, Tailwind v4) on Vercel,
Express 5 backend on Render. Frontend reads process.env.NEXT_PUBLIC_API_URL. CORS is already open.

WHAT THE SYSTEM DOES: ranks ~18 resumes against 1 job description using hybrid keyword + semantic
matching, and explains the top 3 with citations from the actual resume text.

THE API SHAPE MY TEAMMATES ARE BUILDING TO (frozen):

POST /api/rank  ->  PipelineResult

PipelineResult = {
  jd: { title, company, rawText, requirements: [{ id, text, kind: "MUST"|"NICE", category, aliases, weight }] },
  candidates: [{
    candidateId, name, rank, finalScore,          // finalScore 0..100
    requirementScores: [{ requirementId, candidateId, lexicalRaw, semanticRaw,
      lexicalNorm, semanticNorm, fused, satisfied, evidenceId, evidenceText,
      matchedBy: "both"|"semantic"|"lexical"|"none" }],
    missingMustHaves: [requirementId],
    gatePenalty,
    explanation: { summary, matched: [{requirementText, evidenceText, score, matchedBy}],
                   missing: [{requirementText, kind}] } | null   // top 3 only
  }],
  mode: "hybrid" | "lexical_only" | "semantic_only",
  biasFlags: [{ phrase, category, note }],
  meta: {}
}

GET /api/ablation -> { candidates: [{ name, lexicalRank, semanticRank, hybridRank, delta }] }

BUILD:

1. backend/src/routes/rank.js — Express route wiring parse -> decompose -> score -> explain.
   Accept ?mode=hybrid|lexical_only|semantic_only. Return the shape above.
   Serve from a cached JSON file if one exists, so the demo cannot fail on a cold start.

   Also add `POST /api/chat` — body `{ question, pipelineResult }`, delegates to
   `explain/chat.js` (Person C, bonus 2). Returns `{ text, citedCandidates, quotes }`.

2. Frontend page with EXACTLY these four things and nothing else:
   a) Ranked table: rank, name, score (0-100), a bar, and a red badge when missingMustHaves is
      non-empty. All 18 rows visible without scrolling if possible.
   b) Click a top-3 row -> panel showing explanation.summary, each matched requirement with its
      QUOTED evidenceText, and missing must-haves in red.
      When matchedBy === "semantic", show a distinct badge reading "matched by meaning, not keyword".
      That badge is the most important pixel on the screen — it is visible proof our semantic layer
      does real work. Make it obvious.
   c) Ablation view: three-column table comparing each candidate's rank under keyword-only,
      semantic-only, and hybrid, with the rank delta highlighted.
   d) A small panel listing JD bias flags (BONUS 1).
   e) A chat panel (BONUS 2): single input box, sends question to `POST /api/chat` with the
      current pipeline result, renders the answer with clickable candidate-name chips and
      quoted evidence text. Must handle: "why is X above Y", "who knows AWS", "candidates with
      startup experience". Chat history in-memory only, no persistence.

   Dense and readable beats pretty. No charts, no animation, no auth, no file upload, no dark-mode
   toggle. Judges score "working end-to-end demo" at only 15% — the engine is 55%.

3. A /api/health route returning which cached artifacts exist, so I can verify the demo is safe
   to run before I walk on stage.

CONSTRAINTS:
- Reuse the existing Next.js + Express boilerplate. Do not scaffold a new project.
- CommonJS on the backend (require, not import). Frontend is JS, not TS.
- No database. 18 candidates live in memory. We already have Supabase configured and are
  deliberately NOT using it — a vector DB for 18 documents is wasted setup time.

Write the Express route first, then the ranked table, then the explanation panel.
Ablation view and bias panel last.
```

---

## Pitch structure (D owns this, ~5 minutes)

1. **(20s)** Show the ranked list of 18 with real score spread.
2. **(45s)** Open a top-3 explanation. Read a quoted resume line aloud. *"This is why, not just what."*
3. **(90s)** Whiteboard the architecture: requirement × evidence matrix → two independent scorers →
   pool normalisation → fusion → must-have gate.
4. **(60s)** The ablation table. *"Keyword-only buries Priya at #11 because she writes 'Express,'
   not 'Node.js.' Semantic-only floats a weaker candidate. Hybrid fixes both. That's the proof
   both signals genuinely factor in."*
5. **(30s)** Bias flags + "why is X above Y?"
6. **(15s)** *"No LLM produces any score. Delete every LLM call and the ranking is identical.
   Every number traces back to a specific line in a specific resume."*

**Rehearse the answer to "walk me through how your matching actually works."** It will be asked.
