import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeSymbols } from "../src/analyzers/symbols-analyzer";
import { buildProjectTree } from "../src/project-tree";
import type { ProjectReport } from "../src/types";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("symbols analyzer indexes classes/methods, finds references, and groups duplicate method bodies", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-symbols-"));

  const aRel = "src/a.ts";
  const bRel = "src/b.ts";
  const cRel = "src/c.ts";

  const bodyLines = [
    "const out: number[] = [];",
    "for (const n of nums) {",
    "  if (n % 2 === 0) {",
    "    out.push(n * 2);",
    "  } else {",
    "    out.push(n);",
    "  }",
    "}",
    "return out;",
  ];

  await writeFile(
    path.join(workspaceRootAbs, "src", "a.ts"),
    [
      "export class A {",
      "  foo(nums: number[]) {",
      ...bodyLines.map((l) => "    " + l),
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(workspaceRootAbs, "src", "b.ts"),
    [
      "export class B {",
      "  foo(nums: number[]) {",
      ...bodyLines.map((l) => "    " + l),
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(workspaceRootAbs, "src", "c.ts"),
    [
      "import { A } from './a';",
      "",
      "const a = new A();",
      "a.foo([1, 2, 3]);",
      "",
    ].join("\n"),
  );

  const result = await analyzeSymbols({
    workspaceRootAbs,
    filePaths: [aRel, bRel, cRel],
    config: { minBodyLines: 6, minBodyTokens: 20, maxReferencesPerMethod: 50 },
  });

  // Method indexing.
  const aClass = result.symbols.classes.find((c) => c.name === "A");
  assert.ok(aClass);
  assert.ok(aClass.id.startsWith("class:"));
  assert.equal(aClass.filePath, aRel);

  const aFoo = result.symbols.methods.find((m) => m.className === "A" && m.name === "foo");
  assert.ok(aFoo);
  assert.ok(aFoo.id.startsWith("method:"));
  assert.equal(aFoo.filePath, aRel);
  assert.equal(aFoo.visibility, "public");
  assert.equal(aFoo.metrics.parameterCount, 1);
  assert.ok(aFoo.metrics.branchCount >= 1);
  assert.ok(aFoo.metrics.lineCount >= 3);

  // Reference discovery (conservative).
  const refsToAFoo = result.methodReferences.filter((r) => r.methodId === aFoo.id);
  assert.ok(refsToAFoo.some((r) => r.filePath === cRel && r.snippet.includes("a.foo")));

  // Duplicate method grouping.
  const exact = result.duplicateGroups.filter((g) => g.kind === "exact");
  assert.ok(exact.length >= 1);
  assert.ok(exact.some((g) => g.preview?.includes("return out")));

  const groupWithAAndB = exact.find((g) => {
    const files = new Set(g.occurrences.map((o) => o.filePath));
    return files.has(aRel) && files.has(bRel);
  });
  assert.ok(groupWithAAndB);
  assert.ok(groupWithAAndB.id.startsWith("dup:exact:"));
  assert.ok(groupWithAAndB.occurrences.every((o) => typeof o.methodId === "string"));

  // Project tree drilldown linking files -> classIds -> methodIds.
  const projects: ProjectReport[] = [
    {
      name: "demo",
      root: "",
      sourceRoot: "src",
      components: [],
      directives: [],
      pipes: [],
      services: [],
      routes: [],
    },
  ];

  const tree = buildProjectTree(projects, { filePaths: [aRel, bRel, cRel], symbols: result.symbols });
  const p0 = tree.projects[0];
  assert.ok(p0);
  const sr0 = p0.sourceRoots[0];
  assert.ok(sr0);

  const rootFiles = sr0.rootFolder.files.map((f) => f.filePath);
  assert.ok(rootFiles.includes(aRel));
  assert.ok(rootFiles.includes(bRel));
  assert.ok(!rootFiles.includes(cRel)); // no classes in c.ts

  const aFileNode = sr0.rootFolder.files.find((f) => f.filePath === aRel);
  assert.ok(aFileNode);
  assert.ok(aFileNode.classes.some((c) => c.classId === aClass.id && c.methodIds.includes(aFoo.id)));
});

