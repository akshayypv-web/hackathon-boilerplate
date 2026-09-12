# Smart Shortlisting Engine

Ranks a pool of resumes against a job description, and explains every ranking by
quoting the resume line that produced it.

**No language model produces any score.** The entire scoring path is BM25 + local
sentence embeddings + deterministic fusion. Delete every model call and the ranking is
byte-identical. That is the core design constraint, and the reason the output is
auditable rather than merely plausible.

See [PITCH.md](PITCH.md) for the demo script, the parameter sweeps, and the judge Q&A.

---

## How it works

```
JD text ──► decompose ──► Requirement[]  (atomic, MUST / NICE, weighted)
                                  │
                                  ▼
                      requirement × evidence matrix
                                  │
resumes ──► parse ──► Candidate[] ┘   for every (requirement, candidate):
            (evidence units)            • BM25 score       ─┐
                                        • cosine on embeddings ─┤ max over the
                                                                │ candidate's claims,
                                                                │ winning claim kept
                                        z-normalise per requirement across the pool
                                        fuse:  alpha·lexical + (1-alpha)·semantic
                                        × multiplicative penalty per missing MUST
                                                                │
                                                                ▼
                                              CandidateScore[] · 0–100 · top-3 explained
```

Four decisions carry the system:

1. **Requirement × evidence matrix**, not one vector per document. A single
   whole-document cosine gives you a number with no idea which line produced it.
2. **Pool z-normalisation per requirement.** Raw cosine puts nearly everyone between
   0.6 and 0.8; normalising per requirement across the pool is what creates real
   separation.
3. **Must-have gate is multiplicative, not averaged** — the brief says loosely-related
   experience must not satisfy an explicitly-named skill, so averaging would be wrong
   by spec.
4. **Negation detection.** "Have never built anything with Node.js" must not count as
   Node.js evidence. This was a real bug: that exact sentence was being cited as proof
   she *had* the skill.

---

## Repo layout

```
backend/
  src/
    index.js                  Express app — boots without any .env
    routes/rank.js            /api/rank, /api/ablation, /api/tune, /api/jds, /api/health
    engine/
      contract.js             FROZEN data contract — every module reads/writes these shapes
      parse/                  resume files -> Candidate[] (PDF, docx, txt, xml)
      jd/decompose.js         JD text -> atomic Requirement[] (rules-based, offline)
      match/                  bm25.js · embed.js · score.js · ablate.js · config.js
      explain/explain.js      top-3 explanations, every claim quoting a real line
      eval/                   tune.js (parameter sweeps) · validateRoles.js (ground truth)
      fixtures/               TechNova JD fixture + 4 other JD templates
frontend/
  src/app/page.js             dashboard: ranked list, mode switch, ablation table
  src/components/ui/          hero + presentational components
data/
  resumes/                    18 synthetic resumes — what /api/rank serves today
  dummy_resumes/              220 role-labelled resumes — the eval/ ground truth set
  testing_dataset/            official test set: Sample_JD.pdf + 18 resumes
```

### The three datasets

They are deliberately separate and not interchangeable:

| Directory | Contents | Used for |
|---|---|---|
| `data/resumes/` | 18 synthetic PDFs | the live demo pool — `/api/rank` reads this |
| `data/dummy_resumes/` | 220 resumes, target role encoded in each filename | ground-truth validation and parameter sweeps |
| `data/testing_dataset/` | `Sample_JD.pdf` + 18 resumes | the official evaluation set |

`data/dummy_resumes/` filenames encode the target role (`SDE_Resume_1`,
`Sales_Resume_2`, `HR_A`), which is what turns "our ranking looks sensible" into a
measured number.

---

## Quick start

Requires Node.js 18+.

**Backend**

```bash
cd backend && npm install && npm run dev
```

Runs on `http://localhost:5000`. It boots fine with no `.env` — Supabase is lazy, and
only the `/api/test-db` routes need it. Copy `backend/.env.example` to `backend/.env`
and fill in `SUPABASE_URL` / `SUPABASE_SECRET_KEY` if you want those.

The first ranking request downloads the embedding model (`Xenova/all-MiniLM-L6-v2`,
~25MB) and is slow. Every embedding is then cached on disk at
`backend/src/engine/.cache/`, so subsequent runs are fast and fully offline.

**Frontend**

```bash
cd frontend && npm install && npm run dev
```

Runs on `http://localhost:3000`. Copy `frontend/.env.example` to `frontend/.env.local`
and set the backend URL:

```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

---

## API

| Method | Route | Description |
|---|---|---|
| POST | `/api/rank` | Rank the pool. Body: `{ jd?, jdId?, mode?, trace? }`. `mode` is `hybrid` (default), `lexical_only`, or `semantic_only`. Sending any of `alpha`, `gateThreshold`, `gatePenaltyPerMiss`, `satisfyThreshold`, `matchBothThreshold` overrides config for that request and bypasses the cache. |
| GET | `/api/ablation` | Runs literal / lexical / semantic / hybrid over the pool and returns the rank comparison. |
| POST | `/api/tune` | Persistently mutates config and clears caches — the live demo slider. |
| GET | `/api/jds` | Lists the 5 JD templates. |
| GET | `/api/jds/:id` | One JD template. Pass its `id` to `/api/rank` as `jdId` to re-rank the same pool against a different role. |
| GET | `/api/health` | Pool size, whether resumes loaded, which modes are cached. |
| POST | `/api/reset-cache` | Clears in-memory result caches. Never touches the embedding cache. |
| GET | `/api/hello`, POST `/api/echo` | Boilerplate leftovers. |
| GET/POST | `/api/test-db` | Supabase connectivity check. Returns 503 if no `.env`. |

`POST /api/rank` with no body ranks `data/resumes/` against the TechNova fixture JD.
Results are cached per `(jdHash, mode)`, so the second identical call is free.

---

## Reproducing the numbers

Every figure in [PITCH.md](PITCH.md) comes from one of these:

```bash
node backend/src/engine/match/runReal.js            # 18 resumes, 4-row ablation table
node backend/src/engine/eval/validateRoles.js       # 220 labelled resumes, precision/purity
node backend/src/engine/eval/tune.js                # the alpha and gate sweeps
node backend/src/engine/match/precompute.js         # write .cache/ablation.json (demo insurance)
```

Parse-quality report over any resume directory — the tool that matters when an unseen
set arrives and you need to know within a minute which files parsed badly:

```bash
node backend/src/engine/parse/loadCandidates.js ./data/testing_dataset
node backend/src/engine/parse/loadCandidates.js ./data/testing_dataset --json out.json
node backend/src/engine/parse/loadCandidates.js ./data/resumes --show cand_03
```

Headline validation result, against a Junior Full Stack JD over the 220 labelled
resumes: RELEVANT (n=59) mean rank **33.1**; IRRELEVANT (n=94) mean rank **166.0**;
precision@top25% **96%**, purity@bottom25% **93%**.

---

## Configuration

All tunables live in [backend/src/engine/match/config.js](backend/src/engine/match/config.js),
each with the sweep that justifies it in a comment:

- `alpha: 0.5` — weight on the lexical side. The endpoints fail in opposite directions:
  semantic-only can't push weak candidates down (purity 71%), keyword-only misses strong
  candidates whose vocabulary differs from the JD's (precision 91%). Hybrid gets both.
- `gateThreshold: 0.45` — a MUST scoring below this counts as missing. Chosen by sweep;
  the previous 0.35 was the worst setting tested on every metric.
- `gatePenaltyPerMiss: 0.75` — one miss costs 25%, two ~44%, three ~58%.
- `bm25: { k1: 1.5, b: 0.75 }` — standard. BM25 rather than TF-IDF because evidence units
  run from two words to twenty-five, and raw TF-IDF over-rewards length.

---

## Known gaps

- **`/api/rank` is pinned to `data/resumes/`.** `RESUMES_DIR` in
  [backend/src/routes/rank.js:38](backend/src/routes/rank.js#L38) is a constant. To rank
  `data/testing_dataset/` through the API, change it there; the CLI tools already take a
  directory argument.
- **`/api/chat` is called by the frontend but not implemented on the backend.** The chat
  panel in [frontend/src/app/page.js](frontend/src/app/page.js) will error until it ships.
- **`data/testing_dataset/Sample_JD.pdf` is not parsed at runtime.** The TechNova JD it
  contains was hand-decomposed into `engine/fixtures/jd.fixture.json`; `jd/decompose.js`
  accepts raw JD *text*, not a PDF.
- **`biasFlags` is always `[]`** in the `/api/rank` response — the field is wired through
  but nothing populates it.

---

## Stack

Next.js 15 (App Router) · React 18 · Tailwind 4 · Express 5 · `@xenova/transformers`
(local embeddings) · `pdf-parse` + `mammoth` (resume extraction) · Supabase (optional)
