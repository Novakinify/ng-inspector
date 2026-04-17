import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeComponents } from "../src/analyzers/component-analyzer";
import type { AnalyzerFinding, LargeComponentTemplateFinding, MissingComponentSpecFinding } from "../src/types";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("component analyzer detects size, inline template/styles, and missing spec", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-component-analyzer-"));

  const componentPaths = [
    "src/app/big.component.ts",
    "src/app/big-template.component.ts",
    "src/app/inline.component.ts",
    "src/app/inline-styles.component.ts",
    "src/app/missing-spec.component.ts",
    "src/app/http.component.ts",
  ];

  // 1) Large TS component (no missing spec)
  await writeFile(
    path.join(workspaceRoot, "src", "app", "big.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({",
      "  selector: 'app-big',",
      "  templateUrl: './big.component.html',",
      "})",
      "export class BigComponent {",
      "  // filler",
      "  a = 1;",
      "  b = 2;",
      "  c = 3;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workspaceRoot, "src", "app", "big.component.html"), "<div>ok</div>\n");
  await writeFile(path.join(workspaceRoot, "src", "app", "big.component.spec.ts"), "describe('Big', () => {});\n");

  // 2) Large external template (no missing spec)
  await writeFile(
    path.join(workspaceRoot, "src", "app", "big-template.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'app-big-template', templateUrl: './big-template.component.html' })",
      "export class BigTemplateComponent {}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(workspaceRoot, "src", "app", "big-template.component.html"),
    ["<div>a</div>", "<div>b</div>", "<div>c</div>", "<div>d</div>", ""].join("\n"),
  );
  await writeFile(
    path.join(workspaceRoot, "src", "app", "big-template.component.spec.ts"),
    "describe('BigTemplate', () => {});\n",
  );

  // 3) Inline template (also large inline template; no missing spec)
  await writeFile(
    path.join(workspaceRoot, "src", "app", "inline.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({",
      "  selector: 'app-inline',",
      "  template: `",
      "line1",
      "line2",
      "line3",
      "line4",
      "`,",
      "})",
      "export class InlineComponent {}",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workspaceRoot, "src", "app", "inline.component.spec.ts"), "describe('Inline', () => {});\n");

  // 4) Inline styles (no missing spec)
  await writeFile(
    path.join(workspaceRoot, "src", "app", "inline-styles.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({",
      "  selector: 'app-inline-styles',",
      "  templateUrl: './inline-styles.component.html',",
      "  styles: [`.a { color: red; }`],",
      "})",
      "export class InlineStylesComponent {}",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workspaceRoot, "src", "app", "inline-styles.component.html"), "<div>ok</div>\n");
  await writeFile(
    path.join(workspaceRoot, "src", "app", "inline-styles.component.spec.ts"),
    "describe('InlineStyles', () => {});\n",
  );

  // 5) Missing spec
  await writeFile(
    path.join(workspaceRoot, "src", "app", "missing-spec.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'app-missing-spec', templateUrl: './missing-spec.component.html' })",
      "export class MissingSpecComponent {}",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workspaceRoot, "src", "app", "missing-spec.component.html"), "<div>ok</div>\n");

  // 6) Component anti-patterns (HttpClient in component, many injections, duplicate standalone imports)
  await writeFile(
    path.join(workspaceRoot, "src", "app", "http.component.ts"),
    [
      "import { Component } from '@angular/core';",
      "import { HttpClient } from '@angular/common/http';",
      "@Component({",
      "  selector: 'app-http',",
      "  standalone: true,",
      "  imports: [CommonModule, CommonModule],",
      "  template: '',",
      "})",
      "export class HttpComponent {",
      "  constructor(",
      "    private http: HttpClient,",
      "    private a: any,",
      "    private b: any,",
      "    private c: any,",
      "    private d: any,",
      "    private e: any,",
      "    private f: any,",
      "    private g: any,",
      "    private h: any,",
      "  ) {}",
      "  load() {",
      "    return this.http.get('/api');",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workspaceRoot, "src", "app", "http.component.spec.ts"), "describe('Http', () => {});\n");

  const findings = await analyzeComponents({
    workspaceRootAbs: workspaceRoot,
    projectName: "demo",
    componentFilePaths: componentPaths,
    config: {
      maxComponentTsLines: 5,
      maxTemplateLines: 3,
    },
  });

  const codes = new Set(findings.map((f) => f.code));
  assert.ok(codes.has("component-large-ts"));
  assert.ok(codes.has("component-large-template"));
  assert.ok(codes.has("component-inline-template"));
  assert.ok(codes.has("component-inline-styles"));
  assert.ok(codes.has("component-missing-spec"));
  assert.ok(codes.has("component-http-calls"));
  assert.ok(codes.has("component-many-injections"));
  assert.ok(codes.has("component-standalone-duplicate-imports"));

  const isLargeTemplate = (f: AnalyzerFinding): f is LargeComponentTemplateFinding => f.code === "component-large-template";
  const isMissingSpec = (f: AnalyzerFinding): f is MissingComponentSpecFinding => f.code === "component-missing-spec";

  const externalLarge = findings.find((f) => isLargeTemplate(f) && f.metadata.templateKind === "external");
  assert.ok(externalLarge);
  assert.equal(externalLarge.filePath, "src/app/big-template.component.html");

  const inlineLarge = findings.find((f) => isLargeTemplate(f) && f.metadata.templateKind === "inline");
  assert.ok(inlineLarge);
  assert.equal(inlineLarge.filePath, "src/app/inline.component.ts");

  const missingSpec = findings.find(isMissingSpec);
  assert.ok(missingSpec);
  assert.equal(missingSpec.metadata.expectedSpecFilePath, "src/app/missing-spec.component.spec.ts");
});
