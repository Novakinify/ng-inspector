import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import type { AnalyzerFinding } from "../types";

export interface ServiceAnalyzerConfig {
  maxServiceTsLines: number;

  /**
   * Minimum file size before we consider mixed-responsibility heuristics.
   * Keeps the signal conservative: small services can legitimately touch many things.
   */
  mixedResponsibilityMinLines: number;

  /**
   * Minimum number of distinct concern signals required to flag a service
   * as likely mixed-responsibility.
   */
  mixedResponsibilityMinSignals: number;
}

export const DEFAULT_SERVICE_ANALYZER_CONFIG: ServiceAnalyzerConfig = {
  maxServiceTsLines: 200,
  mixedResponsibilityMinLines: 120,
  mixedResponsibilityMinSignals: 3,
};

export interface AnalyzeServicesOptions {
  workspaceRootAbs: string;
  projectName: string;
  serviceFilePaths: string[]; // workspace-relative, posix
  config?: Partial<ServiceAnalyzerConfig>;
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function expectedSpecPath(serviceFilePath: string): string | null {
  if (!serviceFilePath.endsWith(".service.ts")) return null;
  return serviceFilePath.replace(/\.service\.ts$/, ".service.spec.ts");
}

function stableSortFindings(findings: AnalyzerFinding[]): void {
  findings.sort((a, b) => {
    const keyA = `${a.filePath}\n${a.code}`;
    const keyB = `${b.filePath}\n${b.code}`;
    return keyA.localeCompare(keyB);
  });
}

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

/**
 * Conservative mixed-responsibility heuristic:
 * We only flag when a service is non-trivial AND it shows signals from multiple distinct concerns.
 *
 * AST-based scanning avoids false positives from comments and string literals.
 */
function detectConcernSignals(sourceFile: ts.SourceFile): string[] {
  let hasHttp = false;
  let hasRouting = false;
  let hasStorage = false;
  let hasUi = false;
  let hasState = false;

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleText = moduleSpecifierText(stmt.moduleSpecifier);
    if (!moduleText) continue;

    if (moduleText === "@angular/common/http") hasHttp = true;
    if (moduleText === "@angular/router") hasRouting = true;
    if (moduleText.startsWith("@angular/material")) hasUi = true;
    if (moduleText === "@ngrx/store") hasState = true;
  }

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const name = node.text;

      if (name === "localStorage" || name === "sessionStorage" || name === "indexedDB") hasStorage = true;

      if (name === "HttpClient") hasHttp = true;
      if (name === "Router" || name === "ActivatedRoute") hasRouting = true;
      if (name === "MatDialog" || name === "MatSnackBar" || name === "ToastrService") hasUi = true;

      if (
        name === "BehaviorSubject" ||
        name === "ReplaySubject" ||
        name === "Subject" ||
        name === "signal" ||
        name === "computed" ||
        name === "effect" ||
        name === "Store"
      ) {
        hasState = true;
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  const signals: string[] = [];
  if (hasHttp) signals.push("http");
  if (hasRouting) signals.push("routing");
  if (hasStorage) signals.push("storage");
  if (hasUi) signals.push("ui");
  if (hasState) signals.push("state");
  return signals;
}

export async function analyzeServices(options: AnalyzeServicesOptions): Promise<AnalyzerFinding[]> {
  const config: ServiceAnalyzerConfig = { ...DEFAULT_SERVICE_ANALYZER_CONFIG, ...(options.config ?? {}) };
  const findings: AnalyzerFinding[] = [];

  for (const serviceFilePath of options.serviceFilePaths) {
    if (options.isExcludedPath?.(serviceFilePath)) continue;

    const serviceAbs = path.resolve(options.workspaceRootAbs, serviceFilePath);
    const tsText = await fs.readFile(serviceAbs, "utf8");
    const sourceFile = ts.createSourceFile(serviceAbs, tsText, ts.ScriptTarget.Latest, true);

    const tsLineCount = countLines(tsText);

    if (tsLineCount > config.maxServiceTsLines) {
      findings.push({
        severity: "warning",
        category: "services",
        confidence: "high",
        code: "service-large-ts",
        message: `${serviceFilePath} is ${tsLineCount} lines (max ${config.maxServiceTsLines}).`,
        whyItMatters: "Large services can become difficult to change safely and often accumulate unrelated responsibilities.",
        suggestedActions: ["Split the service by responsibility (API/state/ui/etc).", "Extract helper functions or sub-services."],
        filePath: serviceFilePath,
        metadata: {
          projectName: options.projectName,
          serviceFilePath,
          tsLineCount,
          maxTsLines: config.maxServiceTsLines,
        },
      });
    }

    const specRel = expectedSpecPath(serviceFilePath);
    if (specRel) {
      const specAbs = path.resolve(options.workspaceRootAbs, specRel);
      const hasSpec = await fileExists(specAbs);
      if (!hasSpec) {
        findings.push({
          severity: "warning",
          category: "services",
          confidence: "high",
          code: "service-missing-spec",
          message: `${serviceFilePath} has no matching spec file (${specRel}).`,
          whyItMatters: "Missing specs reduce confidence in service refactors and can hide regressions in core logic.",
          suggestedActions: ["Add a basic service spec and cover key behaviors."],
          filePath: serviceFilePath,
          metadata: {
            projectName: options.projectName,
            serviceFilePath,
            expectedSpecFilePath: specRel,
          },
        });
      }
    }

    if (tsLineCount >= config.mixedResponsibilityMinLines) {
      const signals = detectConcernSignals(sourceFile);
      if (signals.length >= config.mixedResponsibilityMinSignals) {
        findings.push({
          severity: "warning",
          category: "services",
          confidence: "medium",
          code: "service-mixed-responsibility",
          message: `${serviceFilePath} shows mixed-responsibility signals: ${signals.join(", ")}.`,
          whyItMatters: "Services that combine multiple concerns are harder to test and evolve; changes in one area can break others.",
          suggestedActions: [
            "Split the service into smaller services by concern (API/routing/storage/state).",
            "Introduce a facade that orchestrates smaller services if needed.",
          ],
          filePath: serviceFilePath,
          metadata: {
            projectName: options.projectName,
            serviceFilePath,
            tsLineCount,
            signals,
            minSignals: config.mixedResponsibilityMinSignals,
            minLines: config.mixedResponsibilityMinLines,
          },
        });
      }
    }
  }

  stableSortFindings(findings);
  return findings;
}

