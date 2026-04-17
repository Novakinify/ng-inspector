import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAuditCommand } from "../src/commands/audit";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("ng-inspector audit writes .ng-inspector/report.json", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-cli-"));

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

  const result = await runAuditCommand({ workspaceRoot });
  assert.equal(path.basename(result.reportPathAbs), "report.json");
  assert.equal(path.basename(result.htmlPathAbs), "report.html");

  const raw = await fs.readFile(path.join(workspaceRoot, ".ng-inspector", "report.json"), "utf8");
  const parsed = JSON.parse(raw) as { schemaVersion?: unknown; summary?: { components?: unknown } };

  assert.equal(parsed.schemaVersion, 7);
  assert.equal(parsed.summary?.components, 1);

  const html = await fs.readFile(path.join(workspaceRoot, ".ng-inspector", "report.html"), "utf8");
  assert.ok(html.includes("<title>ng-inspector report</title>"));

  const briefRaw = await fs.readFile(path.join(workspaceRoot, ".ng-inspector", "brief.json"), "utf8");
  const briefParsed = JSON.parse(briefRaw) as { schemaVersion?: unknown; health?: { score?: unknown } };
  assert.equal(briefParsed.schemaVersion, 1);
  assert.equal(typeof briefParsed.health?.score, "number");

  const briefMd = await fs.readFile(path.join(workspaceRoot, ".ng-inspector", "brief.md"), "utf8");
  assert.ok(briefMd.includes("# ng-inspector engineering brief"));
});
