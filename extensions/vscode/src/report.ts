import fs from "node:fs/promises";
import path from "node:path";

import type { AnalyzerFinding, AuditReportLite, FindingSeverity } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is FindingSeverity {
  return value === "error" || value === "warning" || value === "info";
}

function parseFinding(value: unknown): AnalyzerFinding | null {
  if (!isRecord(value)) return null;
  if (!isSeverity(value.severity)) return null;
  if (typeof value.code !== "string" || value.code.trim().length === 0) return null;
  if (typeof value.message !== "string") return null;
  if (typeof value.filePath !== "string" || value.filePath.trim().length === 0) return null;
  if (!isRecord(value.metadata)) return null;

  return {
    severity: value.severity,
    code: value.code,
    message: value.message,
    filePath: value.filePath,
    metadata: value.metadata,
  };
}

export function parseAuditReportJson(value: unknown): AuditReportLite | null {
  if (!isRecord(value)) return null;

  const rawFindings = value.findings;
  if (!Array.isArray(rawFindings)) return null;

  const findings: AnalyzerFinding[] = [];
  for (const f of rawFindings) {
    const parsed = parseFinding(f);
    if (parsed) findings.push(parsed);
  }

  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : undefined,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : undefined,
    workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot : undefined,
    findings,
  };
}

export function reportJsonPathAbs(workspaceRootAbs: string): string {
  return path.join(workspaceRootAbs, ".ng-inspector", "report.json");
}

export function reportHtmlPathAbs(workspaceRootAbs: string): string {
  return path.join(workspaceRootAbs, ".ng-inspector", "report.html");
}

export async function readAuditReport(workspaceRootAbs: string): Promise<AuditReportLite | null> {
  const reportPath = reportJsonPathAbs(workspaceRootAbs);
  let raw: string;
  try {
    raw = await fs.readFile(reportPath, "utf8");
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: unknown }).code === "ENOENT") return null;
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return parseAuditReportJson(parsed);
}

