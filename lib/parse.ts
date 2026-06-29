import type { RepoRef } from "./types";

/**
 * Parse a GitHub repository reference from user input.
 *
 * Accepts:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - github.com/owner/repo/tree/main/src   (trailing paths are ignored)
 *   - git@github.com:owner/repo.git
 *   - owner/repo
 */
export function parseRepoUrl(input: string): RepoRef {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new Error("Enter a GitHub repository URL or owner/repo.");
  }

  let owner: string | undefined;
  let repo: string | undefined;

  const sshMatch = trimmed.match(/^git@[^:]+:(.+)$/);

  if (sshMatch) {
    [owner, repo] = sshMatch[1].split("/").filter(Boolean);
  } else if (/^https?:\/\//i.test(trimmed) || /^(www\.)?github\.com/i.test(trimmed)) {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url: URL;
    try {
      url = new URL(withProtocol);
    } catch {
      throw new Error("That doesn't look like a valid GitHub URL.");
    }
    [owner, repo] = url.pathname.split("/").filter(Boolean);
  } else {
    // Bare "owner/repo" (extra trailing segments are ignored).
    [owner, repo] = trimmed.split("/").filter(Boolean);
  }

  if (!owner || !repo) {
    throw new Error("Could not read an owner/repo. Try https://github.com/owner/repo.");
  }

  repo = repo.replace(/\.git$/i, "");
  return { owner, repo };
}
