import {
  answerFollowup,
  candidateFiles,
  judgeFilesToFetch,
} from "@/lib/agents";
import { GitHubError, getFileContent, getTree } from "@/lib/github";
import type {
  FollowupContext,
  FollowupEvent,
  FollowupMode,
  FollowupTurn,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  context?: FollowupContext;
  question?: string;
  mode?: FollowupMode;
  thread?: FollowupTurn[];
}

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  const context = body.context;
  const mode: FollowupMode = body.mode ?? "auto";
  const thread = Array.isArray(body.thread) ? body.thread : [];

  if (!question) {
    return Response.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (!context || !context.owner || !context.repo) {
    return Response.json({ error: "Missing analysis context. Re-run the analysis." }, { status: 400 });
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
      const send = (event: FollowupEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const extraFiles: { path: string; content: string }[] = [];

        // Light mode answers from the gathered context only. Auto and Deep may
        // read more files — Deep always does (when relevant files exist), Auto
        // only when it judges the existing context insufficient.
        if (mode !== "light") {
          try {
            send({ type: "status", text: "Reviewing the analysis…" });
            const tree = await getTree(context.owner, context.repo, context.defaultBranch, token);
            const candidates = candidateFiles(tree, context.sampledFiles);
            const { enoughContext, files } = await judgeFilesToFetch({
              context,
              question,
              candidatePaths: candidates,
            });

            const toFetch = mode === "deep" ? files : enoughContext ? [] : files;

            if (toFetch.length > 0) {
              send({
                type: "status",
                text: `Reading ${toFetch.length} more file${toFetch.length === 1 ? "" : "s"}…`,
              });
              await Promise.all(
                toFetch.map(async (path) => {
                  const content = await getFileContent(context.owner, context.repo, path, token, 1200);
                  if (content) extraFiles.push({ path, content });
                }),
              );
              extraFiles.sort((a, b) => toFetch.indexOf(a.path) - toFetch.indexOf(b.path));
              if (extraFiles.length > 0) {
                send({ type: "files", files: extraFiles.map((f) => f.path) });
              }
            }
          } catch (err) {
            // Reading more files is best-effort; fall back to the existing context.
            const why =
              err instanceof GitHubError ? err.message : "couldn't read additional files";
            send({ type: "status", text: `Answering from the existing analysis (${why}).` });
          }
        }

        await answerFollowup({
          context,
          thread,
          question,
          extraFiles,
          onText: (text) => send({ type: "delta", text }),
        });

        send({ type: "done" });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong answering the question.";
        send({ type: "error", error: message });
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
