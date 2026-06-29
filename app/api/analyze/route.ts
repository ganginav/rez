import { parseRepoUrl } from "@/lib/parse";
import {
  GitHubError,
  getLanguages,
  getReadme,
  getRepoMeta,
} from "@/lib/github";
import { runAnalyst, runScout, runWriter } from "@/lib/agents";
import type { AnalysisResult, PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  let ref;
  try {
    ref = parseRepoUrl(body.url ?? "");
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server is missing ANTHROPIC_API_KEY. Add it to .env.local and restart." },
      { status: 500 },
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        // Stage 1 — Repo Scout
        send({ type: "stage", stage: "scout", status: "running" });
        const [meta, languages] = await Promise.all([
          getRepoMeta(ref.owner, ref.repo, token),
          getLanguages(ref.owner, ref.repo, token),
        ]);
        const readme = await getReadme(ref.owner, ref.repo, token);
        const scout = await runScout({
          owner: meta.owner,
          repo: meta.repo,
          description: meta.description,
          topics: meta.topics,
          homepage: meta.homepage,
          license: meta.license,
          stars: meta.stars,
          forks: meta.forks,
          languages,
          readme,
        });
        send({ type: "stage", stage: "scout", status: "done", detail: scout.projectType });

        // Stage 2 — Code Analyst
        send({ type: "stage", stage: "analyst", status: "running" });
        const { report, sampledFiles } = await runAnalyst({
          owner: meta.owner,
          repo: meta.repo,
          defaultBranch: meta.defaultBranch,
          scout,
          token,
        });
        send({
          type: "stage",
          stage: "analyst",
          status: "done",
          detail:
            sampledFiles.length > 0
              ? `${sampledFiles.length} file${sampledFiles.length === 1 ? "" : "s"} sampled`
              : "no source files sampled",
        });

        // Stage 3 — Career Writer
        send({ type: "stage", stage: "writer", status: "running" });
        const profile = await runWriter({ scout, report });
        send({ type: "stage", stage: "writer", status: "done" });

        const result: AnalysisResult = {
          repo: { owner: meta.owner, repo: meta.repo, stars: meta.stars, forks: meta.forks },
          profile,
          context: {
            owner: meta.owner,
            repo: meta.repo,
            defaultBranch: meta.defaultBranch,
            scout,
            report,
            summary: profile.summary,
            sampledFiles,
          },
        };
        send({ type: "result", result });
      } catch (err) {
        const status = err instanceof GitHubError ? err.status : 500;
        const message =
          err instanceof Error ? err.message : "Something went wrong while analyzing the repo.";
        send({ type: "error", error: message, status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
