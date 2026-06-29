// GitHub REST API v3 data layer. Public repos need no auth (60 req/hr per IP);
// an optional token raises the limit to 5,000 req/hr.

import type { RepoMeta, UserRepo } from "./types";

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GitHubError";
  }
}

export interface TreeEntry {
  path: string;
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-to-resume",
  };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

async function ghFetch(path: string, token?: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });

  if (res.status === 404) {
    throw new GitHubError(404, "Repository not found — it may be private, or the URL may be wrong.");
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0" || res.status === 429) {
      throw new GitHubError(
        403,
        "GitHub rate limit reached. Try again later, or add a GITHUB_TOKEN to raise the limit to 5,000/hr.",
      );
    }
    throw new GitHubError(403, "GitHub denied the request (403) — the repo may be private.");
  }
  if (!res.ok) {
    throw new GitHubError(res.status, `GitHub request failed (${res.status}).`);
  }
  return res;
}

function decodeBase64(b64: string): string {
  return Buffer.from((b64 ?? "").replace(/\n/g, ""), "base64").toString("utf-8");
}

export async function getRepoMeta(owner: string, repo: string, token?: string): Promise<RepoMeta> {
  const res = await ghFetch(`/repos/${owner}/${repo}`, token);
  const data = await res.json();
  return {
    owner: data.owner?.login ?? owner,
    repo: data.name ?? repo,
    description: data.description ?? null,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    topics: Array.isArray(data.topics) ? data.topics : [],
    homepage: data.homepage || null,
    license: data.license?.spdx_id ?? data.license?.name ?? null,
    defaultBranch: data.default_branch ?? "HEAD",
  };
}

/**
 * List repositories the authenticated user can access (owned, collaborator, or org member).
 * Requires a token; with the `repo` scope this includes private repos. Sorted most-recent first.
 */
export async function getUserRepos(token: string): Promise<UserRepo[]> {
  const res = await ghFetch(
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    token,
  );
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .map((r: Record<string, unknown>): UserRepo => {
      const owner = (r.owner as { login?: string })?.login ?? "";
      const repo = (r.name as string) ?? "";
      return {
        owner,
        repo,
        fullName: (r.full_name as string) ?? `${owner}/${repo}`,
        description: (r.description as string) ?? null,
        private: Boolean(r.private),
        stars: (r.stargazers_count as number) ?? 0,
        language: (r.language as string) ?? null,
        updatedAt: (r.updated_at as string) ?? (r.pushed_at as string) ?? "",
      };
    })
    .filter((r) => r.owner && r.repo);
}

export async function getLanguages(
  owner: string,
  repo: string,
  token?: string,
): Promise<Record<string, number>> {
  const res = await ghFetch(`/repos/${owner}/${repo}/languages`, token);
  return res.json();
}

export async function getReadme(
  owner: string,
  repo: string,
  token?: string,
  maxChars = 3000,
): Promise<string> {
  try {
    const res = await ghFetch(`/repos/${owner}/${repo}/readme`, token);
    const data = await res.json();
    return decodeBase64(data.content).slice(0, maxChars);
  } catch (err) {
    // A missing README is not fatal.
    if (err instanceof GitHubError && err.status === 404) return "";
    throw err;
  }
}

export async function getTree(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
): Promise<TreeEntry[]> {
  const res = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  );
  const data = await res.json();
  if (!Array.isArray(data.tree)) return [];
  return data.tree
    .filter((e: { type?: string; path?: string }) => e.type === "blob" && typeof e.path === "string")
    .map((e: { path: string }) => ({ path: e.path }));
}

/** Fetch and decode a single file. Returns null on any failure (skipped, not fatal). */
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  token?: string,
  maxChars = 800,
): Promise<string | null> {
  try {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await ghFetch(`/repos/${owner}/${repo}/contents/${encoded}`, token);
    const data = await res.json();
    if (Array.isArray(data) || typeof data.content !== "string") return null; // directory / no content
    return decodeBase64(data.content).slice(0, maxChars);
  } catch {
    return null;
  }
}
