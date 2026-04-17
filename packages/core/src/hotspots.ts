import type { ImportGraph } from "./import-graph";
import type { AnalyzerFinding, DuplicateGroup, HotspotScore, TsFileComplexityMetrics } from "./types";

export interface ComputeHotspotScoresOptions {
  complexity: TsFileComplexityMetrics[];
  duplicateGroups: DuplicateGroup[];
  findings: AnalyzerFinding[];
  importGraph: ImportGraph;
}

interface DupStats {
  groupHashes: Set<string>;
  occurrenceCount: number;
  duplicatedLineCount: number;
}

function isMissingSpecFinding(f: AnalyzerFinding): boolean {
  return f.code === "component-missing-spec" || f.code === "service-missing-spec";
}

/**
 * Hotspot scoring (v1) is a simple additive points model. The goal is stable,
 * low-noise ranking rather than a perfectly calibrated metric.
 *
 * Points model:
 * - Complexity: based on line/method/branch/constructor counts.
 * - Duplication: per duplicated block occurrence.
 * - Missing spec: fixed penalty.
 * - Import fan-in/out: small penalties for high coupling.
 */
export function computeHotspotScores(options: ComputeHotspotScoresOptions): HotspotScore[] {
  const complexityByFile = new Map<string, TsFileComplexityMetrics>();
  for (const c of options.complexity) complexityByFile.set(c.filePath, c);

  const dupByFile = new Map<string, DupStats>();
  for (const group of options.duplicateGroups) {
    for (const occ of group.occurrences) {
      const s = dupByFile.get(occ.filePath) ?? { groupHashes: new Set<string>(), occurrenceCount: 0, duplicatedLineCount: 0 };
      s.groupHashes.add(`${group.kind}:${group.hash}`);
      s.occurrenceCount += 1;
      s.duplicatedLineCount += occ.lineCount;
      dupByFile.set(occ.filePath, s);
    }
  }

  const missingSpec = new Set<string>();
  for (const f of options.findings) {
    if (isMissingSpecFinding(f)) missingSpec.add(f.filePath);
  }

  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();

  for (const node of options.importGraph.nodes) {
    fanOut.set(node, (options.importGraph.edges[node] ?? []).length);
    fanIn.set(node, 0);
  }

  for (const [from, tos] of Object.entries(options.importGraph.edges)) {
    if (!Array.isArray(tos)) continue;
    for (const to of tos) fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
    // Ensure all "from" nodes exist even if absent from nodes list (defensive).
    if (!fanOut.has(from)) fanOut.set(from, tos.length);
  }

  const allFiles = new Set<string>([
    ...options.importGraph.nodes,
    ...complexityByFile.keys(),
    ...dupByFile.keys(),
    ...missingSpec.keys(),
  ]);

  const out: HotspotScore[] = [];

  for (const filePath of allFiles) {
    const c = complexityByFile.get(filePath);
    const d = dupByFile.get(filePath);

    const lineCount = c?.lineCount ?? 0;
    const methodCount = c?.methodCount ?? 0;
    const constructorParamCountMax = c?.constructorParamCountMax ?? 0;
    const branchCount = c?.branchCount ?? 0;

    const duplicateGroupCount = d?.groupHashes.size ?? 0;
    const duplicateOccurrenceCount = d?.occurrenceCount ?? 0;
    const duplicatedLineCount = d?.duplicatedLineCount ?? 0;

    const hasMissingSpec = missingSpec.has(filePath);
    const inCount = fanIn.get(filePath) ?? 0;
    const outCount = fanOut.get(filePath) ?? 0;

    const complexityPoints =
      Math.min(20, Math.floor(lineCount / 50)) +
      Math.min(20, Math.floor(methodCount / 5)) +
      Math.min(20, Math.floor(branchCount / 5)) +
      Math.min(10, Math.floor(constructorParamCountMax / 4));

    const duplicationPoints = Math.min(30, duplicateOccurrenceCount * 5);
    const missingSpecPoints = hasMissingSpec ? 10 : 0;
    const fanInPoints = Math.min(10, Math.floor(inCount / 5));
    const fanOutPoints = Math.min(10, Math.floor(outCount / 10));

    const score = complexityPoints + duplicationPoints + missingSpecPoints + fanInPoints + fanOutPoints;

    out.push({
      filePath,
      score,
      factors: {
        complexity: complexityPoints,
        duplication: duplicationPoints,
        missingSpec: missingSpecPoints,
        importFanIn: fanInPoints,
        importFanOut: fanOutPoints,
      },
      metrics: {
        lineCount,
        methodCount,
        constructorParamCountMax,
        branchCount,
        duplicateGroupCount,
        duplicateOccurrenceCount,
        duplicatedLineCount,
        missingSpec: hasMissingSpec,
        fanIn: inCount,
        fanOut: outCount,
      },
    });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.filePath.localeCompare(b.filePath);
  });

  return out;
}
