import assert from "node:assert/strict";
import test from "node:test";

import { renderHtmlReport } from "../src/report/html-report";
import type { AuditReport } from "../src/types";

test("renderHtmlReport renders required sections and includes findings/projects/cycles", () => {
  const report: AuditReport = {
    schemaVersion: 7,
    generatedAt: "2026-01-01T00:00:00.000Z",
    workspaceRoot: "/demo/workspace",
    angularJsonPath: "angular.json",
    projects: [
      {
        name: "demo",
        root: "",
        sourceRoot: "src",
        components: [{ filePath: "src/app/app.component.ts" }],
        directives: [{ filePath: "src/app/x.directive.ts" }],
        pipes: [{ filePath: "src/app/x.pipe.ts" }],
        services: [{ filePath: "src/app/x.service.ts" }],
        routes: [{ filePath: "src/app/app.routes.ts", path: "home" }],
      },
    ],
    findings: [
      {
        severity: "warning",
        category: "components",
        confidence: "high",
        code: "component-large-ts",
        message: "Component TS is large (250 lines, max 200).",
        whyItMatters: "x",
        suggestedActions: ["a"],
        filePath: "src/app/app.component.ts",
        metadata: {
          projectName: "demo",
          componentFilePath: "src/app/app.component.ts",
          tsLineCount: 250,
          maxTsLines: 200,
        },
      },
      {
        severity: "warning",
        category: "imports",
        confidence: "high",
        code: "import-cycle",
        message: "Import cycle detected.",
        whyItMatters: "y",
        suggestedActions: ["b"],
        filePath: "src/a.ts",
        metadata: {
          nodes: ["src/a.ts", "src/b.ts", "src/a.ts"],
          nodeCount: 3,
        },
      },
    ],
    importGraph: { nodes: 10, edges: 12, cycles: 1 },
    summary: { projects: 1, components: 1, services: 1, routes: 1 },
    projectTree: { projects: [] },
    symbols: { files: [], classes: [], methods: [] },
    methodReferences: [],
    duplicateGroups: [],
    hotspotScores: [],
    analyzerCategories: [],
  };

  const html = renderHtmlReport(report);

  assert.ok(html.includes("<title>ng-inspector report</title>"));
  assert.ok(html.includes("<h2>Findings</h2>"));
  assert.ok(html.includes("<h2>Projects</h2>"));
  assert.ok(html.includes("<h2>Import Graph</h2>"));
  assert.ok(html.includes("<h2>Cycles</h2>"));

  // Spot-check key data presence without overfitting to markup/layout.
  assert.ok(html.includes("component-large-ts"));
  assert.ok(html.includes("import-cycle"));
  assert.ok(html.includes("demo"));
  assert.ok(html.includes("src/app/app.component.ts"));
  assert.ok(html.includes("src/a.ts"));
});
