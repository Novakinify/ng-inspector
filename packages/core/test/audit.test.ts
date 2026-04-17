import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditWorkspace } from "../src/audit";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("auditWorkspace discovers components, services and routes", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-core-"));

  await writeFile(
    path.join(workspaceRoot, "angular.json"),
    JSON.stringify(
      {
        version: 1,
        projects: {
          demo: {
            projectType: "application",
            root: "",
            sourceRoot: "src",
          },
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(workspaceRoot, "src", "app", "app.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'app-root', template: '' })",
      "export class AppComponent {}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(workspaceRoot, "src", "app", "feature", "feature.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'app-feature', template: '' })",
      "export class FeatureComponent {}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(workspaceRoot, "src", "app", "feature", "feature.service.ts"),
    [
      "import { Injectable } from '@angular/core';",
      "@Injectable({ providedIn: 'root' })",
      "export class FeatureService {}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(workspaceRoot, "src", "app", "app.routes.ts"),
    [
      "import { Routes } from '@angular/router';",
      "export const routes: Routes = [",
      "  { path: '', component: null as any },",
      "  { path: 'info', loadChildren: () => import('./info/info.routes').then(m => m.routes) },",
      "];",
      "",
    ].join("\n"),
  );

  const report = await auditWorkspace({ workspaceRoot });

  assert.equal(report.schemaVersion, 7);
  assert.equal(report.angularJsonPath, "angular.json");
  assert.equal(report.projects.length, 1);
  assert.equal(report.projects[0]?.name, "demo");
  assert.equal(report.summary.projects, 1);
  assert.equal(report.summary.components, 2);
  assert.equal(report.summary.services, 1);
  assert.equal(report.summary.routes, 2);
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.some((f) => f.code === "component-missing-spec"));
  assert.ok(report.importGraph.nodes > 0);
  assert.equal(report.projectTree.projects.length, 1);
  assert.ok(report.symbols.classes.length >= 1);
  assert.ok(Array.isArray(report.methodReferences));
  assert.ok(Array.isArray(report.duplicateGroups));
  assert.ok(report.hotspotScores.length > 0);
  assert.ok(report.analyzerCategories.length > 0);

  const componentFiles = report.projects[0]?.components.map((c) => c.filePath) ?? [];
  assert.deepEqual(componentFiles, [
    "src/app/app.component.ts",
    "src/app/feature/feature.component.ts",
  ]);

  const routePaths = report.projects[0]?.routes.map((r) => r.path) ?? [];
  assert.deepEqual(routePaths, ["", "info"]);
});
