import { parseAuditReportJson } from "./report-parse";

describe("parseAuditReportJson", () => {
  it("returns ok for a minimal valid report", () => {
    const json = JSON.stringify({
      schemaVersion: 6,
      generatedAt: "2026-04-15T00:00:00.000Z",
      workspaceRoot: "/repo",
      angularJsonPath: "/repo/angular.json",
      projects: [],
      findings: [],
      importGraph: { nodes: 0, edges: 0, cycles: 0 },
      summary: { projects: 0, components: 0, services: 0, routes: 0 },
      projectTree: { projects: [] },
      duplicateGroups: [],
      hotspotScores: [],
      analyzerCategories: []
    });

    const res = parseAuditReportJson(json);
    expect(res.ok).toBeTrue();
    if (res.ok) {
      expect(res.report.schemaVersion).toBe(6);
      expect(res.report.projects).toEqual([]);
      expect(res.report.findings).toEqual([]);
    }
  });

  it("parses schemaVersion 7 symbols, method references, and projectTree files", () => {
    const json = JSON.stringify({
      schemaVersion: 7,
      generatedAt: "2026-04-16T00:00:00.000Z",
      workspaceRoot: "/repo",
      angularJsonPath: "angular.json",
      projects: [],
      findings: [],
      importGraph: { nodes: 1, edges: 0, cycles: 0 },
      summary: { projects: 0, components: 0, services: 0, routes: 0 },
      projectTree: {
        projects: [
          {
            name: "demo",
            root: null,
            sourceRoot: "src",
            sourceRoots: [
              {
                sourceRoot: "src",
                rootFolder: {
                  path: "src",
                  folders: [],
                  files: [
                    {
                      filePath: "src/app/a.ts",
                      classes: [{ classId: "class:src/app/a.ts#A@1", methodIds: ["method:src/app/a.ts#A.foo@3"] }]
                    }
                  ],
                  components: [],
                  directives: [],
                  pipes: [],
                  services: [],
                  routes: []
                }
              }
            ]
          }
        ]
      },
      symbols: {
        files: [{ id: "file:src/app/a.ts", filePath: "src/app/a.ts" }],
        classes: [{ id: "class:src/app/a.ts#A@1", name: "A", filePath: "src/app/a.ts", startLine: 1, endLine: 10 }],
        methods: [
          {
            id: "method:src/app/a.ts#A.foo@3",
            name: "foo",
            filePath: "src/app/a.ts",
            classId: "class:src/app/a.ts#A@1",
            className: "A",
            visibility: "public",
            startLine: 3,
            endLine: 5,
            metrics: { lineCount: 3, branchCount: 1, parameterCount: 2 }
          }
        ]
      },
      methodReferences: [
        {
          methodId: "method:src/app/a.ts#A.foo@3",
          filePath: "src/app/b.ts",
          line: 10,
          column: 5,
          snippet: "a.foo()"
        }
      ],
      duplicateGroups: [
        {
          id: "dup:exact:abc",
          kind: "exact",
          hash: "abc",
          tokenCount: 10,
          lineCount: 5,
          preview: "foo() { return 1; }",
          occurrences: [
            {
              filePath: "src/app/a.ts",
              startLine: 3,
              endLine: 5,
              lineCount: 3,
              tokenCount: 10,
              methodId: "method:src/app/a.ts#A.foo@3"
            }
          ]
        }
      ],
      hotspotScores: [],
      analyzerCategories: []
    });

    const res = parseAuditReportJson(json);
    expect(res.ok).toBeTrue();
    if (res.ok) {
      expect(res.report.schemaVersion).toBe(7);
      expect(res.report.symbols.methods.length).toBe(1);
      expect(res.report.methodReferences.length).toBe(1);
      expect(res.report.projectTree.projects[0]?.sourceRoots[0]?.rootFolder.files.length).toBe(1);
      expect(res.report.duplicateGroups[0]?.id).toBe("dup:exact:abc");
      expect(res.report.duplicateGroups[0]?.occurrences[0]?.methodId).toBe("method:src/app/a.ts#A.foo@3");
    }
  });

  it("returns an error for non-report JSON", () => {
    const res = parseAuditReportJson(JSON.stringify({ hello: "world" }));
    expect(res.ok).toBeFalse();
  });
});
