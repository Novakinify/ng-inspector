import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeServices } from "../src/analyzers/service-analyzer";
import type { AnalyzerFinding, MissingServiceSpecFinding, MixedResponsibilityServiceFinding } from "../src/types";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("service analyzer detects size, mixed-responsibility signals, and missing spec", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-service-analyzer-"));

  const servicePaths = ["src/app/data.service.ts", "src/app/missing-spec.service.ts"];

  // Large + mixed responsibility (http + storage + routing), has spec.
  await writeFile(
    path.join(workspaceRoot, "src", "app", "data.service.ts"),
    [
      "import { Injectable } from '@angular/core';",
      "import { HttpClient } from '@angular/common/http';",
      "import { Router } from '@angular/router';",
      "",
      "@Injectable({ providedIn: 'root' })",
      "export class DataService {",
      "  constructor(private http: HttpClient, private router: Router) {}",
      "",
      "  load() {",
      "    const token = localStorage.getItem('t');",
      "    if (!token) { this.router.navigateByUrl('/login'); }",
      "    return this.http.get('/api');",
      "  }",
      "}",
      // filler lines to exceed mixedResponsibilityMinLines in test
      ...Array.from({ length: 20 }, () => "const x = 1;"),
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workspaceRoot, "src", "app", "data.service.spec.ts"), "describe('Data', () => {});\n");

  // Missing spec, small.
  await writeFile(
    path.join(workspaceRoot, "src", "app", "missing-spec.service.ts"),
    [
      "import { Injectable } from '@angular/core';",
      "@Injectable({ providedIn: 'root' })",
      "export class MissingSpecService {}",
      "",
    ].join("\n"),
  );

  const findings = await analyzeServices({
    workspaceRootAbs: workspaceRoot,
    projectName: "demo",
    serviceFilePaths: servicePaths,
    config: {
      maxServiceTsLines: 5,
      mixedResponsibilityMinLines: 10,
      mixedResponsibilityMinSignals: 3,
    },
  });

  const codes = new Set(findings.map((f) => f.code));
  assert.ok(codes.has("service-large-ts"));
  assert.ok(codes.has("service-mixed-responsibility"));
  assert.ok(codes.has("service-missing-spec"));

  const isMixed = (f: AnalyzerFinding): f is MixedResponsibilityServiceFinding => f.code === "service-mixed-responsibility";
  const isMissingSpec = (f: AnalyzerFinding): f is MissingServiceSpecFinding => f.code === "service-missing-spec";

  const mixed = findings.find(isMixed);
  assert.ok(mixed);
  assert.equal(mixed.filePath, "src/app/data.service.ts");
  assert.ok(mixed.metadata.signals.includes("http"));
  assert.ok(mixed.metadata.signals.includes("routing"));
  assert.ok(mixed.metadata.signals.includes("storage"));

  const missingSpec = findings.find(isMissingSpec);
  assert.ok(missingSpec);
  assert.equal(missingSpec.metadata.expectedSpecFilePath, "src/app/missing-spec.service.spec.ts");
});
