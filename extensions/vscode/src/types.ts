export type FindingSeverity = "error" | "warning" | "info";

export interface AnalyzerFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
  filePath: string; // workspace-relative posix path
  metadata: Record<string, unknown>;
}

export interface AuditReportLite {
  schemaVersion?: number;
  generatedAt?: string;
  workspaceRoot?: string;
  findings: AnalyzerFinding[];
}

