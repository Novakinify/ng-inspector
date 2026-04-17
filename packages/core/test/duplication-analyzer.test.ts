import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeDuplicates } from "../src/analyzers/duplication-analyzer";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("duplication analyzer detects exact duplicate blocks across files", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-dup-exact-"));

  const aRel = "src/a.ts";
  const bRel = "src/b.ts";

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
      "  work(nums: number[]) {",
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
      "  work(nums: number[]) {",
      ...bodyLines.map((l) => "    " + l),
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  const groups = await analyzeDuplicates({
    workspaceRootAbs,
    filePaths: [aRel, bRel],
    config: { minBlockLines: 6, minBlockTokens: 20 },
  });

  const exact = groups.filter((g) => g.kind === "exact");
  assert.ok(exact.length >= 1);
  assert.ok(exact.some((g) => new Set(g.occurrences.map((o) => o.filePath)).has(aRel) && new Set(g.occurrences.map((o) => o.filePath)).has(bRel)));
});

test("duplication analyzer detects normalized duplicate blocks across files", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-dup-norm-"));

  const aRel = "src/a.ts";
  const bRel = "src/b.ts";

  await writeFile(
    path.join(workspaceRootAbs, "src", "a.ts"),
    [
      "export class A {",
      "  work(items: string[]) {",
      "    const total = items.length;",
      "    const out: string[] = [];",
      "    for (const item of items) {",
      "      if (item.length > 2) {",
      "        out.push(item.toUpperCase());",
      "      } else {",
      "        out.push('x');",
      "      }",
      "    }",
      "    return out.join(',') + total;",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(workspaceRootAbs, "src", "b.ts"),
    [
      "export class B {",
      "  work(values: string[]) {",
      "    const count = values.length;",
      "    const result: string[] = [];",
      "    for (const v of values) {",
      "      if (v.length > 2) {",
      "        result.push(v.toUpperCase());",
      "      } else {",
      "        result.push('y');",
      "      }",
      "    }",
      "    return result.join(',') + count;",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  const groups = await analyzeDuplicates({
    workspaceRootAbs,
    filePaths: [aRel, bRel],
    config: { minBlockLines: 8, minBlockTokens: 40 },
  });

  const normalized = groups.filter((g) => g.kind === "normalized");
  assert.ok(normalized.length >= 1);
  assert.ok(
    normalized.some((g) => {
      const files = new Set(g.occurrences.map((o) => o.filePath));
      return files.has(aRel) && files.has(bRel);
    }),
  );
});

