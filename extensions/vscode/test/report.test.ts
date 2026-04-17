import assert from "node:assert/strict";
import test from "node:test";

import { groupFindings } from "../src/model";
import { parseAuditReportJson } from "../src/report";

test("parseAuditReportJson parses findings conservatively", () => {
  const parsed = parseAuditReportJson({
    schemaVersion: 4,
    generatedAt: "2026-01-01T00:00:00.000Z",
    workspaceRoot: "/x",
    findings: [
      {
        severity: "warning",
        code: "component-large-ts",
        message: "x",
        filePath: "src/app/a.component.ts",
        metadata: {},
      },
      {
        // invalid severity should be dropped
        severity: "nope",
        code: "bad",
        message: "y",
        filePath: "src/app/b.ts",
        metadata: {},
      },
    ],
  });

  assert.ok(parsed);
  assert.equal(parsed?.schemaVersion, 4);
  assert.equal(parsed?.findings.length, 1);
  assert.equal(parsed?.findings[0]?.code, "component-large-ts");
});

test("groupFindings groups by severity then by code", () => {
  const groups = groupFindings([
    { severity: "warning", code: "a", message: "m1", filePath: "src/a.ts", metadata: {} },
    { severity: "warning", code: "a", message: "m2", filePath: "src/b.ts", metadata: {} },
    { severity: "warning", code: "b", message: "m3", filePath: "src/c.ts", metadata: {} },
    { severity: "error", code: "a", message: "m4", filePath: "src/d.ts", metadata: {} },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.severity, "error");
  assert.equal(groups[0]?.total, 1);
  assert.equal(groups[1]?.severity, "warning");
  assert.equal(groups[1]?.byCode.length, 2);
  assert.equal(groups[1]?.byCode[0]?.code, "a");
  assert.equal(groups[1]?.byCode[0]?.total, 2);
});

