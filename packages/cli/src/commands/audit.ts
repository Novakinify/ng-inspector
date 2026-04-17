import fs from "node:fs/promises";
import path from "node:path";

import type { AuditReport } from "@ng-inspector/core";

import { loadCoreModule } from "../core-loader";

export interface RunAuditOptions {
  workspaceRoot: string;
}

export interface RunAuditResult {
  reportPathAbs: string;
  htmlPathAbs: string;
  report: AuditReport;
}

function resolveOutDirAbs(workspaceRootAbs: string, outputDir: string): string {
  const fallback = path.join(workspaceRootAbs, ".ng-inspector");

  if (!outputDir || typeof outputDir !== "string") return fallback;
  if (path.isAbsolute(outputDir)) return fallback;

  const abs = path.resolve(workspaceRootAbs, outputDir);
  const rel = path.relative(workspaceRootAbs, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return fallback;

  return abs;
}

export async function runAuditCommand(options: RunAuditOptions): Promise<RunAuditResult> {
  const workspaceRootAbs = path.resolve(options.workspaceRoot);

  const core = loadCoreModule();
  const config = await core.loadWorkspaceConfig(workspaceRootAbs);
  const report = await core.auditWorkspace({ workspaceRoot: workspaceRootAbs, config });
  const brief = core.generateEngineeringBrief(report);

  const outDirAbs = resolveOutDirAbs(workspaceRootAbs, config.report.outputDir);
  const reportPathAbs = path.join(outDirAbs, "report.json");
  const htmlPathAbs = path.join(outDirAbs, "report.html");
  const briefJsonPathAbs = path.join(outDirAbs, "brief.json");
  const briefMdPathAbs = path.join(outDirAbs, "brief.md");

  await fs.mkdir(outDirAbs, { recursive: true });
  await fs.writeFile(reportPathAbs, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(htmlPathAbs, core.renderHtmlReport(report), "utf8");
  await fs.writeFile(briefJsonPathAbs, JSON.stringify(brief, null, 2) + "\n", "utf8");
  await fs.writeFile(briefMdPathAbs, core.renderEngineeringBriefMarkdown(brief), "utf8");

  return { reportPathAbs, htmlPathAbs, report };
}
