"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AnalysisResult,
  FollowupEvent,
  FollowupMode,
  FollowupTurn,
  PipelineEvent,
  PipelineStage,
  TechStack,
  UserRepo,
} from "@/lib/types";

type StageState = "idle" | "running" | "done" | "error";
type Phase = "idle" | "running" | "done" | "error";

const STAGES: { key: PipelineStage; name: string; desc: string }[] = [
  { key: "scout", name: "Repo Scout", desc: "Reading metadata, languages & README" },
  { key: "analyst", name: "Code Analyst", desc: "Sampling key files for tech signals" },
  { key: "writer", name: "Career Writer", desc: "Composing your profile" },
];

const EXAMPLES = ["facebook/react", "vercel/next.js", "tiangolo/fastapi"];

const FOLLOWUP_MODES: { key: FollowupMode; label: string; hint: string }[] = [
  {
    key: "auto",
    label: "Auto",
    hint: "Auto — answers from the analysis, and reads more files only if it decides it needs to.",
  },
  {
    key: "light",
    label: "Light",
    hint: "Light — answers from what was already gathered. Fastest, no extra file reads.",
  },
  {
    key: "deep",
    label: "Deep",
    hint: "Deep — pulls in the most relevant unread files before answering. Slower, more thorough.",
  },
];

const STACK_LABELS: { key: keyof TechStack; label: string }[] = [
  { key: "languages", label: "Languages" },
  { key: "frameworks", label: "Frameworks" },
  { key: "databases", label: "Databases" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "testing", label: "Testing" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stages, setStages] = useState<Record<PipelineStage, StageState>>({
    scout: "idle",
    analyst: "idle",
    writer: "idle",
  });
  const [details, setDetails] = useState<Partial<Record<PipelineStage, string>>>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"" | "bullets" | "full">("");
  const runningStage = useRef<PipelineStage | null>(null);

  // Follow-up Q&A state.
  const [thread, setThread] = useState<FollowupTurn[]>([]);
  const [followupQ, setFollowupQ] = useState("");
  const [followupMode, setFollowupMode] = useState<FollowupMode>("auto");
  const [followupBusy, setFollowupBusy] = useState(false);
  const [pendingQ, setPendingQ] = useState("");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [followupStatus, setFollowupStatus] = useState("");
  const [followupFiles, setFollowupFiles] = useState<string[]>([]);
  const [followupError, setFollowupError] = useState<string | null>(null);

  // "Browse my repositories" picker state.
  const [showRepos, setShowRepos] = useState(false);
  const [myRepos, setMyRepos] = useState<UserRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  const loadRepos = useCallback(async () => {
    setShowRepos((prev) => !prev);
    // Only fetch once; subsequent toggles just show/hide the cached list.
    if (myRepos !== null || reposLoading) return;
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await fetch("/api/repos");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReposError(data.error ?? "Failed to load your repositories.");
      } else {
        setMyRepos(Array.isArray(data.repos) ? data.repos : []);
      }
    } catch {
      setReposError("Could not reach the server. Is it running?");
    } finally {
      setReposLoading(false);
    }
  }, [myRepos, reposLoading]);

  const resetFollowup = useCallback(() => {
    setThread([]);
    setFollowupQ("");
    setFollowupBusy(false);
    setPendingQ("");
    setStreamingAnswer("");
    setFollowupStatus("");
    setFollowupFiles([]);
    setFollowupError(null);
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setStages({ scout: "idle", analyst: "idle", writer: "idle" });
    setDetails({});
    setResult(null);
    setError(null);
    setCopied("");
    runningStage.current = null;
    resetFollowup();
  }, [resetFollowup]);

  const handleEvent = useCallback((event: PipelineEvent) => {
    if (event.type === "stage") {
      if (event.status === "running") runningStage.current = event.stage;
      setStages((prev) => ({ ...prev, [event.stage]: event.status }));
      if (event.detail) setDetails((prev) => ({ ...prev, [event.stage]: event.detail }));
    } else if (event.type === "result") {
      setResult(event.result);
      setPhase("done");
    } else if (event.type === "error") {
      if (runningStage.current) {
        const stage = runningStage.current;
        setStages((prev) => ({ ...prev, [stage]: "error" }));
      }
      setError(event.error);
      setPhase("error");
    }
  }, []);

  const analyze = useCallback(
    async (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;

      setPhase("running");
      setStages({ scout: "idle", analyst: "idle", writer: "idle" });
      setDetails({});
      setResult(null);
      setError(null);
      setCopied("");
      runningStage.current = null;
      resetFollowup();

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: "Request failed." }));
          setError(data.error ?? "Request failed.");
          setPhase("error");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
              handleEvent(JSON.parse(line) as PipelineEvent);
            } catch {
              // Ignore malformed lines; the stream continues.
            }
          }
        }
      } catch {
        setError("Lost connection to the server. Please try again.");
        setPhase("error");
      }
    },
    [handleEvent, resetFollowup],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    analyze(url);
  };

  const askFollowup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const question = followupQ.trim();
      if (!question || followupBusy || !result) return;

      setFollowupBusy(true);
      setFollowupError(null);
      setFollowupStatus("");
      setFollowupFiles([]);
      setStreamingAnswer("");
      setPendingQ(question);
      setFollowupQ("");

      let answer = "";
      let errored = false;
      try {
        const res = await fetch("/api/followup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: result.context,
            question,
            mode: followupMode,
            thread,
          }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: "Request failed." }));
          setFollowupError(data.error ?? "Request failed.");
          setFollowupBusy(false);
          setPendingQ("");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let event: FollowupEvent;
            try {
              event = JSON.parse(line) as FollowupEvent;
            } catch {
              continue;
            }
            if (event.type === "status") {
              setFollowupStatus(event.text);
            } else if (event.type === "files") {
              setFollowupFiles(event.files);
            } else if (event.type === "delta") {
              answer += event.text;
              setStreamingAnswer(answer);
            } else if (event.type === "error") {
              errored = true;
              setFollowupError(event.error);
            }
          }
        }

        if (answer.trim() && !errored) {
          setThread((prev) => [...prev, { question, answer }]);
        }
      } catch {
        setFollowupError("Lost connection to the server. Please try again.");
      } finally {
        setFollowupBusy(false);
        setFollowupStatus("");
        setFollowupFiles([]);
        setStreamingAnswer("");
        setPendingQ("");
      }
    },
    [followupQ, followupBusy, followupMode, thread, result],
  );

  const copy = async (kind: "bullets" | "full") => {
    if (!result) return;
    const text = kind === "bullets" ? bulletsText(result) : fullText(result);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context); fail quietly.
    }
  };

  // ---- Result view ----
  if (phase === "done" && result) {
    const p = result.profile;
    const stackEntries = STACK_LABELS.filter(({ key }) => p.techStack[key].length > 0);

    return (
      <div className="page">
        <div className="resultbar">
          <div className="wrap resultbar-inner">
            <span className="repo-id">
              {result.repo.owner}
              <span className="slash">/</span>
              {result.repo.repo}
            </span>
            <span className="metrics">
              <span>★ {formatCount(result.repo.stars)}</span>
              <span>⑂ {formatCount(result.repo.forks)}</span>
            </span>
            <div className="bar-actions">
              <button className="btn-ghost" onClick={() => copy("bullets")}>
                {copied === "bullets" ? "Copied ✓" : "Copy resume bullets"}
              </button>
              <button className="btn-ghost" onClick={() => copy("full")}>
                {copied === "full" ? "Copied ✓" : "Copy full profile"}
              </button>
              <button className="btn-ghost" onClick={reset}>
                Analyze another
              </button>
            </div>
          </div>
        </div>

        <main className="wrap results">
          <Section num="01" title="Project summary">
            {p.summary ? (
              <p className="summary-text">{p.summary}</p>
            ) : (
              <p className="empty">No summary was generated.</p>
            )}
          </Section>

          <Section num="02" title="Resume bullets">
            {p.bullets.length > 0 ? (
              <ul className="bullets">
                {p.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="empty">No bullets were generated.</p>
            )}
          </Section>

          <Section num="03" title="Interview talking points">
            {p.talkingPoints.length > 0 ? (
              <div className="qa">
                {p.talkingPoints.map((tp, i) => (
                  <div className="qa-card" key={i}>
                    <p className="qa-q">{tp.question}</p>
                    <p className="qa-a">{tp.answer}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No talking points were generated.</p>
            )}
          </Section>

          <Section num="04" title="Tech stack">
            {stackEntries.length > 0 ? (
              <div className="stack-grid">
                {stackEntries.map(({ key, label }) => (
                  <div className="stack-cat" key={key}>
                    <div className="stack-label">{label}</div>
                    <div className="chips">
                      {p.techStack[key].map((t, i) => (
                        <span className="chip" key={i}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No tech stack was detected.</p>
            )}
          </Section>

          <Section num="05" title="Matching job titles">
            {p.jobTitles.length > 0 ? (
              <div className="roles">
                {p.jobTitles.map((j, i) => (
                  <div className="role" key={i}>
                    <span className="role-title">{j.title}</span>
                    <span className="role-reason">{j.reason}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No matching roles were generated.</p>
            )}
          </Section>

          <Section num="06" title="Ask about this repo">
            <div className="followup">
              {(thread.length > 0 || followupBusy) && (
                <div className="fu-thread">
                  {thread.map((t, i) => (
                    <div className="fu-turn" key={i}>
                      <p className="fu-q">{t.question}</p>
                      <div className="fu-a">{t.answer}</div>
                    </div>
                  ))}

                  {followupBusy && (
                    <div className="fu-turn">
                      <p className="fu-q">{pendingQ}</p>
                      {followupFiles.length > 0 && (
                        <p className="fu-files">
                          Read {followupFiles.length} file{followupFiles.length === 1 ? "" : "s"}:{" "}
                          <span className="fu-files-list">{followupFiles.join(", ")}</span>
                        </p>
                      )}
                      <div className="fu-a">
                        {streamingAnswer || (
                          <span className="fu-thinking">{followupStatus || "Thinking…"}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {followupError && <p className="fu-error">{followupError}</p>}

              <form className="fu-form" onSubmit={askFollowup}>
                <div className="fu-modes" role="group" aria-label="Search depth">
                  {FOLLOWUP_MODES.map((m) => (
                    <button
                      type="button"
                      key={m.key}
                      className="fu-mode"
                      data-active={followupMode === m.key}
                      onClick={() => setFollowupMode(m.key)}
                      disabled={followupBusy}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="fu-input-row">
                  <input
                    className="input"
                    value={followupQ}
                    onChange={(e) => setFollowupQ(e.target.value)}
                    placeholder="e.g. Why this architecture? How does auth work? What would you improve?"
                    aria-label="Follow-up question"
                    disabled={followupBusy}
                    spellCheck={false}
                  />
                  <button className="btn" type="submit" disabled={followupBusy || !followupQ.trim()}>
                    {followupBusy ? "Asking…" : "Ask"}
                  </button>
                </div>
                <p className="fu-hint">{FOLLOWUP_MODES.find((m) => m.key === followupMode)?.hint}</p>
              </form>
            </div>
          </Section>
        </main>

        <Footer />
      </div>
    );
  }

  // ---- Running / error view ----
  if (phase === "running" || phase === "error") {
    return (
      <div className="page">
        <section className="pipeline">
          <div className="wrap">
            <div className="pipeline-head">
              <span className="eyebrow">Analyzing</span>
              <h2>
                <span className="target">{url.trim()}</span>
              </h2>
            </div>

            <div className="stages">
              {STAGES.map((s) => {
                const state = stages[s.key];
                return (
                  <div className="stage" data-status={state} key={s.key}>
                    <div className="dot">{stageGlyph(state, STAGES.indexOf(s) + 1)}</div>
                    <div className="stage-body">
                      <div className="stage-name">{s.name}</div>
                      <div className="stage-desc">{details[s.key] ?? s.desc}</div>
                    </div>
                    <div className="stage-status">{statusLabel(state)}</div>
                  </div>
                );
              })}
            </div>

            {phase === "error" && (
              <div className="error-card">
                <p>{error}</p>
                <button className="btn-ghost" onClick={reset}>
                  Try another repo
                </button>
              </div>
            )}
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  // ---- Idle / input view ----
  return (
    <div className="page">
      <section className="hero">
        <div className="wrap">
          <div className="hero-inner">
            <span className="eyebrow">Repo → Resume</span>
            <h1 className="title">
              Understand any GitHub repo — and turn it into{" "}
              <span className="mark">resume-ready</span> proof of your work.
            </h1>
            <p className="subtitle">
              Paste a repository URL. A three-agent pipeline reads the code and metadata to produce a
              project summary, resume bullets, interview talking points, a grouped tech stack, and
              matching roles — then ask follow-up questions to dig into how it actually works.
            </p>

            <form className="form" onSubmit={onSubmit}>
              <input
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo  ·  or  owner/repo"
                aria-label="GitHub repository URL"
                autoFocus
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button className="btn" type="submit" disabled={!url.trim()}>
                Analyze
              </button>
            </form>

            <div className="examples">
              <span>Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="example-chip"
                  onClick={() => {
                    setUrl(ex);
                    analyze(ex);
                  }}
                >
                  {ex}
                </button>
              ))}
              <button
                type="button"
                className="browse-toggle"
                onClick={loadRepos}
                aria-expanded={showRepos}
              >
                {showRepos ? "Hide my repositories" : "Browse my repositories →"}
              </button>
            </div>

            {showRepos && (
              <div className="myrepos">
                {reposLoading && <p className="myrepos-status">Loading your repositories…</p>}

                {reposError && (
                  <p className="myrepos-status myrepos-error">{reposError}</p>
                )}

                {!reposLoading && !reposError && myRepos && (
                  myRepos.length === 0 ? (
                    <p className="myrepos-status">No repositories found for this token.</p>
                  ) : (
                    <>
                      <input
                        className="repo-filter"
                        value={repoFilter}
                        onChange={(e) => setRepoFilter(e.target.value)}
                        placeholder={`Filter ${myRepos.length} repositories…`}
                        aria-label="Filter repositories"
                        spellCheck={false}
                      />
                      <ul className="repo-list">
                        {myRepos
                          .filter((r) =>
                            r.fullName.toLowerCase().includes(repoFilter.trim().toLowerCase()),
                          )
                          .map((r) => (
                            <li key={r.fullName}>
                              <button
                                type="button"
                                className="repo-row"
                                onClick={() => {
                                  setUrl(r.fullName);
                                  analyze(r.fullName);
                                }}
                              >
                                <span className="repo-row-main">
                                  <span className="repo-row-name">
                                    {r.fullName}
                                    {r.private && <span className="badge-private">Private</span>}
                                  </span>
                                  {r.description && (
                                    <span className="repo-row-desc">{r.description}</span>
                                  )}
                                </span>
                                <span className="repo-row-meta">
                                  {r.language && <span>{r.language}</span>}
                                  <span>★ {formatCount(r.stars)}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

function Section({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <span className="section-num">{num}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        Public repos work without auth. With a <code>GITHUB_TOKEN</code> you get a higher rate limit,
        can browse your own repositories, and can analyze your private ones.
      </div>
    </footer>
  );
}

function stageGlyph(state: StageState, num: number): string {
  if (state === "done") return "✓";
  if (state === "error") return "!";
  return String(num);
}

function statusLabel(state: StageState): string {
  switch (state) {
    case "running":
      return "Working";
    case "done":
      return "Done";
    case "error":
      return "Failed";
    default:
      return "Queued";
  }
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function bulletsText(result: AnalysisResult): string {
  return result.profile.bullets.map((b) => `• ${b}`).join("\n");
}

function fullText(result: AnalysisResult): string {
  const p = result.profile;
  const lines: string[] = [];

  lines.push("SUMMARY", p.summary || "(none)", "");

  lines.push("RESUME BULLETS");
  p.bullets.forEach((b) => lines.push(`• ${b}`));
  lines.push("");

  lines.push("INTERVIEW TALKING POINTS");
  p.talkingPoints.forEach((tp) => {
    lines.push(`Q: ${tp.question}`, `A: ${tp.answer}`, "");
  });

  lines.push("TECH STACK");
  STACK_LABELS.forEach(({ key, label }) => {
    const arr = p.techStack[key];
    if (arr.length > 0) lines.push(`${label}: ${arr.join(", ")}`);
  });
  lines.push("");

  lines.push("MATCHING ROLES");
  p.jobTitles.forEach((j) => lines.push(`• ${j.title} — ${j.reason}`));

  return lines.join("\n").trim();
}
