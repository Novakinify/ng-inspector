import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeTsComplexity } from "../src/analyzers/complexity-analyzer";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("complexity analyzer reports line/method/ctor/branch metrics conservatively", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-complexity-"));
  const fileRel = "src/app/complex.ts";
  const fileAbs = path.join(workspaceRootAbs, "src", "app", "complex.ts");

  const lines = [
    "export class A {",
    "  constructor(a: string, b: number, c: boolean, d: any) {}",
    "  one(cond: boolean) {",
    "    if (cond) { console.log('x'); }",
    "    for (let i = 0; i < 1; i++) { console.log(i); }",
    "    while (false) { /* noop */ }",
    "    const x = cond ? 1 : 2;",
    "    try { throw new Error('x'); } catch (e) { console.log(e); }",
    "    switch (x) {",
    "      case 1: break;",
    "      default: break;",
    "    }",
    "  }",
    "  two() { return 1; }",
    "}",
    "",
  ];

  await writeFile(fileAbs, lines.join("\n"));

  const out = await analyzeTsComplexity({ workspaceRootAbs, filePaths: [fileRel] });
  assert.equal(out.length, 1);

  const m = out[0];
  assert.equal(m?.filePath, fileRel);
  assert.equal(m?.lineCount, lines.length);
  assert.equal(m?.classCount, 1);
  assert.equal(m?.methodCount, 2);
  assert.equal(m?.constructorParamCountMax, 4);

  // Branch count heuristic:
  // if (1) + for (1) + while (1) + conditional (1) + catch (1) + case/default (2) = 7
  assert.equal(m?.branchCount, 7);
});

