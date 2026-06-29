# Repo → Resume

Analyze a public GitHub repository and generate a complete, resume-ready career profile:
project summary, resume bullets, interview talking points, a grouped tech stack, and matching
job titles. Built around a three-agent pipeline that calls the GitHub REST API for data and
Claude for synthesis.

## How it works

```
GitHub URL
   │
   ▼
Agent 1 — Repo Scout      metadata + languages + README → structured summary
   │
   ▼
Agent 2 — Code Analyst    sample 5–6 key files → tech + architecture signals
   │
   ▼
Agent 3 — Career Writer   synthesize → summary, bullets, talking points, stack, roles
```

Each agent is one Claude call with a focused system prompt; the output of each feeds the next.
The server endpoint runs all three and **streams** per-stage progress (NDJSON) back to the UI, so
the pipeline indicator shows real status (Scout → Analyst → Writer) while you wait.

## Stack

- **Next.js (App Router)** — UI and API route colocated; the Anthropic key stays server-side.
- **`@anthropic-ai/sdk`** — all three agents (`claude-sonnet-4-6` by default).
- **GitHub REST API v3** via `fetch` — no clone, no database.

## Setup

```bash
cp .env.local.example .env.local   # then fill in ANTHROPIC_API_KEY
npm install
npm run dev                        # http://localhost:3000
```

### Environment

| Variable            | Required | Purpose                                                            |
| ------------------- | -------- | ------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | yes      | Server-side only. Never shipped to the browser.                    |
| `GITHUB_TOKEN`      | no       | Raises the GitHub rate limit from 60 → 5,000 req/hr.               |
| `ANTHROPIC_MODEL`   | no       | Overrides the model for all three agents (default `claude-sonnet-4-6`). |

## Project layout

```
app/
  page.tsx              5-section UI + pipeline indicator + copy/export
  api/analyze/route.ts  runs all three agents, streams NDJSON progress
lib/
  parse.ts              URL parser (full URLs, .git, trailing paths, owner/repo, SSH)
  github.ts             GitHub data layer (5 endpoints) + error handling
  agents.ts             the three agents, file sampling, JSON-with-fallback helper
  types.ts              shared types
```

## Robustness

- Every Claude call is wrapped in try/catch with a sensible fallback object — one failed agent
  never blanks the result.
- Model JSON is fence-stripped and brace-sliced before `JSON.parse`.
- GitHub failures are surfaced clearly: **404** (missing/private) and **403** (rate limit, with a
  "try later or add a token" hint).
- Files that fail to fetch or decode are skipped, not fatal.
- The Career Writer output is normalized so arrays/fields are always safe to render.

## Endpoints used

| Purpose                 | Endpoint                                                  |
| ----------------------- | -------------------------------------------------------- |
| Repo metadata           | `GET /repos/{owner}/{repo}`                              |
| Language breakdown      | `GET /repos/{owner}/{repo}/languages`                    |
| README (base64)         | `GET /repos/{owner}/{repo}/readme`                       |
| Full file tree          | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` |
| Single file (base64)    | `GET /repos/{owner}/{repo}/contents/{path}`             |

## Phase 2 (not yet built)

Private repos via GitHub OAuth: authorize → receive an access token → pass it as
`Authorization: token <token>` on every GitHub call. The pipeline is otherwise unchanged.
Store the token in the session only; never persist it client-side.
