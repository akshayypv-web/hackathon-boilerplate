'use client';

import { useEffect, useState } from 'react';
import { Send, TriangleAlert, Flag, Sparkles } from 'lucide-react';
import { ImageStreamHero } from '@/components/ui/image-stream-hero';
import { RESUME_MOCKUPS } from '@/lib/resume-mockups';

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const MODES = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'lexical_only', label: 'Keyword only' },
  { value: 'semantic_only', label: 'Semantic only' },
];

export default function Home() {
  const [mode, setMode] = useState('hybrid');
  const [result, setResult] = useState(null);
  const [ablation, setAblation] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    setError(null);
    fetch(`${API_URL}/api/rank?mode=${mode}`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResult(data);
        const top = data.candidates.find((c) => c.explanation);
        setSelectedId(top ? top.candidateId : null);
      })
      .catch((err) => setError(err.message));
  }, [mode]);

  useEffect(() => {
    fetch(`${API_URL}/api/ablation`)
      .then((res) => res.json())
      .then(setAblation)
      .catch(() => {});
  }, []);

  async function sendChat(e) {
    e.preventDefault();
    const question = chatInput.trim();
    if (!question || !result) return;
    setChatHistory((h) => [...h, { role: 'user', text: question }]);
    setChatInput('');
    setChatBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, pipelineResult: result }),
      });
      const data = await res.json();
      setChatHistory((h) => [
        ...h,
        { role: 'assistant', text: data.text, citedCandidates: data.citedCandidates || [] },
      ]);
    } catch (err) {
      setChatHistory((h) => [...h, { role: 'assistant', text: `Error: ${err.message}`, citedCandidates: [] }]);
    } finally {
      setChatBusy(false);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-full items-center justify-center bg-background p-8">
        <p className="max-w-md text-center font-sans text-danger">
          Failed to load pipeline result from {API_URL}: {error}
        </p>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="flex min-h-full items-center justify-center bg-background">
        <p className="font-sans text-muted">Loading pipeline result…</p>
      </main>
    );
  }

  const selected = result.candidates.find((c) => c.candidateId === selectedId);

  return (
    <main className="min-h-full bg-background text-foreground">
      <section className="relative h-[62vh] min-h-[420px] max-h-[720px] w-full overflow-hidden border-b border-border">
        <ImageStreamHero images={RESUME_MOCKUPS} cards={9} speed={18} className="h-full w-full">
          <div className="relative z-10 flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_50%_at_50%_45%,rgba(10,10,10,0.6),transparent_70%)]" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-sans text-xs font-semibold uppercase tracking-widest text-accent">
              <Sparkles className="h-3.5 w-3.5" /> Smart shortlisting
            </span>
            <h1 className="font-display text-6xl font-semibold tracking-tight text-foreground [text-shadow:0_4px_28px_rgba(0,0,0,0.65)] sm:text-7xl lg:text-8xl">
              LINKED OUT
            </h1>
            <p className="max-w-xl font-sans text-base text-muted [text-shadow:0_2px_16px_rgba(0,0,0,0.7)] sm:text-lg">
              Ranks eighteen resumes against one job description and shows exactly which line earned every point.
            </p>
          </div>
        </ImageStreamHero>
      </section>

      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="mb-1 font-sans text-xs uppercase tracking-widest text-muted">{result.jd.company}</p>
            <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{result.jd.title}</h2>
          </div>
          <div className="flex gap-1 rounded-full border border-border bg-surface p-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`rounded-full px-4 py-1.5 font-sans text-xs font-semibold transition-colors ${
                  mode === m.value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </header>

        {result.meta?.stub && (
          <p className="rounded-xl border border-gold/30 bg-gold-bg px-4 py-3 font-sans text-sm text-gold">
            Scoring engine not wired yet — showing stub results from the fixtures.
          </p>
        )}

        <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <h3 className="mb-3 font-display text-xl font-semibold">
              Ranked candidates{' '}
              <span className="font-sans text-sm font-normal text-muted">({result.candidates.length})</span>
            </h3>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <table className="w-full border-collapse text-left font-sans text-sm">
                <thead className="bg-background text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="w-12 px-4 py-3">#</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="w-64 px-4 py-3">Score</th>
                    <th className="w-40 px-4 py-3">Must-haves</th>
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((c) => {
                    const clickable = !!c.explanation;
                    return (
                      <tr
                        key={c.candidateId}
                        onClick={() => clickable && setSelectedId(c.candidateId)}
                        className={`border-t border-border transition-colors ${
                          clickable ? 'cursor-pointer hover:bg-background' : ''
                        } ${selectedId === c.candidateId ? 'bg-accent-soft' : ''}`}
                      >
                        <td className="px-4 py-3 font-display text-base font-semibold">{c.rank}</td>
                        <td className="px-4 py-3 font-medium">{c.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${Math.max(2, c.finalScore)}%` }}
                              />
                            </div>
                            <span className="w-10 text-right tabular-nums text-muted">
                              {c.finalScore.toFixed(1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.missingMustHaves.length > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                              <TriangleAlert className="h-3 w-3" /> {c.missingMustHaves.length} missing
                            </span>
                          ) : (
                            <span className="text-xs text-muted">all met</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:sticky lg:top-6">
            {selected && selected.explanation ? (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <h3 className="mb-1 font-display text-lg font-semibold">
                  #{selected.rank} {selected.name}
                </h3>
                <p className="mb-4 font-sans text-sm text-muted">{selected.explanation.summary}</p>

                <h4 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-muted">
                  Matched
                </h4>
                <ul className="mb-5 flex flex-col gap-2">
                  {selected.explanation.matched.map((m, i) => (
                    <li key={i} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-sans text-sm font-semibold">{m.requirementText}</span>
                        {m.matchedBy === 'semantic' && (
                          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                            matched by meaning
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-sans text-sm text-muted">&ldquo;{m.evidenceText}&rdquo;</p>
                    </li>
                  ))}
                </ul>

                {/* `missing` carries unsatisfied NICE-to-haves as well, and
                    listing those under "Missing must-haves" overstates the gap.
                    Split them. */}
                {selected.explanation.missing.filter((m) => m.kind === 'MUST').length > 0 && (
                  <>
                    <h4 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-danger">
                      Missing must-haves
                    </h4>
                    <ul className="mb-4 flex flex-col gap-2">
                      {selected.explanation.missing
                        .filter((m) => m.kind === 'MUST')
                        .map((m, i) => (
                          <li key={i} className="rounded-xl border border-danger/30 p-3">
                            <span className="font-sans text-sm font-semibold text-danger">
                              {m.requirementText}
                            </span>
                            {/* The candidate stating the gap in their own words is
                                stronger than our absence of evidence. Surface it. */}
                            {m.disclaimedBy && (
                              <p className="mt-1 font-sans text-sm text-muted">
                                Candidate states this directly: &ldquo;{m.disclaimedBy}&rdquo;
                              </p>
                            )}
                          </li>
                        ))}
                    </ul>
                  </>
                )}

                {selected.explanation.missing.filter((m) => m.kind === 'NICE').length > 0 && (
                  <>
                    <h4 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-muted">
                      Not evidenced (nice-to-have)
                    </h4>
                    <ul className="flex flex-col gap-1">
                      {selected.explanation.missing
                        .filter((m) => m.kind === 'NICE')
                        .map((m, i) => (
                          <li key={i} className="font-sans text-sm text-muted">
                            {m.requirementText}
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-5 text-center font-sans text-sm text-muted">
                Select a top-ranked candidate to see their explanation.
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          {ablation && (
            <div>
              <h3 className="mb-1 font-display text-xl font-semibold">Ablation — does hybrid matter?</h3>
              <p className="mb-3 font-sans text-sm text-muted">
                Each column is the same engine with one layer switched off.{' '}
                <span className="text-foreground">Literal</span> matches only the exact words in the
                job description; <span className="text-foreground">Keyword</span> adds our synonym
                dictionary; <span className="text-foreground">Semantic</span> matches on meaning
                alone. Movement between columns is the proof each layer earns its place.
              </p>
              <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
                <table className="w-full border-collapse text-left font-sans text-sm">
                  <thead className="bg-background text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-3 py-3" title="Exact job-description wording only">Literal</th>
                      <th className="px-3 py-3" title="Exact wording plus our synonym dictionary">Keyword</th>
                      <th className="px-3 py-3" title="Embedding similarity only">Semantic</th>
                      <th className="px-3 py-3">Hybrid</th>
                      <th className="px-4 py-3" title="Rank gained from literal-keyword to hybrid">
                        Literal → Hybrid
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ablation.candidates.map((c) => {
                      // Positive = hybrid ranked them BETTER than literal keyword
                      // search did. These are the candidates a naive keyword
                      // search would have buried.
                      const rescued =
                        c.litToHybridDelta != null ? c.litToHybridDelta : c.delta;
                      return (
                        <tr key={c.name} className="border-t border-border">
                          <td className="px-4 py-3">{c.name}</td>
                          <td className="px-3 py-3 text-muted">{c.literalRank ?? '—'}</td>
                          <td className="px-3 py-3 text-muted">{c.lexicalRank}</td>
                          <td className="px-3 py-3 text-muted">{c.semanticRank}</td>
                          <td className="px-3 py-3 font-semibold text-foreground">{c.hybridRank}</td>
                          <td
                            className={`px-4 py-3 font-semibold ${
                              rescued > 0 ? 'text-accent' : rescued < 0 ? 'text-danger' : 'text-muted'
                            }`}
                          >
                            {rescued > 0 ? `+${rescued} rescued` : rescued < 0 ? rescued : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold">
              <Flag className="h-4 w-4 text-gold" /> JD bias flags
            </h3>
            {result.biasFlags.length === 0 ? (
              <p className="font-sans text-sm text-muted">No bias flags detected.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.biasFlags.map((b, i) => (
                  <li key={i} className="rounded-xl border border-gold/30 bg-gold-bg p-3">
                    <span className="font-sans text-sm font-semibold">&ldquo;{b.phrase}&rdquo;</span>{' '}
                    <span className="font-sans text-xs uppercase tracking-wide text-gold">{b.category}</span>
                    <p className="mt-1 font-sans text-sm text-muted">{b.note}</p>
                    {b.context && (
                      <p className="mt-1 font-mono text-xs text-muted/70">{b.context}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-display text-xl font-semibold">Ask the recruiter chat</h3>
          <div className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {chatHistory.length === 0 && (
              <p className="font-sans text-xs text-muted">
                Try: &ldquo;who knows AWS&rdquo;, &ldquo;why is {result.candidates[0]?.name} above{' '}
                {result.candidates[1]?.name}&rdquo;
              </p>
            )}
            {chatHistory.map((m, i) => (
              <div
                key={i}
                className={`rounded-xl p-3 font-sans text-sm ${
                  m.role === 'user' ? 'self-end bg-background' : 'bg-accent-soft'
                }`}
              >
                {/* Answers are newline-formatted with bullets and quoted resume
                    lines; without whitespace-pre-line they collapse into one
                    unreadable paragraph. */}
                <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
                {m.citedCandidates && m.citedCandidates.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.citedCandidates.map((cid) => {
                      const cand = result.candidates.find((c) => c.candidateId === cid);
                      return (
                        <span
                          key={cid}
                          className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink"
                        >
                          {cand ? cand.name : cid}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={sendChat} className="flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask a question about the candidate pool…"
              className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 font-sans text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={chatBusy}
              className="flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 font-sans text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              {chatBusy ? (
                'Asking…'
              ) : (
                <>
                  Ask <Send className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
