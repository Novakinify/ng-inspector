import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { TsFileComplexityMetrics } from "../types";

export interface ComplexityAnalyzerOptions {
  workspaceRootAbs: string;
  filePaths: string[]; // workspace-relative posix paths
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}

function branchDelta(node: ts.Node): number {
  if (ts.isIfStatement(node)) return 1;
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) return 1;
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return 1;
  if (ts.isConditionalExpression(node)) return 1;
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return 1;
  if (ts.isCatchClause(node)) return 1;
  return 0;
}

function analyzeSourceFile(sourceFile: ts.SourceFile, tsText: string): Omit<TsFileComplexityMetrics, "filePath"> {
  let classCount = 0;
  let methodCount = 0;
  let constructorParamCountMax = 0;
  let branchCount = 0;

  const visit = (node: ts.Node) => {
    branchCount += branchDelta(node);

    if (ts.isClassDeclaration(node)) {
      classCount += 1;

      for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) {
          constructorParamCountMax = Math.max(constructorParamCountMax, member.parameters.length);
          continue;
        }

        // Count methods/accessors with bodies (ignore abstract signatures).
        if (ts.isMethodDeclaration(member) && member.body) methodCount += 1;
        if (ts.isGetAccessorDeclaration(member) && member.body) methodCount += 1;
        if (ts.isSetAccessorDeclaration(member) && member.body) methodCount += 1;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    lineCount: countLines(tsText),
    classCount,
    methodCount,
    constructorParamCountMax,
    branchCount,
  };
}

export async function analyzeTsComplexity(options: ComplexityAnalyzerOptions): Promise<TsFileComplexityMetrics[]> {
  const out: TsFileComplexityMetrics[] = [];

  for (const filePath of options.filePaths) {
    if (options.isExcludedPath?.(filePath)) continue;

    const abs = path.resolve(options.workspaceRootAbs, filePath);
    let tsText: string;
    try {
      tsText = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }

    const sourceFile = ts.createSourceFile(abs, tsText, ts.ScriptTarget.Latest, true);
    const metrics = analyzeSourceFile(sourceFile, tsText);
    out.push({ filePath, ...metrics });
  }

  out.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return out;
}

