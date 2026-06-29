// Shared types for the Repo → Resume pipeline.

export interface RepoRef {
  owner: string;
  repo: string;
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

export interface AnalysisResult {
  repo: { owner: string; repo: string; stars: number; forks: number };
  profile: CareerProfile;
}

// Streamed pipeline events (NDJSON) from /api/analyze.
export type PipelineStage = "scout" | "analyst" | "writer";
export type StageStatus = "running" | "done";

export type PipelineEvent =
  | { type: "stage"; stage: PipelineStage; status: StageStatus; detail?: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; error: string; status?: number };
