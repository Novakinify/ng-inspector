import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverInSourceRoot } from "../src/discover";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("AST discovery finds components, directives, pipes, and injectables imported from @angular/core", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-discover-"));
  const sourceRootAbs = path.join(workspaceRootAbs, "src");

  await writeFile(
    path.join(sourceRootAbs, "app", "a.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'x', template: '' })",
      "export class A {}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(sourceRootAbs, "app", "b.ts"),
    [
      "import { Directive as Dir } from '@angular/core';",
      "@Dir({ selector: '[x]' })",
      "export class B {}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(sourceRootAbs, "app", "c.ts"),
    [
      "import * as ng from '@angular/core';",
      "@ng.Pipe({ name: 'c' })",
      "export class C {}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(sourceRootAbs, "app", "d.ts"),
    [
      "import { Injectable } from '@angular/core';",
      "@Injectable({ providedIn: 'root' })",
      "export class D {}",
      "",
    ].join("\n"),
  );

  // Should not be detected: decorator name without a matching @angular/core import.
  await writeFile(
    path.join(sourceRootAbs, "app", "fake.ts"),
    [
      "@Component({ selector: 'nope', template: '' })",
      "export class Fake {}",
      "",
    ].join("\n"),
  );

  const discovered = await discoverInSourceRoot({ workspaceRootAbs, sourceRootAbs });

  assert.deepEqual(discovered.components.map((f) => f.filePath), ["src/app/a.ts"]);
  assert.deepEqual(discovered.directives.map((f) => f.filePath), ["src/app/b.ts"]);
  assert.deepEqual(discovered.pipes.map((f) => f.filePath), ["src/app/c.ts"]);
  assert.deepEqual(discovered.services.map((f) => f.filePath), ["src/app/d.ts"]);
});

test("AST route discovery extracts nested children paths and avoids duplicates", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-routes-"));
  const sourceRootAbs = path.join(workspaceRootAbs, "src");

  await writeFile(
    path.join(sourceRootAbs, "app", "app.routes.ts"),
    [
      "import { Routes, provideRouter } from '@angular/router';",
      "export const routes: Routes = [",
      "  { path: '', component: null as any, children: [ { path: 'child', component: null as any } ] },",
      "];",
      "export const providers = [provideRouter(routes)];",
      "",
    ].join("\n"),
  );

  const discovered = await discoverInSourceRoot({ workspaceRootAbs, sourceRootAbs });
  const routePaths = discovered.routes.map((r) => r.path);

  assert.deepEqual(routePaths, ["", "child"]);
});

