import type { AuditReport, FindingSeverity } from "./report-schema";

export type ScanSource = "file" | "mock" | "local";

export interface ScanSnapshot {
  id: string;
  source: ScanSource;
  createdAt: string; // when recorded in the dashboard (ISO)

  schemaVersion: number;
  generatedAt: string; // from the report (ISO)
  workspaceRoot: string;

  summary: AuditReport["summary"];
  importGraph: AuditReport["importGraph"];

  duplicatesGroupCount: number;
  hotspotsCount: number;

  findingsTotal: number;
  findingsBySeverity: Record<FindingSeverity, number>;
  findingsByCategory: Record<string, Record<FindingSeverity, number>>;
  findingsByCode: Record<string, number>;
}

export function createScanSnapshot(report: AuditReport, source: ScanSource): ScanSnapshot {
  const now = new Date().toISOString();

  const findingsBySeverity: Record<FindingSeverity, number> = { error: 0, warning: 0, info: 0 };
  const findingsByCategory: Record<string, Record<FindingSeverity, number>> = {};
  const findingsByCode: Record<string, number> = {};

  for (const f of report.findings) {
    findingsBySeverity[f.severity] += 1;

    const cat = f.category ?? "unknown";
    findingsByCategory[cat] ??= { error: 0, warning: 0, info: 0 };
    findingsByCategory[cat][f.severity] += 1;

    findingsByCode[f.code] = (findingsByCode[f.code] ?? 0) + 1;
  }

  return {
    id: createId(),
    source,
    createdAt: now,
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    workspaceRoot: report.workspaceRoot,
    summary: report.summary,
    importGraph: report.importGraph,
    duplicatesGroupCount: report.duplicateGroups.length,
    hotspotsCount: report.hotspotScores.length,
    findingsTotal: report.findings.length,
    findingsBySeverity,
    findingsByCategory,
    findingsByCode
  };
}

function createId(): string {
  // Deterministic enough for local-only history (timestamp + random).
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

