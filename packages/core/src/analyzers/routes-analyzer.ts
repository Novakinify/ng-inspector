import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import type { AnalyzerFinding } from "../types";

export interface RoutesAnalyzerConfig {
  maxRoutesTsLines: number;
}

export const DEFAULT_ROUTES_ANALYZER_CONFIG: RoutesAnalyzerConfig = {
  maxRoutesTsLines: 250,
};

export interface AnalyzeRoutesOptions {
  workspaceRootAbs: string;
  projectName: string;
  routesFilePaths: string[]; // workspace-relative, posix
  config?: Partial<RoutesAnalyzerConfig>;
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function getAngularRouterTypeNames(sourceFile: ts.SourceFile): { routesNames: Set<string>; routeNames: Set<string> } {
  const routesNames = new Set<string>();
  const routeNames = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleText = moduleSpecifierText(stmt.moduleSpecifier);
    if (moduleText !== "@angular/router") continue;

    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    for (const el of namedBindings.elements) {
      const imported = el.propertyName?.text ?? el.name.text;
      const local = el.name.text;
      if (imported === "Routes") routesNames.add(local);
      if (imported === "Route") routeNames.add(local);
    }
  }

  return { routesNames, routeNames };
}

function isRoutesType(typeNode: ts.TypeNode | undefined, names: Set<string>): boolean {
  if (!typeNode) return false;
  if (!ts.isTypeReferenceNode(typeNode)) return false;
  return ts.isIdentifier(typeNode.typeName) && names.has(typeNode.typeName.text);
}

function isRouteArrayType(typeNode: ts.TypeNode | undefined, routeNames: Set<string>): boolean {
  if (!typeNode) return false;
  if (ts.isArrayTypeNode(typeNode)) {
    const el = typeNode.elementType;
    return ts.isTypeReferenceNode(el) && ts.isIdentifier(el.typeName) && routeNames.has(el.typeName.text);
  }
  return false;
}

function countTopLevelRouteObjects(sourceFile: ts.SourceFile, routesNames: Set<string>, routeNames: Set<string>): number {
  let count = 0;

  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) continue;
      const typeNode = decl.type;
      const isRoutes = isRoutesType(typeNode, routesNames) || isRouteArrayType(typeNode, routeNames);
      if (!isRoutes) continue;

      for (const el of decl.initializer.elements) {
        if (ts.isObjectLiteralExpression(el)) count += 1;
      }
    }
  }

  return count;
}

function stableSortFindings(findings: AnalyzerFinding[]): void {
  findings.sort((a, b) => `${a.filePath}\n${a.code}`.localeCompare(`${b.filePath}\n${b.code}`));
}

export async function analyzeRoutes(options: AnalyzeRoutesOptions): Promise<AnalyzerFinding[]> {
  const config: RoutesAnalyzerConfig = { ...DEFAULT_ROUTES_ANALYZER_CONFIG, ...(options.config ?? {}) };

  const findings: AnalyzerFinding[] = [];

  for (const routesFilePath of options.routesFilePaths) {
    if (options.isExcludedPath?.(routesFilePath)) continue;

    const routesAbs = path.resolve(options.workspaceRootAbs, routesFilePath);
    let tsText: string;
    try {
      tsText = await fs.readFile(routesAbs, "utf8");
    } catch {
      continue;
    }

    const tsLineCount = countLines(tsText);
    if (tsLineCount <= config.maxRoutesTsLines) continue;

    const sourceFile = ts.createSourceFile(routesAbs, tsText, ts.ScriptTarget.Latest, true);
    const routerTypes = getAngularRouterTypeNames(sourceFile);
    const routeObjectCount = countTopLevelRouteObjects(sourceFile, routerTypes.routesNames, routerTypes.routeNames);

    // Extra conservatism: only report if it looks like an Angular router file.
    const looksLikeRoutesFile =
      routerTypes.routesNames.size > 0 || routerTypes.routeNames.size > 0 || routesFilePath.endsWith(".routes.ts");
    if (!looksLikeRoutesFile) continue;

    findings.push({
      severity: "warning",
      category: "routes",
      confidence: "high",
      code: "routes-large-config",
      message: `${routesFilePath} is ${tsLineCount} lines (max ${config.maxRoutesTsLines}).`,
      whyItMatters: "Large route configuration files are hard to review and can become a bottleneck for feature work.",
      suggestedActions: [
        "Split routes by feature (one routes file per feature folder).",
        "Prefer lazy-loaded routes for large feature areas.",
      ],
      filePath: routesFilePath,
      metadata: {
        projectName: options.projectName,
        routesFilePath,
        tsLineCount,
        maxTsLines: config.maxRoutesTsLines,
        routeObjectCount,
      },
    });
  }

  stableSortFindings(findings);
  return findings;
}

