import assert from "node:assert/strict";
import test from "node:test";

import { generateEngineeringBrief, renderEngineeringBriefMarkdown } from "../src/brief/brief";
import type { AuditReport, DuplicateGroup, HotspotScore } from "../src/types";

test("engineering brief groups areas into tracks and links simple dependencies", () => {
  const duplicateGroups: DuplicateGroup[] = [
    {
      id: "dup-1",
      kind: "exact",
      hash: "h1",
      tokenCount: 40,
      lineCount: 12,
      preview: "return x + y;",
      occurrences: [
        { filePath: "src/a.ts", startLine: 10, endLine: 21, lineCount: 12, tokenCount: 40 },
        { filePath: "src/b.ts", startLine: 30, endLine: 41, lineCount: 12, tokenCount: 40 },
      ],
    },
  ];

  const hotspotScores: HotspotScore[] = [
    {
      filePath: "src/app/big.component.ts",
      score: 62,
      factors: { complexity: 20, duplication: 20, missingSpec: 10, importFanIn: 6, importFanOut: 6 },
      metrics: {
        lineCount: 280,
        methodCount: 25,
        constructorParamCountMax: 8,
        branchCount: 30,
        duplicateGroupCount: 1,
        duplicateOccurrenceCount: 2,
        duplicatedLineCount: 24,
        missingSpec: true,
        fanIn: 10,
        fanOut: 20,
      },
    },
  ];

  const report: AuditReport = {
    schemaVersion: 7,
    generatedAt: "2026-01-01T00:00:00.000Z",
    workspaceRoot: "/demo/workspace",
    angularJsonPath: "angular.json",
    projects: [],
    findings: [
      {
        severity: "warning",
        category: "imports",
        confidence: "high",
        code: "import-cycle",
        message: "Import cycle detected.",
        whyItMatters: "Circular deps can cause brittle builds and tight coupling.",
        suggestedActions: ["Break the cycle by extracting shared code."],
        filePath: "src/a.ts",
        metadata: {
          nodes: ["src/a.ts", "src/b.ts", "src/c.ts"],
          nodeCount: 3,
        },
      },
      {
        severity: "warning",
        category: "lifecycle",
        confidence: "high",
        code: "lifecycle-setInterval-no-clearInterval",
        message: "setInterval() is not cleared on destroy.",
        whyItMatters: "Intervals can keep firing after component destruction.",
        suggestedActions: ["Store the interval id and clear it in ngOnDestroy."],
        filePath: "src/a.ts",
        metadata: {
          className: "DemoCmp",
          methodName: "ngOnInit",
          line: 12,
          column: 5,
          intervalIdProperty: "tickId",
        },
      },
      {
        severity: "warning",
        category: "components",
        confidence: "high",
        code: "component-large-ts",
        message: "Component TS is large (280 lines, max 200).",
        whyItMatters: "Large components are harder to reason about and test.",
        suggestedActions: ["Split into smaller components."],
        filePath: "src/app/big.component.ts",
        metadata: {
          projectName: "demo",
          componentFilePath: "src/app/big.component.ts",
          tsLineCount: 280,
          maxTsLines: 200,
        },
      },
      {
        severity: "warning",
        category: "components",
        confidence: "high",
        code: "component-missing-spec",
        message: "Missing component spec file.",
        whyItMatters: "Refactors are riskier without basic tests.",
        suggestedActions: ["Add a spec file."],
        filePath: "src/app/big.component.ts",
        metadata: {
          projectName: "demo",
          componentFilePath: "src/app/big.component.ts",
          expectedSpecFilePath: "src/app/big.component.spec.ts",
        },
      },
    ],
    importGraph: { nodes: 3, edges: 3, cycles: 1 },
    summary: { projects: 1, components: 1, services: 0, routes: 0 },
    projectTree: { projects: [] },
    symbols: { files: [], classes: [], methods: [] },
    methodReferences: [],
    duplicateGroups,
    hotspotScores,
    analyzerCategories: [],
  };

  const brief = generateEngineeringBrief(report);

  assert.equal(brief.schemaVersion, 1);
  assert.equal(brief.sourceReport.schemaVersion, 7);
  assert.equal(brief.generatedAt, report.generatedAt);
  assert.equal(typeof brief.health.score, "number");
  assert.ok(brief.health.score >= 0 && brief.health.score <= 100);

  const cycleTrack = brief.tracks.find((t) => t.areaId === "import-cycles") ?? null;
  assert.ok(cycleTrack);
  assert.equal(cycleTrack?.tasks.length, 1);
  const cycleTaskId = cycleTrack?.tasks[0]?.id ?? "";
  assert.ok(cycleTaskId.startsWith("task-cycle-"));

  const lifecycleTrack = brief.tracks.find((t) => t.areaId === "lifecycle") ?? null;
  assert.ok(lifecycleTrack);
  assert.equal(lifecycleTrack?.tasks.length, 1);
  assert.deepEqual(lifecycleTrack?.tasks[0]?.dependencies, [cycleTaskId]);

  const md = renderEngineeringBriefMarkdown(brief);
  assert.ok(md.includes("# ng-inspector engineering brief"));
  assert.ok(md.includes("## Priority Areas"));
  assert.ok(md.includes("Import Cycles"));
  assert.ok(md.includes("Lifecycle and Cleanup Risks"));
});

