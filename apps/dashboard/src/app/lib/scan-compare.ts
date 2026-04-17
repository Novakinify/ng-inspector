import type { FindingSeverity } from "./report-schema";
import type { ScanSnapshot } from "./scan-snapshot";

export interface ScanCompareDelta {
  projects: number;
  components: number;
  services: number;
  routes: number;
  findingsTotal: number;
  findingsBySeverity: Record<FindingSeverity, number>;
  duplicatesGroupCount: number;
  hotspotsCount: number;
  importNodes: number;
  importEdges: number;
  importCycles: number;
}

export interface ScanCodeDelta {
  code: string;
  from: number;
  to: number;
  delta: number;
}

export interface ScanCompareResult {
  from: ScanSnapshot;
  to: ScanSnapshot;
  delta: ScanCompareDelta;
  topCodeDeltas: ScanCodeDelta[];
}

export function compareScans(from: ScanSnapshot, to: ScanSnapshot): ScanCompareResult {
  const findingsBySeverityDelta: Record<FindingSeverity, number> = {
    error: (to.findingsBySeverity.error ?? 0) - (from.findingsBySeverity.error ?? 0),
    warning: (to.findingsBySeverity.warning ?? 0) - (from.findingsBySeverity.warning ?? 0),
    info: (to.findingsBySeverity.info ?? 0) - (from.findingsBySeverity.info ?? 0)
  };

  const delta: ScanCompareDelta = {
    projects: to.summary.projects - from.summary.projects,
    components: to.summary.components - from.summary.components,
    services: to.summary.services - from.summary.services,
    routes: to.summary.routes - from.summary.routes,
    findingsTotal: to.findingsTotal - from.findingsTotal,
    findingsBySeverity: findingsBySeverityDelta,
    duplicatesGroupCount: to.duplicatesGroupCount - from.duplicatesGroupCount,
    hotspotsCount: to.hotspotsCount - from.hotspotsCount,
    importNodes: to.importGraph.nodes - from.importGraph.nodes,
    importEdges: to.importGraph.edges - from.importGraph.edges,
    importCycles: to.importGraph.cycles - from.importGraph.cycles
  };

  const codes = new Set<string>([
    ...Object.keys(from.findingsByCode),
    ...Object.keys(to.findingsByCode)
  ]);

  const topCodeDeltas = Array.from(codes)
    .map((code): ScanCodeDelta => {
      const a = from.findingsByCode[code] ?? 0;
      const b = to.findingsByCode[code] ?? 0;
      return { code, from: a, to: b, delta: b - a };
    })
    .filter((d) => d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12);

  return { from, to, delta, topCodeDeltas };
}

