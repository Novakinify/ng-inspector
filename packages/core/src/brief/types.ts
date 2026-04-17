import type { FindingSeverity } from "../types";

export type BriefSchemaVersion = 1;

export type BriefPriority = "P0" | "P1" | "P2";

export type BriefImpact = "low" | "medium" | "high";

export type BriefEffort = "small" | "medium" | "large";

export type BriefGrade = "A" | "B" | "C" | "D" | "F";

export interface BriefCountsBySeverity {
  error: number;
  warning: number;
  info: number;
}

export interface BriefHealth {
  score: number; // 0-100
  grade: BriefGrade;
  summary: string;
}

export interface BriefSummary {
  findings: {
    total: number;
    bySeverity: BriefCountsBySeverity;
  };
  importCycles: number;
  duplicateGroups: number;
  hotspots: number;
}

// Keep ids stable (used for imports into external tools).
export type BriefAreaId =
  | "lifecycle"
  | "duplicates"
  | "oversized"
  | "import-cycles"
  | "test-gaps"
  | "hotspots"
  | (string & {});

export interface BriefArea {
  id: BriefAreaId;
  title: string;
  priority: BriefPriority;
  summary: string;
  stats: Record<string, number>;
  trackId: string;
}

export interface BriefTaskEvidence {
  // Prefer low-coupling references over embedding full report objects.
  findingCodes?: string[];
  findingRefs?: string[];
  duplicateGroupIds?: string[];
  hotspotFiles?: string[];
}

export interface BriefTask {
  id: string;
  title: string;
  description: string;
  affectedFiles: string[]; // workspace-relative posix paths
  impact: BriefImpact;
  effort: BriefEffort;
  dependencies: string[];
  evidence: BriefTaskEvidence;
}

export interface BriefTrack {
  id: string;
  areaId: BriefAreaId;
  title: string;
  description: string;
  priority: BriefPriority;
  tasks: BriefTask[];
}

export interface NgInspectorBrief {
  schemaVersion: BriefSchemaVersion;
  generatedAt: string; // ISO timestamp (matches source report)
  workspaceRoot: string;
  sourceReport: {
    schemaVersion: number;
    generatedAt: string;
  };
  health: BriefHealth;
  summary: BriefSummary;
  priorityAreas: BriefArea[];
  tracks: BriefTrack[];
}

export function emptyCountsBySeverity(): BriefCountsBySeverity {
  return { error: 0, warning: 0, info: 0 } satisfies Record<FindingSeverity, number>;
}

