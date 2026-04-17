import { createScanSnapshot } from "./scan-snapshot";
import type { AuditReport } from "./report-schema";

describe("createScanSnapshot", () => {
  it("captures summary and finding counts", () => {
    const report: AuditReport = {
      schemaVersion: 6,
      generatedAt: "2026-04-15T00:00:00.000Z",
      workspaceRoot: "/repo",
      angularJsonPath: "/repo/angular.json",
      projects: [],
      findings: [
        {
          severity: "warning",
          category: "components",
          confidence: "high",
          code: "component-large-ts",
          message: "m",
          whyItMatters: "w",
          suggestedActions: [],
          filePath: "a.ts",
          metadata: {}
        },
        {
          severity: "info",
          category: "imports",
          confidence: "medium",
          code: "import-cycle",
          message: "m2",
          whyItMatters: "w2",
          suggestedActions: [],
          filePath: "b.ts",
          metadata: {}
        }
      ],
      importGraph: { nodes: 1, edges: 2, cycles: 0 },
      summary: { projects: 0, components: 0, services: 0, routes: 0 },
      projectTree: { projects: [] },
      symbols: { files: [], classes: [], methods: [] },
      methodReferences: [],
      duplicateGroups: [],
      hotspotScores: [],
      analyzerCategories: []
    };

    const snap = createScanSnapshot(report, "file");
    expect(snap.findingsTotal).toBe(2);
    expect(snap.findingsBySeverity.warning).toBe(1);
    expect(snap.findingsBySeverity.info).toBe(1);
    expect(snap.findingsByCode["component-large-ts"]).toBe(1);
  });
});
