import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import { toWorkspaceRelativePosixPath } from "./path";
import { walkFiles } from "./walk";
import type { ImportGraphSummary } from "./types";

export interface ImportGraph {
  nodes: string[]; // workspace-relative posix paths
  edges: Record<string, string[]>; // from -> to[] (workspace-relative)
}

export interface ImportGraphBuildResult {
  graph: ImportGraph;
  summary: ImportGraphSummary;
  cycles: string[][]; // each is a set of nodes participating in a cycle (SCC)
}

export interface BuildImportGraphOptions {
  workspaceRootAbs: string;
  sourceRootAbsList: string[];
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

function isAnalyzableTsFile(absPath: string): boolean {
  if (!absPath.endsWith(".ts")) return false;
  if (absPath.endsWith(".d.ts")) return false;
  if (absPath.endsWith(".spec.ts")) return false;
  return true;
}

function normalizeModuleSpecifier(spec: string): string | null {
  // Conservative: ignore query/hash (often non-file imports in bundlers).
  if (spec.includes("?") || spec.includes("#")) return null;
  return spec;
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("..");
}

function resolveToTsFileAbs(fromFileAbs: string, spec: string, nodeAbsSet: Set<string>): string | null {
  const normalized = normalizeModuleSpecifier(spec);
  if (!normalized) return null;
  if (!isRelativeSpecifier(normalized)) return null;

  const baseAbs = path.resolve(path.dirname(fromFileAbs), normalized);

  const candidates: string[] = [];

  const ext = path.extname(baseAbs).toLowerCase();
  if (ext) {
    candidates.push(baseAbs);

    // Some TS setups import source files using a .js extension (NodeNext / bundlers).
    if (ext === ".js") candidates.push(baseAbs.slice(0, -3) + ".ts");
  } else {
    candidates.push(baseAbs + ".ts");
    candidates.push(path.join(baseAbs, "index.ts"));
  }

  for (const c of candidates) {
    if (nodeAbsSet.has(c)) return c;
  }
  return null;
}

function stableSortGraph(graph: ImportGraph): void {
  graph.nodes.sort((a, b) => a.localeCompare(b));
  for (const from of Object.keys(graph.edges)) {
    graph.edges[from] = Array.from(new Set(graph.edges[from] ?? [])).sort((a, b) => a.localeCompare(b));
  }
}

function countEdges(graph: ImportGraph): number {
  let edges = 0;
  for (const from of Object.keys(graph.edges)) edges += graph.edges[from]?.length ?? 0;
  return edges;
}

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function extractModuleSpecifiersFromAst(sourceFile: ts.SourceFile): string[] {
  const out: string[] = [];

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const text = moduleSpecifierText(stmt.moduleSpecifier);
      if (text) out.push(text);
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      const text = moduleSpecifierText(stmt.moduleSpecifier);
      if (text) out.push(text);
      continue;
    }
  }

  const visit = (node: ts.Node) => {
    // dynamic import("x")
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) out.push(arg0.text);
    }

    // import("x").Type (type-only)
    if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) out.push(arg.literal.text);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return out;
}

/**
 * Cycle detection using Tarjan SCC.
 * We return SCCs that represent cycles (size>1 or self-loop).
 *
 * This is conservative and avoids enumerating every simple cycle in a graph.
 */
export function findImportCycles(graph: ImportGraph): string[][] {
  const indexByNode = new Map<string, number>();
  const lowlinkByNode = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  let index = 0;

  const edges = graph.edges;

  const strongConnect = (v: string) => {
    indexByNode.set(v, index);
    lowlinkByNode.set(v, index);
    index += 1;

    stack.push(v);
    onStack.add(v);

    for (const w of edges[v] ?? []) {
      if (!indexByNode.has(w)) {
        strongConnect(w);
        const vLow = lowlinkByNode.get(v) ?? 0;
        const wLow = lowlinkByNode.get(w) ?? 0;
        lowlinkByNode.set(v, Math.min(vLow, wLow));
      } else if (onStack.has(w)) {
        const vLow = lowlinkByNode.get(v) ?? 0;
        const wIndex = indexByNode.get(w) ?? 0;
        lowlinkByNode.set(v, Math.min(vLow, wIndex));
      }
    }

    if ((lowlinkByNode.get(v) ?? 0) === (indexByNode.get(v) ?? 0)) {
      const scc: string[] = [];
      for (;;) {
        const w = stack.pop();
        if (!w) break;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      sccs.push(scc);
    }
  };

  for (const node of graph.nodes) {
    if (!indexByNode.has(node)) strongConnect(node);
  }

  const cycles: string[][] = [];
  for (const scc of sccs) {
    if (scc.length > 1) {
      cycles.push([...scc].sort((a, b) => a.localeCompare(b)));
      continue;
    }
    const only = scc[0];
    if (!only) continue;
    if ((edges[only] ?? []).includes(only)) cycles.push([only]);
  }

  cycles.sort((a, b) => a.join("\n").localeCompare(b.join("\n")));
  return cycles;
}

export async function buildImportGraph(options: BuildImportGraphOptions): Promise<ImportGraphBuildResult> {
  const workspaceRootAbs = path.resolve(options.workspaceRootAbs);
  const uniqueSourceRoots = Array.from(new Set(options.sourceRootAbsList.map((p) => path.resolve(p)))).sort((a, b) =>
    a.localeCompare(b),
  );

  const nodeAbs: string[] = [];
  for (const rootAbs of uniqueSourceRoots) {
    for await (const fileAbs of walkFiles(rootAbs)) {
      if (!isAnalyzableTsFile(fileAbs)) continue;
      const rel = toWorkspaceRelativePosixPath(workspaceRootAbs, fileAbs);
      if (options.isExcludedPath?.(rel)) continue;
      nodeAbs.push(fileAbs);
    }
  }

  const nodeAbsSet = new Set(nodeAbs);
  const relByAbs = new Map<string, string>();
  for (const abs of nodeAbs) relByAbs.set(abs, toWorkspaceRelativePosixPath(workspaceRootAbs, abs));

  const edges: Record<string, string[]> = {};
  for (const fromAbs of nodeAbs) {
    const fromRel = relByAbs.get(fromAbs);
    if (!fromRel) continue;

    const tsText = await fs.readFile(fromAbs, "utf8");
    const sourceFile = ts.createSourceFile(fromAbs, tsText, ts.ScriptTarget.Latest, true);
    const specifiers = extractModuleSpecifiersFromAst(sourceFile);
    for (const spec of specifiers) {
      const toAbs = resolveToTsFileAbs(fromAbs, spec, nodeAbsSet);
      if (!toAbs) continue;

      const toRel = relByAbs.get(toAbs);
      if (!toRel) continue;

      (edges[fromRel] ??= []).push(toRel);
    }
  }

  const graph: ImportGraph = {
    nodes: nodeAbs.map((abs) => relByAbs.get(abs)).filter((v): v is string => typeof v === "string"),
    edges,
  };
  stableSortGraph(graph);

  const cycles = findImportCycles(graph);

  const summary: ImportGraphSummary = {
    nodes: graph.nodes.length,
    edges: countEdges(graph),
    cycles: cycles.length,
  };

  return { graph, summary, cycles };
}
