// Shared types for the Repo → Resume pipeline.

export interface RepoRef {
  owner: string;
  repo: string;
}

// A repository the authenticated user can access (for the "browse my repos" picker).
export interface UserRepo {
  owner: string;
  repo: string;
  fullName: string; // "owner/repo"
  description: string | null;
  private: boolean;
  stars: number;
  language: string | null;
  updatedAt: string;
}

export interface RepoMeta {
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  forks: number;
  topics: string[];
  homepage: string | null;
  license: string | null;
  defaultBranch: string;
}

// Agent 1 — Repo Scout output.
export interface ScoutSummary {
  projectType: string;
  mainPurpose: string;
  coreTechnologies: string[];
  infraAndDevOps: string[];
  architecturePatterns: string[];
  scaleSignals: { stars: number; forks: number };
  notableFeatures: string[];
}

// Agent 2 — Code Analyst output.
export interface AnalystReport {
  frameworksAndLibraries: string[];
  databasesAndStorage: string[];
  testingApproach: string | null;
  deploymentAndCI: string[];
  architecturalDecisions: string[];
  codeQualitySignals: string[];
  performanceFeatures: string[];
}

// Agent 3 — Career Writer output.
export interface TalkingPoint {
  question: string;
  answer: string;
}

export interface JobTitle {
  title: string;
  reason: string;
}

export interface TechStack {
  languages: string[];
  frameworks: string[];
  databases: string[];
  infrastructure: string[];
  testing: string[];
}

export interface CareerProfile {
  summary: string;
  bullets: string[];
  talkingPoints: TalkingPoint[];
  techStack: TechStack;
  jobTitles: JobTitle[];
}

// Everything a follow-up question needs to be answered, carried from the
// analysis to the client and passed back to /api/followup.
export interface FollowupContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  scout: ScoutSummary;
  report: AnalystReport;
  summary: string; // the generated profile summary
  sampledFiles: string[]; // file paths the Analyst already read
}

export interface AnalysisResult {
  repo: { owner: string; repo: string; stars: number; forks: number };
  profile: CareerProfile;
  context: FollowupContext;
}

// ---- Follow-up Q&A ----
// "light" never reads more files; "deep" always pulls in the most relevant
// unread files; "auto" reads more only if it judges the context insufficient.
export type FollowupMode = "auto" | "light" | "deep";

export interface FollowupTurn {
  question: string;
  answer: string;
}

// Streamed events (NDJSON) from /api/followup.
export type FollowupEvent =
  | { type: "status"; text: string }
  | { type: "files"; files: string[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

// Streamed pipeline events (NDJSON) from /api/analyze.
export type PipelineStage = "scout" | "analyst" | "writer";
export type StageStatus = "running" | "done";

export type PipelineEvent =
  | { type: "stage"; stage: PipelineStage; status: StageStatus; detail?: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; error: string; status?: number };
