# Rez

> **Repo → Resume.** Turn any public GitHub repository into a resume-ready career profile.

![Next.js](https://img.shields.io/badge/Next.js-App%20Router-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-Anthropic-orange)

Rez analyzes a public GitHub repository and generates a complete, resume-ready career
profile — project summary, resume bullets, interview talking points, a grouped tech stack,
and matching job titles. It's powered by a three-agent pipeline that pulls data from the
GitHub REST API and uses Claude for synthesis.

## Features

- 📝 **Resume bullets** — quantified, action-oriented bullets you can paste straight into a résumé.
- 🗣️ **Interview talking points** — prompts to help you speak confidently about the project.
- 🧱 **Grouped tech stack** — languages, frameworks, and tools, organized by category.
- 🎯 **Matching job titles** — roles the project's skills map to.
- 📂 **Browse your own repos** — with a GitHub token set, list and pick from your repositories (public _and_ private) instead of pasting a URL.
- 🔴 **Live pipeline progress** — per-stage status (Scout → Analyst → Writer) streamed to the UI.
- 🔑 **Server-side keys** — your Anthropic and GitHub tokens never reach the browser.
- 🛟 **Graceful fallbacks** — one failing stage never blanks the whole result.

## How it works

Rez runs three focused Claude agents in sequence; the output of each feeds the next.

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

Each agent is a single Claude call with a focused system prompt. The server endpoint runs all
three and **streams** per-stage progress as NDJSON back to the UI, so the pipeline indicator
shows real status while you wait.

## Tech stack

- **[Next.js](https://nextjs.org/) (App Router)** — UI and API route colocated; the Anthropic key stays server-side.
- **[`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk)** — drives all three agents (`claude-sonnet-4-6` by default).
- **[GitHub REST API v3](https://docs.github.com/en/rest)** via `fetch` — no clone, no database.
- **TypeScript** throughout.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- An [Anthropic API key](https://console.anthropic.com/)
- _(Optional)_ A [GitHub personal access token](https://github.com/settings/tokens) to raise the API rate limit

### Installation

```bash
git clone https://github.com/ganginav/Rez.git
cd Rez
npm install
```

### Configuration

Copy the example env file and fill in your Anthropic key:

```bash
cp .env.local.example .env.local
```

| Variable            | Required | Purpose                                                                 |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | Server-side only. Never shipped to the browser.                         |
| `GITHUB_TOKEN`      | no       | Raises the rate limit (60 → 5,000 req/hr) and, with the `repo` scope, lets you browse your repos and analyze your private ones. |
| `ANTHROPIC_MODEL`   | no       | Overrides the model for all three agents (default `claude-sonnet-4-6`). |

### Running

```bash
npm run dev      # start the dev server at http://localhost:3000
```

Then open [http://localhost:3000](http://localhost:3000), paste a public GitHub repo URL, and
watch the pipeline run.

Other scripts:

```bash
npm run build      # production build
npm start          # serve the production build
npm run typecheck  # type-check without emitting
```

## Usage

1. Start the app and open it in your browser.
2. Pick a repository, either way:
   - **Paste a URL** — full URLs, `.git`, trailing paths, `owner/repo`, and SSH forms are all accepted; or
   - **Browse my repositories** — with a `GITHUB_TOKEN` set, click the toggle to list your repos (public and private), filter, and select one.
3. Watch the **Scout → Analyst → Writer** pipeline run in real time.
4. Copy or export the generated summary, bullets, talking points, tech stack, and job titles.

## Project structure

```
app/
  page.tsx              5-section UI + pipeline indicator + repo picker + copy/export
  api/analyze/route.ts  runs all three agents, streams NDJSON progress
  api/repos/route.ts    lists the authenticated user's repos (server-side token)
lib/
  parse.ts              URL parser (full URLs, .git, trailing paths, owner/repo, SSH)
  github.ts             GitHub data layer (6 endpoints) + error handling
  agents.ts             the three agents, file sampling, JSON-with-fallback helper
  types.ts              shared types
```

## GitHub endpoints used

| Purpose              | Endpoint                                                   |
| -------------------- | ---------------------------------------------------------- |
| Your repositories    | `GET /user/repos` (requires a token)                       |
| Repo metadata        | `GET /repos/{owner}/{repo}`                                |
| Language breakdown   | `GET /repos/{owner}/{repo}/languages`                      |
| README (base64)      | `GET /repos/{owner}/{repo}/readme`                         |
| Full file tree       | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` |
| Single file (base64) | `GET /repos/{owner}/{repo}/contents/{path}`                |

## Reliability

- Every Claude call is wrapped in try/catch with a sensible fallback object — one failed agent never blanks the result.
- Model JSON is fence-stripped and brace-sliced before `JSON.parse`.
- GitHub failures are surfaced clearly: **404** (missing/private) and **403** (rate limit, with a "try later or add a token" hint).
- Files that fail to fetch or decode are skipped, not fatal.
- The Career Writer output is normalized so arrays/fields are always safe to render.

## Roadmap

- [x] **Private repos for the host** — with a server-side `GITHUB_TOKEN` (`repo` scope), your own
      private repositories can be browsed and analyzed today.
- [ ] **Multi-user access via GitHub OAuth** — let each visitor sign in with their own GitHub
      account so they can analyze _their_ private repos, instead of relying on the host's token.
      Each visitor's access token would live in the session only and never be persisted client-side.

## License

No license has been specified yet. Until one is added, the default copyright applies and the
code is not licensed for reuse — add a `LICENSE` file (e.g. MIT) if you want to make it open.
