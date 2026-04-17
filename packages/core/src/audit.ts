import fs from "node:fs/promises";
import path from "node:path";

import { analyzeComponents } from "./analyzers/component-analyzer";
import { analyzeTsComplexity } from "./analyzers/complexity-analyzer";
import { analyzeLifecycleLeakRisks } from "./analyzers/lifecycle-analyzer";
import { analyzeRoutes } from "./analyzers/routes-analyzer";
import { analyzeServices } from "./analyzers/service-analyzer";
import { analyzeSymbols } from "./analyzers/symbols-analyzer";
import { readAngularJson } from "./angular-json";
import { applyRuleOverrides, createExcludeMatcher, loadWorkspaceConfig } from "./config";
import { discoverInSourceRoot } from "./discover";
import { computeHotspotScores } from "./hotspots";
import { buildImportGraph } from "./import-graph";
import { toWorkspaceRelativePosixPath } from "./path";
import { buildProjectTree } from "./project-tree";
import type { AnalyzerFinding, AuditReport, AuditWorkspaceOptions, ProjectReport } from "./types";

async function dirExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function resolveSourceRootAbs(workspaceRootAbs: string, root: string | null, sourceRoot: string | null) {
  if (sourceRoot) return path.resolve(workspaceRootAbs, sourceRoot);
  if (root) {
    const candidate = path.resolve(workspaceRootAbs, root, "src");
    if (await dirExists(candidate)) return candidate;
  }
  return null;
}

export async function auditWorkspace(options: AuditWorkspaceOptions): Promise<AuditReport> {
  const workspaceRootAbs = path.resolve(options.workspaceRoot);
  const angularJsonPathAbs = path.join(workspaceRootAbs, "angular.json");

  const config = options.config ?? (await loadWorkspaceConfig(workspaceRootAbs));
  const isExcludedPath = createExcludeMatcher(config.exclude.paths);

  const angularJson = await readAngularJson(angularJsonPathAbs);
  const projectsRecord = angularJson.projects ?? {};
  const projectNames = Object.keys(projectsRecord).sort((a, b) => a.localeCompare(b));

  const projects: ProjectReport[] = [];
  const findings: AnalyzerFinding[] = [];
  const sourceRootAbsList: string[] = [];

  for (const name of projectNames) {
    const project = projectsRecord[name];
    const root = typeof project?.root === "string" ? project.root : null;
    const sourceRoot = typeof project?.sourceRoot === "string" ? project.sourceRoot : null;
    const sourceRootAbs = await resolveSourceRootAbs(workspaceRootAbs, root, sourceRoot);
    const sourceRootRelPosix = sourceRootAbs ? toWorkspaceRelativePosixPath(workspaceRootAbs, sourceRootAbs) : null;

    const discovered =
      sourceRootAbs && (await dirExists(sourceRootAbs))
        ? await discoverInSourceRoot({ workspaceRootAbs, sourceRootAbs, isExcludedPath })
        : { components: [], directives: [], pipes: [], services: [], routes: [] };

    if (sourceRootAbs && (await dirExists(sourceRootAbs))) sourceRootAbsList.push(sourceRootAbs);

    projects.push({
      name,
      root,
      sourceRoot: sourceRootRelPosix,
      components: discovered.components,
      directives: discovered.directives,
      pipes: discovered.pipes,
      services: discovered.services,
      routes: discovered.routes,
    });

    // Conservative v1: only component-focused analyzers.
    const componentFindings = await analyzeComponents({
      workspaceRootAbs,
      projectName: name,
      componentFilePaths: discovered.components.map((c) => c.filePath),
      config: {
        maxComponentTsLines: config.thresholds.componentTsLines,
        maxTemplateLines: config.thresholds.componentTemplateLines,
      },
      isExcludedPath,
    });
    findings.push(...componentFindings);

    const serviceFindings = await analyzeServices({
      workspaceRootAbs,
      projectName: name,
      serviceFilePaths: discovered.services.map((s) => s.filePath),
      config: {
        maxServiceTsLines: config.thresholds.serviceTsLines,
        mixedResponsibilityMinLines: config.thresholds.serviceMixedMinLines,
        mixedResponsibilityMinSignals: config.thresholds.serviceMixedMinSignals,
      },
      isExcludedPath,
    });
    findings.push(...serviceFindings);

    const routeFilePaths = Array.from(new Set(discovered.routes.map((r) => r.filePath))).sort((a, b) => a.localeCompare(b));
    const routeFindings = await analyzeRoutes({
      workspaceRootAbs,
      projectName: name,
      routesFilePaths: routeFilePaths,
      isExcludedPath,
    });
    findings.push(...routeFindings);
  }

  const summary = projects.reduce(
    (acc, p) => {
      acc.projects += 1;
      acc.components += p.components.length;
      acc.services += p.services.length;
      acc.routes += p.routes.length;
      return acc;
    },
    { projects: 0, components: 0, services: 0, routes: 0 },
  );

  const importGraphResult = await buildImportGraph({ workspaceRootAbs, sourceRootAbsList, isExcludedPath });
  for (const cycleNodes of importGraphResult.cycles) {
    if (!cycleNodes.length) continue;
    const filePath = cycleNodes[0];
    findings.push({
      severity: "warning",
      category: "imports",
      confidence: "high",
      code: "import-cycle",
      message: `Import cycle detected (${cycleNodes.length} files): ${cycleNodes.join(", ")}.`,
      whyItMatters: "Import cycles can make refactors risky and may cause unexpected runtime or build-time behavior.",
      suggestedActions: ["Break the cycle by extracting shared code into a separate module.", "Invert dependencies or introduce an interface boundary."],
      filePath,
      metadata: {
        nodes: cycleNodes,
        nodeCount: cycleNodes.length,
      },
    });
  }

  const lifecycleFindings = await analyzeLifecycleLeakRisks({
    workspaceRootAbs,
    filePaths: importGraphResult.graph.nodes,
    isExcludedPath,
  });
  findings.push(...lifecycleFindings);

  const finalFindings = applyRuleOverrides(findings, config.rules);

  const symbolAnalysis = await analyzeSymbols({
    workspaceRootAbs,
    filePaths: importGraphResult.graph.nodes,
    isExcludedPath,
  });

  const projectTree = buildProjectTree(projects, {
    filePaths: importGraphResult.graph.nodes,
    symbols: symbolAnalysis.symbols,
  });

  const complexity = await analyzeTsComplexity({
    workspaceRootAbs,
    filePaths: importGraphResult.graph.nodes,
    isExcludedPath,
  });

  const duplicateGroups = symbolAnalysis.duplicateGroups;

  const hotspotScores = computeHotspotScores({
    complexity,
    duplicateGroups,
    findings: finalFindings,
    importGraph: importGraphResult.graph,
  });

  const analyzerCategories = [
    {
      id: "projectTree",
      title: "Project Tree",
      description: "Normalized project/sourceRoot folder tree derived from discovered artifacts.",
      findingCodes: [] as string[],
      reportKeys: ["projectTree"],
    },
    {
      id: "components",
      title: "Component Analyzer",
      description: "Component size/style/spec checks (conservative heuristics).",
      findingCodes: [
        "component-large-ts",
        "component-large-template",
        "component-inline-template",
        "component-inline-styles",
        "component-missing-spec",
        "component-http-calls",
        "component-many-injections",
        "component-standalone-duplicate-imports",
      ],
      reportKeys: [] as string[],
    },
    {
      id: "services",
      title: "Service Analyzer",
      description: "Service size/spec and mixed-responsibility heuristic checks.",
      findingCodes: ["service-large-ts", "service-mixed-responsibility", "service-missing-spec"],
      reportKeys: [] as string[],
    },
    {
      id: "routes",
      title: "Routes",
      description: "Route configuration checks (conservative).",
      findingCodes: ["routes-large-config"],
      reportKeys: [] as string[],
    },
    {
      id: "imports",
      title: "Import Graph",
      description: "Relative import graph summary and conservative cycle detection.",
      findingCodes: ["import-cycle"],
      reportKeys: ["importGraph"],
    },
    {
      id: "lifecycle",
      title: "Lifecycle + Leak Risk",
      description: "Conservative cleanup-risk detection for subscriptions, timers, listeners, and effects.",
      findingCodes: [
        "lifecycle-unmanaged-subscribe",
        "lifecycle-fromEvent-subscribe-no-cleanup",
        "lifecycle-broken-destroy-subject",
        "lifecycle-subscription-field-not-unsubscribed",
        "lifecycle-addEventListener-no-remove",
        "lifecycle-setInterval-no-clearInterval",
        "lifecycle-requestAnimationFrame-no-cancelAnimationFrame",
        "lifecycle-effect-missing-onCleanup",
        "lifecycle-toSignal-manualCleanup",
      ],
      reportKeys: [] as string[],
    },
    {
      id: "duplication",
      title: "Duplication (Methods)",
      description: "Duplicate method bodies (exact + normalized), extracted conservatively using AST scanning + normalization.",
      findingCodes: [] as string[],
      reportKeys: ["duplicateGroups"],
    },
    {
      id: "symbols",
      title: "Symbols",
      description: "Class/method symbol index for drilldown UIs (AST + type-checker where practical).",
      findingCodes: [] as string[],
      reportKeys: ["symbols", "methodReferences"],
    },
    {
      id: "hotspots",
      title: "Hotspots",
      description: "Per-file hotspot scoring from complexity/duplication/spec/import coupling signals.",
      findingCodes: [] as string[],
      reportKeys: ["hotspotScores"],
    },
  ];

  return {
    schemaVersion: 7,
    generatedAt: new Date().toISOString(),
    workspaceRoot: workspaceRootAbs,
    angularJsonPath: "angular.json",
    projects,
    findings: finalFindings,
    importGraph: importGraphResult.summary,
    summary,
    projectTree,
    symbols: symbolAnalysis.symbols,
    methodReferences: symbolAnalysis.methodReferences,
    duplicateGroups,
    hotspotScores,
    analyzerCategories,
  };
}
