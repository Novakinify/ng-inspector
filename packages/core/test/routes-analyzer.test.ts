import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeRoutes } from "../src/analyzers/routes-analyzer";
import type { AnalyzerFinding, LargeRoutesConfigFinding } from "../src/types";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("routes analyzer detects large routes config files conservatively", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-routes-analyzer-"));

  const routesRel = "src/app/app.routes.ts";
  await writeFile(
    path.join(workspaceRootAbs, "src", "app", "app.routes.ts"),
    [
      "import { Routes } from '@angular/router';",
      "export const routes: Routes = [",
      "  { path: '', component: null as any },",
      "  { path: 'a', component: null as any },",
      "];",
      "// filler",
      "// filler",
      "// filler",
      "",
    ].join("\n"),
  );

  const findings = await analyzeRoutes({
    workspaceRootAbs,
    projectName: "demo",
    routesFilePaths: [routesRel],
    config: { maxRoutesTsLines: 5 },
  });

  const codes = new Set(findings.map((f) => f.code));
  assert.ok(codes.has("routes-large-config"));

  const isLarge = (f: AnalyzerFinding): f is LargeRoutesConfigFinding => f.code === "routes-large-config";
  const large = findings.find(isLarge);
  assert.ok(large);
  assert.equal(large.filePath, routesRel);
  assert.equal(large.metadata.routeObjectCount, 2);
});

