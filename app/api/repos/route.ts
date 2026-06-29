import { GitHubError, getUserRepos } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists the authenticated user's repositories using the server-side GITHUB_TOKEN.
// The token never leaves the server; the browser only ever sees the resulting list.
export async function GET(): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return Response.json(
      {
        error:
          "No GITHUB_TOKEN configured. Add a token with the `repo` scope to .env.local and restart to browse your repositories.",
      },
      { status: 400 },
    );
  }

  try {
    const repos = await getUserRepos(token);
    return Response.json({ repos });
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 500;
    const message =
      status === 401
        ? "GitHub rejected the token (401). Check that GITHUB_TOKEN is valid and has the `repo` scope."
        : err instanceof Error
          ? err.message
          : "Failed to load your repositories.";
    return Response.json({ error: message }, { status });
  }
}
