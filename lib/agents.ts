// The three-agent pipeline. Each agent is one Claude call with a focused
// system prompt; the output of each feeds the next.

import Anthropic from "@anthropic-ai/sdk";
import type {
  AnalystReport,
  CareerProfile,
  FollowupContext,
  FollowupTurn,
  ScoutSummary,
} from "./types";
import { getFileContent, getTree, type TreeEntry } from "./github";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// Lazily construct the client so a missing key surfaces as a handled error
// rather than crashing at module-import time.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

function extractJson(text: string): string {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  // Models occasionally wrap JSON in prose — slice to the outermost braces.
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) return cleaned.slice(first, last + 1);
  return cleaned;
}

/**
 * Call Claude expecting a single JSON object back. Any failure — API error,
 * empty response, or malformed JSON — resolves to the provided fallback so one
 * failed agent never blanks the whole result.
 */
async function callClaudeJSON<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  fallback: T;
}): Promise<T> {
  try {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return JSON.parse(extractJson(text)) as T;
  } catch (err) {
    console.error("Claude call failed:", err);
    return opts.fallback;
  }
}

// ---------------------------------------------------------------------------
// Agent 1 — Repo Scout
// ---------------------------------------------------------------------------

export async function runScout(input: {
  owner: string;
  repo: string;
  description: string | null;
  topics: string[];
  homepage: string | null;
  license: string | null;
  stars: number;
  forks: number;
  languages: Record<string, number>;
  readme: string;
}): Promise<ScoutSummary> {
  const langList = Object.keys(input.languages).join(", ") || "unknown";

  const system = `You are a senior engineer analyzing a GitHub repository to help a developer build a career profile.
Analyze the provided metadata and return ONLY a JSON object — no markdown, no code fences, no commentary.
The JSON must have exactly these fields:
- "projectType": string (e.g. "web framework", "REST API", "CLI tool", "library", "mobile app")
- "mainPurpose": string (one sentence)
- "coreTechnologies": string[] (the main languages and runtimes)
- "infraAndDevOps": string[] (CI, containers, cloud, build tooling — empty array if none is evident)
- "architecturePatterns": string[] (e.g. "monorepo", "microservices", "MVC" — empty array if unclear)
- "scaleSignals": { "stars": number, "forks": number }
- "notableFeatures": string[] (max 4 standout capabilities)
Base everything strictly on the evidence provided. Do not invent technologies that aren't supported by the input.`;

  const user = `Repository: ${input.owner}/${input.repo}
Description: ${input.description ?? "(none)"}
Topics: ${input.topics.join(", ") || "(none)"}
Homepage: ${input.homepage ?? "(none)"}
License: ${input.license ?? "(none)"}
Stars: ${input.stars}
Forks: ${input.forks}
Language breakdown (by bytes): ${langList}

README (truncated to ~3,000 chars):
${input.readme || "(no README found)"}`;

  return callClaudeJSON<ScoutSummary>({
    system,
    user,
    maxTokens: 1024,
    fallback: {
      projectType: input.topics[0] ?? "software project",
      mainPurpose: input.description ?? "A software project hosted on GitHub.",
      coreTechnologies: Object.keys(input.languages),
      infraAndDevOps: [],
      architecturePatterns: [],
      scaleSignals: { stars: input.stars, forks: input.forks },
      notableFeatures: [],
    },
  });
}

// ---------------------------------------------------------------------------
// Agent 2 — Code Analyst (file sampling + extraction)
// ---------------------------------------------------------------------------

const MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "gemfile",
  "requirements.txt",
  "build.gradle",
  "composer.json",
]);

const ENTRY_RE = /^(main|index|app|server|cli)\.(js|ts|jsx|tsx|py|go|rs|java|rb|cs)$/;
const SCHEMA_RE = /^schema\.(sql|prisma|graphql)$/;

/** Score a file by how informative it is likely to be for resume signals. */
function scoreFile(path: string): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const depth = path.split("/").length;

  if (MANIFESTS.has(base)) return 100 - depth; // dependency manifests
  if (SCHEMA_RE.test(base) || base.endsWith(".prisma")) return 85 - depth; // schema
  if (base === "dockerfile") return 75 - depth; // infra
  if (/^docker-compose\.ya?ml$/.test(base)) return 73 - depth;
  if (lower.startsWith(".github/workflows/") && /\.ya?ml$/.test(lower)) return 65; // CI
  if (ENTRY_RE.test(base)) return 55 - depth; // entry points
  if (/^src\/(index|main)\.(js|ts|jsx|tsx|py|go|rs|java|rb|cs)$/.test(lower)) return 50;
  return 0;
}

export function selectKeyFiles(tree: TreeEntry[], limit = 6): string[] {
  return tree
    .map((e) => ({ path: e.path, score: scoreFile(e.path) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.path);
}

export async function runAnalyst(input: {
  owner: string;
  repo: string;
  defaultBranch: string;
  scout: ScoutSummary;
  token?: string;
}): Promise<{ report: AnalystReport; sampledFiles: string[] }> {
  const tree = await getTree(input.owner, input.repo, input.defaultBranch, input.token);
  const selected = selectKeyFiles(tree, 6);

  const snippets: { path: string; content: string }[] = [];
  await Promise.all(
    selected.map(async (path) => {
      const content = await getFileContent(input.owner, input.repo, path, input.token, 800);
      if (content) snippets.push({ path, content });
    }),
  );
  // Restore the priority order (Promise.all resolves out of order).
  snippets.sort((a, b) => selected.indexOf(a.path) - selected.indexOf(b.path));

  const filesBlock =
    snippets.map((s) => `--- ${s.path} ---\n${s.content}`).join("\n\n") ||
    "(no files could be sampled)";

  const system = `You are a staff engineer reviewing a handful of sampled source files to extract resume-relevant engineering signals.
Use the repository summary and the file snippets. Infer only what the evidence supports; do not invent details.
Return ONLY a JSON object — no markdown, no code fences, no commentary — with exactly these fields:
- "frameworksAndLibraries": string[]
- "databasesAndStorage": string[]
- "testingApproach": string | null
- "deploymentAndCI": string[]
- "architecturalDecisions": string[] (brief phrases)
- "codeQualitySignals": string[]
- "performanceFeatures": string[]
Use empty arrays (or null for testingApproach) where there is no evidence.`;

  const user = `REPOSITORY SUMMARY:
${JSON.stringify(input.scout, null, 2)}

SAMPLED FILES (each truncated to ~800 chars):
${filesBlock}`;

  const report = await callClaudeJSON<AnalystReport>({
    system,
    user,
    maxTokens: 1024,
    fallback: {
      frameworksAndLibraries: input.scout.coreTechnologies,
      databasesAndStorage: [],
      testingApproach: null,
      deploymentAndCI: input.scout.infraAndDevOps,
      architecturalDecisions: input.scout.architecturePatterns,
      codeQualitySignals: [],
      performanceFeatures: [],
    },
  });

  return { report, sampledFiles: snippets.map((s) => s.path) };
}

// ---------------------------------------------------------------------------
// Follow-up Q&A — judge which files to read, then answer (streamed)
// ---------------------------------------------------------------------------

// File extensions worth offering to the judge as candidate reads.
const CODE_FILE_RE =
  /\.(js|jsx|ts|tsx|py|go|rs|java|rb|cs|php|c|cc|cpp|h|hpp|kt|swift|scala|sql|prisma|graphql|sh|ya?ml|toml|json|md)$/i;

/**
 * Files the follow-up judge may choose from: code/config files not already
 * sampled, shallowest first (more architecturally central), capped so the
 * candidate list stays small enough to send to the model.
 */
export function candidateFiles(tree: TreeEntry[], exclude: string[], limit = 300): string[] {
  const ex = new Set(exclude);
  return tree
    .map((e) => e.path)
    .filter((p) => !ex.has(p) && CODE_FILE_RE.test(p) && !p.includes("node_modules/"))
    .sort((a, b) => a.split("/").length - b.split("/").length)
    .slice(0, limit);
}

/**
 * Decide whether the existing analysis already answers the question and, if
 * not, which unread files would help most. Returns paths drawn ONLY from the
 * candidate list (hallucinated paths are filtered out).
 */
export async function judgeFilesToFetch(input: {
  context: FollowupContext;
  question: string;
  candidatePaths: string[];
  limit?: number;
}): Promise<{ enoughContext: boolean; files: string[] }> {
  const limit = input.limit ?? 10;
  if (input.candidatePaths.length === 0) return { enoughContext: true, files: [] };

  const system = `You decide which additional source files (if any) are needed to answer a question about a GitHub repository.
You already have a structured analysis and a list of files that were already read.
Return ONLY a JSON object — no markdown, no code fences — with exactly:
{ "enoughContext": boolean, "files": string[] }
- "enoughContext": true if the existing analysis already answers the question well; false if reading more files would materially help.
- "files": the paths MOST relevant to the question, chosen ONLY from the candidate list, ranked best first, at most ${limit}. Return [] if none would help.
Never invent paths that are not in the candidate list.`;

  const user = `QUESTION: ${input.question}

EXISTING ANALYSIS:
${JSON.stringify(input.context.report, null, 2)}

ALREADY READ: ${input.context.sampledFiles.join(", ") || "(none)"}

CANDIDATE FILES (choose only from these):
${input.candidatePaths.join("\n")}`;

  const res = await callClaudeJSON<{ enoughContext?: boolean; files?: unknown }>({
    system,
    user,
    maxTokens: 512,
    fallback: { enoughContext: true, files: [] },
  });

  const allowed = new Set(input.candidatePaths);
  const files = Array.isArray(res.files)
    ? (res.files.filter((f): f is string => typeof f === "string" && allowed.has(f))).slice(0, limit)
    : [];
  return { enoughContext: res.enoughContext !== false, files };
}

/**
 * Answer a follow-up question about the repo, streaming text via `onText`.
 * The static analysis lives in the system prompt; prior turns are replayed as
 * conversation so the thread has memory; any freshly-read files are attached
 * to the current question.
 */
export async function answerFollowup(input: {
  context: FollowupContext;
  thread: FollowupTurn[];
  question: string;
  extraFiles: { path: string; content: string }[];
  onText: (text: string) => void;
}): Promise<void> {
  const { context, thread, question, extraFiles } = input;

  const system = `You are a senior engineer helping a developer deeply understand a GitHub repository — so they can explain it, evaluate trade-offs, or prepare to talk about it in an interview.
You are given a structured analysis of the repo and sometimes additional source-file snippets.
Answer directly and concretely, grounded ONLY in the provided evidence. When the evidence doesn't cover something, say so plainly rather than inventing details.
Explain the "why" and trade-offs when they're relevant. Keep answers focused and conversational; short paragraphs or bullet points are fine. Do not return JSON.

REPOSITORY: ${context.owner}/${context.repo}
PROJECT SUMMARY: ${context.summary || "(none)"}

SCOUT SUMMARY:
${JSON.stringify(context.scout, null, 2)}

CODE ANALYSIS:
${JSON.stringify(context.report, null, 2)}

FILES ALREADY SAMPLED: ${context.sampledFiles.join(", ") || "(none)"}`;

  const filesBlock = extraFiles.length
    ? `\n\nADDITIONAL SOURCE FILES (each truncated):\n${extraFiles
        .map((f) => `--- ${f.path} ---\n${f.content}`)
        .join("\n\n")}`
    : "";

  const messages: Anthropic.MessageParam[] = [];
  for (const t of thread) {
    messages.push({ role: "user", content: t.question });
    messages.push({ role: "assistant", content: t.answer });
  }
  messages.push({ role: "user", content: `${question}${filesBlock}` });

  const stream = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages,
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      input.onText(event.delta.text);
    }
  }
}

// ---------------------------------------------------------------------------
// Agent 3 — Career Writer
// ---------------------------------------------------------------------------

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalizeProfile(raw: unknown): CareerProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ts = (r.techStack ?? {}) as Record<string, unknown>;

  const talkingPoints = Array.isArray(r.talkingPoints)
    ? (r.talkingPoints as unknown[])
        .map((p) => p as Record<string, unknown>)
        .filter((p) => typeof p?.question === "string" && typeof p?.answer === "string")
        .map((p) => ({ question: p.question as string, answer: p.answer as string }))
    : [];

  const jobTitles = Array.isArray(r.jobTitles)
    ? (r.jobTitles as unknown[])
        .map((j) => j as Record<string, unknown>)
        .filter((j) => typeof j?.title === "string" && typeof j?.reason === "string")
        .map((j) => ({ title: j.title as string, reason: j.reason as string }))
    : [];

  return {
    summary: typeof r.summary === "string" ? r.summary : "",
    bullets: asStrings(r.bullets),
    talkingPoints,
    techStack: {
      languages: asStrings(ts.languages),
      frameworks: asStrings(ts.frameworks),
      databases: asStrings(ts.databases),
      infrastructure: asStrings(ts.infrastructure),
      testing: asStrings(ts.testing),
    },
    jobTitles,
  };
}

export async function runWriter(input: {
  scout: ScoutSummary;
  report: AnalystReport;
}): Promise<CareerProfile> {
  const system = `You are an expert technical resume writer and interview coach.
Using the structured analysis below, write a career profile as if it were the CANDIDATE'S OWN project experience.

CRITICAL RULES:
- Never mention or name the repository, the project, GitHub, or that this came from analyzing a repo. Write in the candidate's voice about their own work.
- Be specific: name the real technologies and architectural decisions from the analysis. Do not invent facts the analysis does not support.
- Return ONLY a JSON object — no markdown, no code fences, no commentary.

JSON shape:
{
  "summary": string,                        // 2-3 sentences, resume "Projects" section voice, no repo name
  "bullets": string[],                      // 4-6 items, each starts with a strong past-tense action verb, names specific tech, includes scale/impact where available
  "talkingPoints": [                        // exactly 4 items, in this order:
    { "question": string, "answer": string } //   1) what it does, 2) a key technical decision, 3) a challenge, 4) what you'd do differently
  ],                                        // answers are 2-3 sentences, conversational and speakable
  "techStack": {                            // group technologies; give an empty array for any category with nothing
    "languages": string[], "frameworks": string[], "databases": string[], "infrastructure": string[], "testing": string[]
  },
  "jobTitles": [                            // 4-5 items
    { "title": string, "reason": string }   //   reason is 8-10 words
  ]
}`;

  const user = `SCOUT SUMMARY:
${JSON.stringify(input.scout, null, 2)}

CODE ANALYSIS:
${JSON.stringify(input.report, null, 2)}`;

  const raw = await callClaudeJSON<unknown>({
    system,
    user,
    maxTokens: 2000,
    fallback: {},
  });

  return normalizeProfile(raw);
}
