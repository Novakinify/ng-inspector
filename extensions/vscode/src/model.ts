import type { AnalyzerFinding, FindingSeverity } from "./types";

export interface GroupedFindings {
  severity: FindingSeverity;
  total: number;
  byCode: Array<{
    code: string;
    total: number;
    findings: AnalyzerFinding[];
  }>;
}

const SEVERITY_ORDER: readonly FindingSeverity[] = ["error", "warning", "info"];

export function groupFindings(findings: AnalyzerFinding[]): GroupedFindings[] {
  const bySeverity = new Map<FindingSeverity, AnalyzerFinding[]>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);

  for (const f of findings) {
    bySeverity.get(f.severity)?.push(f);
  }

  const out: GroupedFindings[] = [];
  for (const severity of SEVERITY_ORDER) {
    const sevFindings = bySeverity.get(severity) ?? [];
    if (sevFindings.length === 0) continue;

    const codeMap = new Map<string, AnalyzerFinding[]>();
    for (const f of sevFindings) {
      const bucket = codeMap.get(f.code);
      if (bucket) bucket.push(f);
      else codeMap.set(f.code, [f]);
    }

    const byCode = [...codeMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, codeFindings]) => {
        const sorted = [...codeFindings].sort((a, b) => `${a.filePath}\n${a.message}`.localeCompare(`${b.filePath}\n${b.message}`));
        return { code, total: sorted.length, findings: sorted };
      });

    out.push({ severity, total: sevFindings.length, byCode });
  }

  return out;
}

