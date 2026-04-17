import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildImportGraph, findImportCycles } from "../src/import-graph";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("buildImportGraph resolves relative imports and ignores comments", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-graph-"));

  await writeFile(path.join(workspaceRootAbs, "src", "a.ts"), "import { b } from './b';\n// import './c';\n");
  await writeFile(path.join(workspaceRootAbs, "src", "b.ts"), "export const b = 1;\n");
  await writeFile(path.join(workspaceRootAbs, "src", "c.ts"), "/* import './b' */\nexport const c = 1;\n");

  const result = await buildImportGraph({ workspaceRootAbs, sourceRootAbsList: [path.join(workspaceRootAbs, "src")] });

  assert.equal(result.summary.nodes, 3);
  assert.equal(result.summary.edges, 1);
  assert.equal(result.summary.cycles, 0);

  assert.deepEqual(result.graph.edges["src/a.ts"], ["src/b.ts"]);
  assert.equal(result.graph.edges["src/c.ts"]?.length ?? 0, 0);
});

test("findImportCycles detects a simple 3-file cycle", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-cycle-"));

  await writeFile(path.join(workspaceRootAbs, "src", "a.ts"), "import './b';\n");
  await writeFile(path.join(workspaceRootAbs, "src", "b.ts"), "import './c';\n");
  await writeFile(path.join(workspaceRootAbs, "src", "c.ts"), "import './a';\n");

  const result = await buildImportGraph({ workspaceRootAbs, sourceRootAbsList: [path.join(workspaceRootAbs, "src")] });
  const cycles = findImportCycles(result.graph);

  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

