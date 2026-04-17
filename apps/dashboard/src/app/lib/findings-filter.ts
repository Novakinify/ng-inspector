import type { AnalyzerFinding, FindingSeverity } from "./report-schema";

export interface FindingsFilterState {
  severity: FindingSeverity | "all";
  category: string | "all";
  codeQuery: string;
  textQuery: string;
}

export type FindingsSortKey = "severity" | "code" | "filePath";

export function filterFindings(
  findings: readonly AnalyzerFinding[],
  filter: FindingsFilterState
): AnalyzerFinding[] {
  const codeQuery = filter.codeQuery.trim().toLowerCase();
  const textQuery = filter.textQuery.trim().toLowerCase();

  return findings.filter((f) => {
    if (filter.severity !== "all" && f.severity !== filter.severity) return false;
    if (filter.category !== "all" && f.category !== filter.category) return false;
    if (codeQuery && !f.code.toLowerCase().includes(codeQuery)) return false;
    if (textQuery) {
      const haystack = `${f.message}\n${f.filePath}\n${f.whyItMatters}`.toLowerCase();
      if (!haystack.includes(textQuery)) return false;
    }
    return true;
  });
}

export function sortFindings(findings: AnalyzerFinding[], key: FindingsSortKey): AnalyzerFinding[] {
  const copy = [...findings];
  copy.sort((a, b) => {
    if (key === "severity") {
      const bySeverity = compareSeverityDesc(a.severity, b.severity);
      if (bySeverity !== 0) return bySeverity;
    }

    if (key === "code") {
      const byCode = a.code.localeCompare(b.code);
      if (byCode !== 0) return byCode;
    }

    // Default stable-ish tie-breakers.
    const byFile = a.filePath.localeCompare(b.filePath);
    if (byFile !== 0) return byFile;
    return a.message.localeCompare(b.message);
  });
  return copy;
}

export function compareSeverityDesc(a: FindingSeverity, b: FindingSeverity): number {
  return severityRank(b) - severityRank(a);
}

function severityRank(s: FindingSeverity): number {
  switch (s) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

