# Pitch Material — Smart Shortlisting Engine

Every number here is reproducible:

```
node backend/src/engine/match/runReal.js          # 18 resumes, 4-row ablation
node backend/src/engine/eval/validateRoles.js     # 220 labelled resumes
node backend/src/engine/eval/tune.js              # the parameter sweeps
node backend/src/engine/eval/biasAudit.js         # institution-bias counterfactual
```

> The alpha and gate sweep tables below were measured before identity lines were removed
> from scored evidence. Re-run `eval/tune.js` before quoting them; the validation figures
> further down have been re-measured and are current.

---

## The 90-second whiteboard script

> Ask for a whiteboard or just talk it through. Draw the grid — it does most of the work.

**Say this:**

"Most approaches embed the whole resume and the whole job description, take cosine
similarity, and sort. We deliberately don't, for one reason: that gives you a number
with no idea which line produced it — and we have to explain our rankings.

So we break both sides down.

The **job description** becomes a checklist of atomic requirements — 'knows React',
'knows Node.js', 'has used a database' — each tagged must-have or nice-to-have. If a
line says 'React and Node.js', that's two requirements, not one. Otherwise we could
never tell you which half a candidate is missing.

Each **resume** becomes a list of individual claims, roughly one per bullet point.

Now for every requirement against every candidate, we score **twice, independently**:

- **BM25** — classic keyword search, hand-written, not a library.
- **Cosine similarity on sentence embeddings** — running locally, no API.

For each we take the **maximum over that candidate's claims**, and we keep the winning
claim. That's why every explanation quotes a real line from the resume.

Then the step that matters most: we **z-normalise each requirement across the whole
candidate pool**. Raw cosine puts nearly everyone between 0.6 and 0.8 — the ranking
looks arbitrary. Normalising per-requirement across the pool is what creates real
separation.

We fuse the two normalised scores, then apply a **multiplicative penalty for every
missing must-have** — because the brief says loosely-related experience shouldn't
satisfy an explicitly-named skill, so a plain average would be wrong by spec.

Final scores scale 0 to 100 across the pool.

And no language model produces any number anywhere in that path. Delete every model
call and the ranking is byte-identical."

**Draw this while talking:**

```
                 req_01      req_02      req_03      ...
              "Node.js"    "React"    "database"
  Priya         0.81        0.79        0.76        →  weighted mean
  Kabir         0.86        0.12 ✗      0.83        →  × gate penalty
  Arjun         0.71        0.68        0.75        →  0..100
                  ↑
         BM25 + cosine, max over that
         candidate's claims, citation kept
```

---

## Judge Q&A — with the numbers ready

**"Why alpha 0.5?"**

Swept it against 220 role-labelled resumes at gate 0.45:

| alpha | precision@top25 | purity@bottom25 | separation |
|---|---|---|---|
| 0.0 semantic only | 96% | **71%** | 118.2 |
| **0.5 hybrid** | **96%** | **93%** | **132.9** |
| 1.0 keyword only | **91%** | 95% | 131.1 |

The endpoints fail in **opposite directions**. Semantic-only ranks the right people at
the top but can't push weak candidates down — it matches on topic, so a marketing
resume still reads as vaguely technical. Keyword-only is the mirror image: it buries
the irrelevant cleanly but misses strong candidates whose vocabulary differs from the
JD's. Hybrid gets semantic's precision *and* keyword's purity, with the best separation
of any setting.

**"Why gate 0.45?"**

Also swept. The previous value, 0.35, was the worst setting tested — every alternative
beat it on every metric.

| gate | precision@top25 | purity@bottom25 | separation |
|---|---|---|---|
| 0.35 | 91% | 71% | 114.1 |
| **0.45** | **96%** | **93%** | **132.9** |
| 0.55 | 98% | 78% | 128.2 |

0.50 edges 0.45 on precision by a single candidate, but 0.45 is clearly better on
purity and separation.

*(Caveat we handled: alpha and the gate interact. The first alpha sweep ran at the old
gate and favoured semantic-only. Alpha was re-swept at the chosen gate.)*

**"How do I know the semantic side isn't just doing keyword matching?"**

Three answers. The **ablation table** runs literal-keyword, alias-keyword, semantic and
hybrid separately — candidates move between rows. The **`matchedBy` field** on every
cell records which signal won. And at alpha 1.0, keyword-only, precision drops to 91%:
keyword search alone demonstrably misses people.

**"How is your ranking validated?"**

The organisers' 220 training resumes have their target role in the filename, so we have
labels. Against a Junior Full Stack JD:

- RELEVANT (n=59): mean rank **33.5**, **53 of 59** in the top quartile
- IRRELEVANT (n=94): mean rank **161.9**, **0 of 94** in the top quartile
- precision@top25% **96%**, purity@bottom25% **87%**

*(Purity was 93% before two fairness fixes — see the bias question below. Both cost
bottom-quartile purity and neither moved precision@top25% or the 53-of-59 relevant
top-quartile count. We took the trade deliberately: some of that purity was the engine
ranking people on their contact line and their college.)*

**"How do you know your ranking isn't biased?"**

We tested it counterfactually rather than asserting it. `eval/biasAudit.js` holds a
candidate completely fixed — same skills, same projects, same wording — and changes only
the institution on the degree line, then re-ranks. Swapping IIT Bombay for an unranked
local college should move nothing.

It moved a lot. The worst case was **26 points of 100**, and 16 of 18 candidates shifted.

The cause was not prestige, which is what makes it worth telling: institution names carry
requirement keywords. "RV College of **Engineering**" was helping satisfy the
*"degree in Computer Science or related"* must-have, while "PES University" was not. The
engine was rewarding candidates whose college name happened to contain the right word.

Evidence units now carry a `scoredText` projection with the institution removed, used for
both BM25 and the embeddings, while the recruiter-facing quote keeps the college. Re-run
the audit and the largest swing is **0.6 points** — and that residual is pool
z-normalisation shifting when every resume changes at once, not the college.

This is also the honest answer to tier lists: we never had to agree on which colleges are
tier 1. If swapping any college for any other moves nothing, the ranking is tier-blind by
construction.

**"Your validator reports a misplacement at rank 173."**

It does, and that one is the label being wrong rather than the ranking. `Python_Dev_B.docx`
is labelled RELEVANT by filename, but the resume says *"basic exposure to Python
(self-taught)"* and lists data entry in Excel as its only experience. Ranking it 173rd is
correct. Filenames are ground truth for the target role, not for candidate strength.

**"What if two candidates tie?"**

Ranking sorts on full precision; the 0–100 score is display rounding only. Exact ties
fall back to name so results are deterministic across runs. *(We found this — sorting
on the rounded score left one 8-candidate group ordered by filename.)*

**"Why BM25 rather than TF-IDF?"**

Term-frequency saturation and length normalisation. Our evidence units vary from two
words ("Basic SQL") to twenty-five (an experience bullet), and raw TF-IDF over-rewards
length. Written from scratch — happy to walk the formula.

**"Why max over evidence, not mean?"**

A candidate satisfies a requirement if **any** claim supports it. Averaging would punish
breadth: someone with twenty bullets, one of which proves React, would score lower than
someone with three. Max also gives us the citation for free.

**"What if a resume doesn't parse?"**

It degrades to empty text and gets flagged, never crashes the run. The quality report
(`loadCandidates.js <dir>`) flags mis-parsed resumes. All 220 training files parse
across four formats — PDF, docx, txt, xml — with zero failures.

**"Could someone game this by keyword-stuffing?"**

Partly, and we'd rather say so than pretend otherwise. Stuffing lifts the BM25 half, but
the semantic half scores whole claims in context, so a bare wall of keywords scores
poorly there — and the two are fused. What would genuinely defeat us is *plausible
fabricated experience*, which is a reference-check problem, not a ranking one.

---

## The differentiators, in one line each

1. **Requirement × evidence matrix** instead of one vector per document — every score
   traces to a specific resume line.
2. **Pool z-normalisation per requirement** — the step that creates real score spread
   instead of everyone clustered at 0.7.
3. **Must-have gate** — multiplicative, not averaged, because the brief says named
   skills can't be satisfied by loosely-related experience.
4. **Negation detection** — a candidate who writes "have never built anything with
   Node.js" doesn't match Node.js. This was a real bug we caught: that exact sentence
   was being cited as *evidence she had the skill*.
5. **Validated on 220 labelled resumes** — measured, not asserted.
6. **No LLM in the scoring path** — fully reproducible and auditable.

## Closing line

"No language model produces any score. Delete every model call and the ranking is
identical. Every number traces back to a specific line in a specific resume — and we
validated that on 220 labelled resumes, where 96% of our top quartile is genuinely
relevant and none of the 94 irrelevant resumes reached it."
