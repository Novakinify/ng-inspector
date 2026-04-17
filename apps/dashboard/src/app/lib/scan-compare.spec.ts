import { compareScans } from "./scan-compare";
import type { ScanSnapshot } from "./scan-snapshot";

function base(id: string): ScanSnapshot {
  return {
    id,
    source: "file",
    createdAt: "2026-04-15T00:00:00.000Z",
    schemaVersion: 6,
    generatedAt: "2026-04-15T00:00:00.000Z",
    workspaceRoot: "/repo",
    summary: { projects: 1, components: 2, services: 3, routes: 4 },
    importGraph: { nodes: 10, edges: 20, cycles: 1 },
    duplicatesGroupCount: 2,
    hotspotsCount: 3,
    findingsTotal: 0,
    findingsBySeverity: { error: 0, warning: 0, info: 0 },
    findingsByCategory: {},
    findingsByCode: {}
  };
}

describe("compareScans", () => {
  it("computes numeric deltas", () => {
    const a = base("a");
    const b = {
      ...base("b"),
      summary: { projects: 1, components: 3, services: 2, routes: 4 },
      findingsTotal: 5,
      findingsBySeverity: { error: 1, warning: 2, info: 2 },
      findingsByCode: { x: 2, y: 3 },
      importGraph: { nodes: 12, edges: 19, cycles: 2 }
    };

    const res = compareScans(a, b);
    expect(res.delta.components).toBe(1);
    expect(res.delta.services).toBe(-1);
    expect(res.delta.findingsTotal).toBe(5);
    expect(res.delta.importCycles).toBe(1);
    expect(res.topCodeDeltas.length).toBeGreaterThan(0);
  });
});

