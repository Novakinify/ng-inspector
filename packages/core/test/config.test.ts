import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, applyRuleOverrides, createExcludeMatcher, loadWorkspaceConfig } from "../src/config";
import type { AnalyzerFinding } from "../src/types";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("loadWorkspaceConfig returns defaults when config file is missing", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-config-missing-"));
  const cfg = await loadWorkspaceConfig(workspaceRootAbs);
  assert.deepEqual(cfg, DEFAULT_CONFIG);
});

test("loadWorkspaceConfig merges user config over defaults and ignores unknown/invalid fields", async () => {
  const workspaceRootAbs = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-config-merge-"));

  await writeFile(
    path.join(workspaceRootAbs, "ng-inspector.config.json"),
    JSON.stringify(
      {
        exclude: { paths: ["./tmp", "src/generated/**"] },
        thresholds: { componentTsLines: 10, serviceMixedMinSignals: 5 },
        rules: {
          "component-large-ts": "error",
          "service-mixed-responsibility": "off",
          "not-a-rule": "nope",
        },
        report: { outputDir: "reports" },
        unknown: { any: "thing" },
      },
      null,
      2,
    ),
  );

  const cfg = await loadWorkspaceConfig(workspaceRootAbs);

  assert.deepEqual(cfg.exclude.paths, ["tmp", "src/generated/**"]);
  assert.equal(cfg.thresholds.componentTsLines, 10);
  assert.equal(cfg.thresholds.serviceMixedMinSignals, 5);
  assert.equal(cfg.thresholds.componentTemplateLines, DEFAULT_CONFIG.thresholds.componentTemplateLines);
  assert.equal(cfg.rules["component-large-ts"], "error");
  assert.equal(cfg.rules["service-mixed-responsibility"], "off");
  assert.equal(cfg.rules["not-a-rule"], undefined);
  assert.equal(cfg.report.outputDir, "reports");
});

test("createExcludeMatcher supports prefix and glob patterns", async () => {
  const isExcluded = createExcludeMatcher(["src/generated", "src/**/secret.ts"]);

  assert.equal(isExcluded("src/generated/a.ts"), true);
  assert.equal(isExcluded("src/generated/deep/x.ts"), true);
  assert.equal(isExcluded("src/app/secret.ts"), true);
  assert.equal(isExcluded("src/app/feature/secret.ts"), true);
  assert.equal(isExcluded("src/app/feature/public.ts"), false);
});

test("applyRuleOverrides suppresses findings and rewrites severity", async () => {
  const findings: AnalyzerFinding[] = [
    {
      severity: "warning",
      category: "components",
      confidence: "high",
      code: "component-large-ts",
      message: "x",
      whyItMatters: "x",
      suggestedActions: ["a"],
      filePath: "src/app/a.component.ts",
      metadata: {
        projectName: "demo",
        componentFilePath: "src/app/a.component.ts",
        tsLineCount: 10,
        maxTsLines: 5,
      },
    },
    {
      severity: "warning",
      category: "services",
      confidence: "high",
      code: "service-large-ts",
      message: "y",
      whyItMatters: "y",
      suggestedActions: ["b"],
      filePath: "src/app/a.service.ts",
      metadata: {
        projectName: "demo",
        serviceFilePath: "src/app/a.service.ts",
        tsLineCount: 10,
        maxTsLines: 5,
      },
    },
  ];

  const out = applyRuleOverrides(findings, { "component-large-ts": "error", "service-large-ts": "off" });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.code, "component-large-ts");
  assert.equal(out[0]?.severity, "error");
});
