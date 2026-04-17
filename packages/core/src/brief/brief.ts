import type {
  AnalyzerFinding,
  AuditReport,
  FindingSeverity,
  HotspotScore,
  ImportCycleFinding,
  LargeComponentTemplateFinding,
  LargeComponentTsFinding,
  LargeServiceTsFinding,
  MissingComponentSpecFinding,
  MissingServiceSpecFinding,
} from "../types";

import type {
  BriefArea,
  BriefAreaId,
  BriefCountsBySeverity,
  BriefEffort,
  BriefGrade,
  BriefHealth,
  BriefImpact,
  BriefPriority,
  BriefSummary,
  BriefTask,
  BriefTrack,
  NgInspectorBrief,
} from "./types";
import { emptyCountsBySeverity } from "./types";

const BRIEF_SCHEMA_VERSION = 1 as const;

const AREA_ORDER: BriefAreaId[] = ["lifecycle", "duplicates", "oversized", "import-cycles", "test-gaps", "hotspots"];

function severityRank(sev: FindingSeverity): number {
  if (sev === "error") return 3;
  if (sev === "warning") return 2;
  return 1;
}

function priorityRank(p: BriefPriority): number {
  if (p === "P0") return 3;
  if (p === "P1") return 2;
  return 1;
}

function countBySeverity(findings: readonly AnalyzerFinding[]): BriefCountsBySeverity {
  const out = emptyCountsBySeverity();
  for (const f of findings) out[f.severity] += 1;
  return out;
}

function stableHexHash8(text: string): string {
  // FNV-1a 32-bit hash, represented as 8-hex digits.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableId(prefix: string, parts: string[]): string {
  const base = parts.join("|");
  return `${prefix}-${stableHexHash8(base)}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function gradeForScore(score: number): BriefGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function computeHealth(report: AuditReport): BriefHealth {
  const bySev = countBySeverity(report.findings);
  const importCycles = report.findings.filter(isImportCycleFinding).length;
  const duplicateGroups = report.duplicateGroups.length;
  const hotHotspots = report.hotspotScores.filter((h) => h.score >= 40).length;

  // Deterministic points model; not a scientific metric.
  let score = 100;
  score -= bySev.error * 12;
  score -= bySev.warning * 4;
  score -= bySev.info * 1;
  score -= Math.min(20, importCycles * 5);
  score -= Math.min(20, Math.floor(duplicateGroups / 3));
  score -= Math.min(15, hotHotspots * 2);
  score = clampInt(score, 0, 100);

  const grade = gradeForScore(score);
  const summary = `${bySev.error} error, ${bySev.warning} warning, ${bySev.info} info; ${importCycles} import cycle(s); ${duplicateGroups} duplicate group(s); ${report.hotspotScores.length} hotspot file(s).`;

  return { score, grade, summary };
}

function isLifecycleFinding(f: AnalyzerFinding): boolean {
  return f.category === "lifecycle" || f.code.startsWith("lifecycle-");
}

function isImportCycleFinding(f: AnalyzerFinding): f is ImportCycleFinding {
  return f.code === "import-cycle";
}

function isLargeComponentFinding(
  f: AnalyzerFinding,
): f is LargeComponentTsFinding | LargeComponentTemplateFinding {
  return f.code === "component-large-ts" || f.code === "component-large-template";
}

function isLargeServiceFinding(f: AnalyzerFinding): f is LargeServiceTsFinding {
  return f.code === "service-large-ts";
}

function isMissingSpecFinding(
  f: AnalyzerFinding,
): f is MissingComponentSpecFinding | MissingServiceSpecFinding {
  return f.code === "component-missing-spec" || f.code === "service-missing-spec";
}

function findingRef(f: AnalyzerFinding): string {
  const meta = f.metadata as Record<string, unknown>;
  const line = typeof meta["line"] === "number" ? meta["line"] : null;
  const col = typeof meta["column"] === "number" ? meta["column"] : null;
  const loc = line ? `#L${line}:${typeof col === "number" ? col : 1}` : "";
  return `${f.filePath}::${f.code}${loc ? `::${loc}` : ""}`;
}

function impactFromSeverity(sev: FindingSeverity): BriefImpact {
  if (sev === "error") return "high";
  if (sev === "warning") return "high";
  return "medium";
}

function lifecycleEffort(code: string): BriefEffort {
  switch (code) {
    case "lifecycle-unmanaged-subscribe":
      return "medium";
    case "lifecycle-fromEvent-subscribe-no-cleanup":
      return "small";
    case "lifecycle-broken-destroy-subject":
      return "small";
    case "lifecycle-subscription-field-not-unsubscribed":
      return "small";
    case "lifecycle-addEventListener-no-remove":
      return "small";
    case "lifecycle-setInterval-no-clearInterval":
      return "small";
    case "lifecycle-requestAnimationFrame-no-cancelAnimationFrame":
      return "small";
    case "lifecycle-effect-missing-onCleanup":
      return "small";
    case "lifecycle-toSignal-manualCleanup":
      return "small";
    default:
      return "medium";
  }
}

function mergeDeps(deps: readonly string[]): string[] {
  return uniqueSorted(deps);
}

function dependenciesForFiles(files: readonly string[], cycleTaskIdsByFile: Map<string, string[]>): string[] {
  const deps: string[] = [];
  for (const f of files) {
    const ids = cycleTaskIdsByFile.get(f);
    if (!ids) continue;
    deps.push(...ids);
  }
  return mergeDeps(deps);
}

function buildImportCycleTasks(cycles: readonly ImportCycleFinding[]): {
  tasks: BriefTask[];
  taskIdsByFile: Map<string, string[]>;
} {
  const tasks: BriefTask[] = [];
  const taskIdsByFile = new Map<string, string[]>();

  for (const c of cycles) {
    const nodes = uniqueSorted(c.metadata.nodes ?? []);
    const id = stableId("task-cycle", nodes);
    const title = `Break import cycle (${c.metadata.nodeCount} files)`;
    const description = [
      c.message,
      "",
      "Files:",
      ...nodes.map((n) => `- ${n}`),
      "",
      "Suggested actions:",
      "- Move shared types/helpers into a lower-level module.",
      "- Replace deep imports with DI boundaries (interfaces/adapters).",
      "- Remove barrel-import loops (index.ts re-export cycles).",
    ].join("\n");

    const task: BriefTask = {
      id,
      title,
      description,
      affectedFiles: nodes,
      impact: "high",
      effort: c.metadata.nodeCount <= 3 ? "medium" : "large",
      dependencies: [],
      evidence: { findingCodes: ["import-cycle"], findingRefs: [findingRef(c)] },
    };

    tasks.push(task);
    for (const file of nodes) {
      const arr = taskIdsByFile.get(file) ?? [];
      arr.push(id);
      taskIdsByFile.set(file, arr);
    }
  }

  tasks.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  for (const [file, ids] of taskIdsByFile) taskIdsByFile.set(file, mergeDeps(ids));

  return { tasks, taskIdsByFile };
}

function buildLifecycleTasks(findings: readonly AnalyzerFinding[], cycleTaskIdsByFile: Map<string, string[]>): BriefTask[] {
  const lifecycle = findings.filter(isLifecycleFinding);

  const tasks: BriefTask[] = [];
  for (const f of lifecycle) {
    const id = stableId("task-lifecycle", [findingRef(f)]);
    const title = titleForLifecycleFinding(f);
    const description = [
      f.message,
      "",
      `Why it matters: ${f.whyItMatters}`,
      "",
      "Suggested actions:",
      ...(f.suggestedActions.length > 0 ? f.suggestedActions.map((a) => `- ${a}`) : ["- (none)"]),
    ].join("\n");

    const affectedFiles = [f.filePath];
    tasks.push({
      id,
      title,
      description,
      affectedFiles,
      impact: impactFromSeverity(f.severity),
      effort: lifecycleEffort(f.code),
      dependencies: dependenciesForFiles(affectedFiles, cycleTaskIdsByFile),
      evidence: { findingCodes: [f.code], findingRefs: [findingRef(f)] },
    });
  }

  tasks.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return tasks;
}

function titleForLifecycleFinding(f: AnalyzerFinding): string {
  // Keep these deterministic and readable; avoid embedding full metadata shapes.
  const base = f.filePath;
  switch (f.code) {
    case "lifecycle-unmanaged-subscribe":
      return `Add cleanup for long-lived subscription (${base})`;
    case "lifecycle-fromEvent-subscribe-no-cleanup":
      return `Add cleanup for fromEvent subscription (${base})`;
    case "lifecycle-broken-destroy-subject":
      return `Fix broken destroy$ cleanup pattern (${base})`;
    case "lifecycle-subscription-field-not-unsubscribed":
      return `Unsubscribe stored Subscription field (${base})`;
    case "lifecycle-addEventListener-no-remove":
      return `Remove event listener on destroy (${base})`;
    case "lifecycle-setInterval-no-clearInterval":
      return `Clear interval on destroy (${base})`;
    case "lifecycle-requestAnimationFrame-no-cancelAnimationFrame":
      return `Cancel requestAnimationFrame on destroy (${base})`;
    case "lifecycle-effect-missing-onCleanup":
      return `Add onCleanup() to effect() side-effect (${base})`;
    case "lifecycle-toSignal-manualCleanup":
      return `Review toSignal manualCleanup usage (${base})`;
    default:
      return `Lifecycle cleanup risk (${base})`;
  }
}

interface OversizedComponentInfo {
  componentFilePath: string;
  projectName: string;
  tsLineCount?: number;
  maxTsLines?: number;
  templateKind?: "external" | "inline";
  templateFilePath?: string;
  templateLineCount?: number;
  maxTemplateLines?: number;
  findingRefs: string[];
}

interface OversizedServiceInfo {
  serviceFilePath: string;
  projectName: string;
  tsLineCount: number;
  maxTsLines: number;
  findingRefs: string[];
}

function buildOversizedTasks(findings: readonly AnalyzerFinding[], cycleTaskIdsByFile: Map<string, string[]>): BriefTask[] {
  const oversizedComponents = new Map<string, OversizedComponentInfo>();
  const oversizedServices = new Map<string, OversizedServiceInfo>();

  for (const f of findings) {
    if (isLargeComponentFinding(f)) {
      const key = f.metadata.componentFilePath;
      const existing =
        oversizedComponents.get(key) ??
        ({
          componentFilePath: key,
          projectName: f.metadata.projectName,
          findingRefs: [],
        } satisfies OversizedComponentInfo);

      existing.findingRefs.push(findingRef(f));

      if (f.code === "component-large-ts") {
        existing.tsLineCount = f.metadata.tsLineCount;
        existing.maxTsLines = f.metadata.maxTsLines;
      }
      if (f.code === "component-large-template") {
        existing.templateKind = f.metadata.templateKind;
        existing.templateFilePath = f.metadata.templateFilePath;
        existing.templateLineCount = f.metadata.templateLineCount;
        existing.maxTemplateLines = f.metadata.maxTemplateLines;
      }

      oversizedComponents.set(key, existing);
      continue;
    }

    if (isLargeServiceFinding(f)) {
      const key = f.metadata.serviceFilePath;
      const existing =
        oversizedServices.get(key) ??
        ({
          serviceFilePath: key,
          projectName: f.metadata.projectName,
          tsLineCount: f.metadata.tsLineCount,
          maxTsLines: f.metadata.maxTsLines,
          findingRefs: [],
        } satisfies OversizedServiceInfo);

      existing.findingRefs.push(findingRef(f));
      oversizedServices.set(key, existing);
    }
  }

  const tasks: BriefTask[] = [];

  for (const c of oversizedComponents.values()) {
    const affectedFiles = uniqueSorted(
      c.templateFilePath && c.templateFilePath !== c.componentFilePath
        ? [c.componentFilePath, c.templateFilePath]
        : [c.componentFilePath],
    );

    const id = stableId("task-oversize", ["component", c.componentFilePath]);
    const title = `Refactor large component (${c.componentFilePath})`;
    const tsLine = typeof c.tsLineCount === "number" ? c.tsLineCount : null;
    const tplLine = typeof c.templateLineCount === "number" ? c.templateLineCount : null;

    const details: string[] = [];
    if (tsLine !== null && typeof c.maxTsLines === "number") details.push(`TS: ${tsLine} lines (max ${c.maxTsLines})`);
    if (tplLine !== null && typeof c.maxTemplateLines === "number") {
      details.push(
        `Template: ${tplLine} lines (max ${c.maxTemplateLines})${c.templateKind ? ` (${c.templateKind})` : ""}`,
      );
    }

    const description = [
      `Project: ${c.projectName}`,
      details.length ? `Size signals: ${details.join("; ")}` : "Size signals: (unknown)",
      "",
      "Suggested actions:",
      "- Split the component into smaller child components.",
      "- Move business logic into focused services and pure helpers.",
      "- Prefer OnPush + memoized derived state where appropriate.",
    ].join("\n");

    tasks.push({
      id,
      title,
      description,
      affectedFiles,
      impact: "medium",
      effort: tsLine !== null && tsLine >= (c.maxTsLines ?? 0) * 2 ? "large" : "medium",
      dependencies: dependenciesForFiles(affectedFiles, cycleTaskIdsByFile),
      evidence: { findingCodes: ["component-large-ts", "component-large-template"], findingRefs: uniqueSorted(c.findingRefs) },
    });
  }

  for (const s of oversizedServices.values()) {
    const affectedFiles = [s.serviceFilePath];
    const id = stableId("task-oversize", ["service", s.serviceFilePath]);
    const title = `Refactor large service (${s.serviceFilePath})`;
    const description = [
      `Project: ${s.projectName}`,
      `Size signals: TS ${s.tsLineCount} lines (max ${s.maxTsLines})`,
      "",
      "Suggested actions:",
      "- Split responsibilities into smaller domain services.",
      "- Extract pure utilities for formatting/mapping logic.",
      "- Keep services focused: I/O, state, or orchestration (not all).",
    ].join("\n");

    tasks.push({
      id,
      title,
      description,
      affectedFiles,
      impact: "medium",
      effort: s.tsLineCount >= s.maxTsLines * 2 ? "large" : "medium",
      dependencies: dependenciesForFiles(affectedFiles, cycleTaskIdsByFile),
      evidence: { findingCodes: ["service-large-ts"], findingRefs: uniqueSorted(s.findingRefs) },
    });
  }

  tasks.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return tasks;
}

function duplicateScore(groupLineCount: number, occurrences: number): number {
  // Simple deterministic score to order groups (approx duplicated lines).
  return groupLineCount * occurrences;
}

function buildDuplicateTasks(
  duplicateGroups: ReadonlyArray<AuditReport["duplicateGroups"][number]>,
  cycleTaskIdsByFile: Map<string, string[]>,
): BriefTask[] {
  const groups = [...duplicateGroups].sort((a, b) => {
    const as = duplicateScore(a.lineCount, a.occurrences.length);
    const bs = duplicateScore(b.lineCount, b.occurrences.length);
    if (bs !== as) return bs - as;
    return a.id.localeCompare(b.id);
  });

  const tasks: BriefTask[] = [];
  for (const g of groups) {
    const files = uniqueSorted(g.occurrences.map((o) => o.filePath));
    const id = stableId("task-dup", [g.id, g.kind, g.hash]);
    const title = `Deduplicate ${g.kind} block (${g.lineCount} lines, ${g.occurrences.length} occurrences)`;

    const sample = g.occurrences
      .slice(0, 8)
      .map((o) => `- ${o.filePath}:${o.startLine}-${o.endLine}`)
      .join("\n");

    const description = [
      `Duplicate group: ${g.id}`,
      `Kind: ${g.kind}`,
      `Size: ${g.lineCount} lines, ${g.tokenCount} tokens`,
      "",
      "Occurrences:",
      sample || "- (none)",
      "",
      "Suggested actions:",
      "- Extract a shared helper/function and call it from each site.",
      "- Or extract a shared service/module if the block is cross-feature.",
      "- Confirm behavior is truly identical before refactoring.",
    ].join("\n");

    const impact: BriefImpact = g.lineCount >= 25 || g.occurrences.length >= 4 ? "high" : "medium";
    const effort: BriefEffort = g.lineCount >= 25 || files.length >= 4 ? "large" : "medium";

    tasks.push({
      id,
      title,
      description,
      affectedFiles: files,
      impact,
      effort,
      dependencies: dependenciesForFiles(files, cycleTaskIdsByFile),
      evidence: { duplicateGroupIds: [g.id] },
    });
  }

  tasks.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return tasks;
}

function buildTestGapTasks(findings: readonly AnalyzerFinding[], cycleTaskIdsByFile: Map<string, string[]>): BriefTask[] {
  const missing = findings.filter(isMissingSpecFinding);
  const tasks: BriefTask[] = [];

  for (const f of missing) {
    const fileUnderTest =
      f.code === "component-missing-spec" ? f.metadata.componentFilePath : f.metadata.serviceFilePath;
    const expected =
      f.code === "component-missing-spec" ? f.metadata.expectedSpecFilePath : f.metadata.expectedSpecFilePath;

    const affectedFiles = uniqueSorted([fileUnderTest, expected]);
    const id = stableId("task-spec", [expected]);
    const title = `Add missing spec (${expected})`;
    const description = [
      f.message,
      "",
      "Suggested actions:",
      "- Add a minimal spec that covers construction and a happy-path behavior.",
      "- Prefer small, focused tests; avoid integration tests unless needed.",
    ].join("\n");

    tasks.push({
      id,
      title,
      description,
      affectedFiles,
      impact: "medium",
      effort: "small",
      dependencies: dependenciesForFiles(affectedFiles, cycleTaskIdsByFile),
      evidence: { findingCodes: [f.code], findingRefs: [findingRef(f)] },
    });
  }

  tasks.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return tasks;
}

function buildHotspotTasks(hotspots: readonly HotspotScore[], cycleTaskIdsByFile: Map<string, string[]>): BriefTask[] {
  const candidates = hotspots.filter((h) => h.score >= 30).slice(0, 25);
  const tasks: BriefTask[] = [];

  for (const h of candidates) {
    const affectedFiles = [h.filePath];
    const id = stableId("task-hot", [h.filePath]);
    const title = `Reduce hotspot score (${h.filePath})`;

    const description = [
      `Score: ${h.score}`,
      `Factors: complexity ${h.factors.complexity}, duplication ${h.factors.duplication}, missingSpec ${h.factors.missingSpec}, fanIn ${h.factors.importFanIn}, fanOut ${h.factors.importFanOut}`,
      `Metrics: ${h.metrics.lineCount} lines, ${h.metrics.methodCount} methods, ${h.metrics.branchCount} branches, fan-in ${h.metrics.fanIn}, fan-out ${h.metrics.fanOut}`,
      "",
      "Suggested actions:",
      "- Reduce complexity by splitting functions/classes and simplifying branching.",
      "- Remove duplication by extracting helpers and consolidating repeated logic.",
      "- Add/restore specs for stability if missing.",
      "- Reduce coupling by introducing clear boundaries and avoiding cross-layer imports.",
    ].join("\n");

    const impact: BriefImpact = h.score >= 60 ? "high" : "medium";
    const effort: BriefEffort = h.score >= 60 ? "large" : "medium";

    tasks.push({
      id,
      title,
      description,
      affectedFiles,
      impact,
      effort,
      dependencies: dependenciesForFiles(affectedFiles, cycleTaskIdsByFile),
      evidence: { hotspotFiles: [h.filePath] },
    });
  }

  tasks.sort((a, b) => b.impact.localeCompare(a.impact) || a.title.localeCompare(b.title));
  return tasks;
}

function buildArea(
  id: BriefAreaId,
  title: string,
  priority: BriefPriority,
  summary: string,
  stats: Record<string, number>,
  trackId: string,
): BriefArea {
  return { id, title, priority, summary, stats, trackId };
}

function buildTrack(
  id: string,
  areaId: BriefAreaId,
  title: string,
  description: string,
  priority: BriefPriority,
  tasks: BriefTask[],
): BriefTrack {
  return { id, areaId, title, description, priority, tasks };
}

function priorityForLifecycle(findings: readonly AnalyzerFinding[]): BriefPriority {
  const counts = countBySeverity(findings.filter(isLifecycleFinding));
  if (counts.error > 0 || counts.warning > 0) return "P0";
  if (counts.info > 0) return "P1";
  return "P2";
}

function priorityForCycles(cycles: readonly ImportCycleFinding[]): BriefPriority {
  return cycles.length > 0 ? "P0" : "P2";
}

function priorityForOversized(tasks: readonly BriefTask[]): BriefPriority {
  if (tasks.length === 0) return "P2";
  if (tasks.length >= 10) return "P0";
  return "P1";
}

function priorityForDuplicates(groups: number): BriefPriority {
  if (groups === 0) return "P2";
  if (groups >= 15) return "P0";
  return "P1";
}

function priorityForTestGaps(gaps: number): BriefPriority {
  if (gaps === 0) return "P2";
  if (gaps >= 20) return "P1";
  return "P2";
}

function priorityForHotspots(hotspots: readonly HotspotScore[]): BriefPriority {
  const top = hotspots[0]?.score ?? 0;
  if (top >= 70) return "P0";
  if (top >= 40) return "P1";
  if (top >= 30) return "P2";
  return "P2";
}

export function generateEngineeringBrief(report: AuditReport): NgInspectorBrief {
  const bySev = countBySeverity(report.findings);
  const cycles = report.findings.filter(isImportCycleFinding);
  const lifecycleCount = report.findings.filter(isLifecycleFinding).length;
  const missingSpecs = report.findings.filter(isMissingSpecFinding).length;
  const largeFindings = report.findings.filter((f) => isLargeComponentFinding(f) || isLargeServiceFinding(f)).length;

  const health = computeHealth(report);
  const summary: BriefSummary = {
    findings: { total: report.findings.length, bySeverity: bySev },
    importCycles: cycles.length,
    duplicateGroups: report.duplicateGroups.length,
    hotspots: report.hotspotScores.length,
  };

  const cycleTasks = buildImportCycleTasks(cycles);
  const cycleTaskIdsByFile = cycleTasks.taskIdsByFile;

  const tracksByArea = new Map<BriefAreaId, BriefTrack>();

  const lifecycleTasks = buildLifecycleTasks(report.findings, cycleTaskIdsByFile);
  tracksByArea.set(
    "lifecycle",
    buildTrack(
      "track-lifecycle",
      "lifecycle",
      "Lifecycle and Cleanup Risks",
      "Address long-lived subscriptions, timers, event listeners, and effect() side effects that can outlive component/service lifecycles.",
      priorityForLifecycle(report.findings),
      lifecycleTasks,
    ),
  );

  const duplicateTasks = buildDuplicateTasks(report.duplicateGroups, cycleTaskIdsByFile);
  tracksByArea.set(
    "duplicates",
    buildTrack(
      "track-duplicates",
      "duplicates",
      "Duplicate Code",
      "Conservatively deduplicate identical blocks to reduce future change cost and bug surface area.",
      priorityForDuplicates(report.duplicateGroups.length),
      duplicateTasks,
    ),
  );

  const oversizedTasks = buildOversizedTasks(report.findings, cycleTaskIdsByFile);
  tracksByArea.set(
    "oversized",
    buildTrack(
      "track-oversized",
      "oversized",
      "Oversized Components and Services",
      "Split large files into smaller units and move business logic behind stable boundaries to improve maintainability.",
      priorityForOversized(oversizedTasks),
      oversizedTasks,
    ),
  );

  tracksByArea.set(
    "import-cycles",
    buildTrack(
      "track-import-cycles",
      "import-cycles",
      "Import Cycles",
      "Break circular dependencies to improve build stability and reduce coupling across the workspace.",
      priorityForCycles(cycles),
      cycleTasks.tasks,
    ),
  );

  const testGapTasks = buildTestGapTasks(report.findings, cycleTaskIdsByFile);
  tracksByArea.set(
    "test-gaps",
    buildTrack(
      "track-test-gaps",
      "test-gaps",
      "Test Gaps",
      "Add missing specs for key components/services to improve confidence while refactoring.",
      priorityForTestGaps(missingSpecs),
      testGapTasks,
    ),
  );

  const hotspotTasks = buildHotspotTasks(report.hotspotScores, cycleTaskIdsByFile);
  tracksByArea.set(
    "hotspots",
    buildTrack(
      "track-hotspots",
      "hotspots",
      "Performance and Complexity Hotspots",
      "Focus refactors on the highest-scoring files first (complexity + duplication + coupling + missing specs).",
      priorityForHotspots(report.hotspotScores),
      hotspotTasks,
    ),
  );

  const areas: BriefArea[] = [];
  for (const areaId of AREA_ORDER) {
    const track = tracksByArea.get(areaId);
    if (!track) continue;

    if (areaId === "lifecycle") {
      const counts = countBySeverity(report.findings.filter(isLifecycleFinding));
      const summaryText = `${counts.warning} warning(s), ${counts.info} info.`;
      areas.push(
        buildArea(
          areaId,
          "Lifecycle and Cleanup Risks",
          track.priority,
          summaryText,
          { findings: lifecycleCount, warning: counts.warning, info: counts.info },
          track.id,
        ),
      );
      continue;
    }

    if (areaId === "duplicates") {
      const occ = report.duplicateGroups.reduce((n, g) => n + g.occurrences.length, 0);
      const summaryText =
        report.duplicateGroups.length > 0 ? `${report.duplicateGroups.length} group(s), ${occ} occurrence(s).` : "No duplicate groups detected.";
      areas.push(
        buildArea(
          areaId,
          "Duplicate Code",
          track.priority,
          summaryText,
          { groups: report.duplicateGroups.length, occurrences: occ },
          track.id,
        ),
      );
      continue;
    }

    if (areaId === "oversized") {
      const summaryText = largeFindings > 0 ? `${largeFindings} size-related finding(s).` : "No size findings.";
      areas.push(buildArea(areaId, "Oversized Components/Services", track.priority, summaryText, { findings: largeFindings }, track.id));
      continue;
    }

    if (areaId === "import-cycles") {
      const filesInCycles = uniqueSorted(cycles.flatMap((c) => c.metadata.nodes ?? [])).length;
      const summaryText = cycles.length > 0 ? `${cycles.length} cycle(s) across ${filesInCycles} file(s).` : "No cycles detected.";
      areas.push(
        buildArea(areaId, "Import Cycles", track.priority, summaryText, { cycles: cycles.length, files: filesInCycles }, track.id),
      );
      continue;
    }

    if (areaId === "test-gaps") {
      const summaryText = missingSpecs > 0 ? `${missingSpecs} missing spec(s).` : "No missing spec findings.";
      areas.push(buildArea(areaId, "Test Gaps", track.priority, summaryText, { missingSpecs }, track.id));
      continue;
    }

    if (areaId === "hotspots") {
      const top = report.hotspotScores[0]?.score ?? 0;
      const summaryText = report.hotspotScores.length > 0 ? `Top hotspot score: ${top}.` : "No hotspot scores.";
      areas.push(buildArea(areaId, "Performance Hotspots", track.priority, summaryText, { files: report.hotspotScores.length, topScore: top }, track.id));
    }
  }

  areas.sort((a, b) => {
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return AREA_ORDER.indexOf(a.id) - AREA_ORDER.indexOf(b.id);
  });

  const tracks = areas.map((a) => tracksByArea.get(a.id)).filter((t): t is BriefTrack => Boolean(t));

  // Within a track, prioritize high-impact + low-effort first (deterministic).
  for (const t of tracks) {
    t.tasks.sort(compareTaskPriority);
  }

  return {
    schemaVersion: BRIEF_SCHEMA_VERSION,
    generatedAt: report.generatedAt,
    workspaceRoot: report.workspaceRoot,
    sourceReport: { schemaVersion: report.schemaVersion, generatedAt: report.generatedAt },
    health,
    summary,
    priorityAreas: areas,
    tracks,
  };
}

function markdownSafe(text: string): string {
  // Lightweight escaping for headings/list content (not a full markdown sanitizer).
  return text.replace(/\r?\n/g, " ").trim();
}

function impactRank(impact: BriefImpact): number {
  if (impact === "high") return 3;
  if (impact === "medium") return 2;
  return 1;
}

function effortRank(effort: BriefEffort): number {
  if (effort === "small") return 1;
  if (effort === "medium") return 2;
  return 3;
}

function compareTaskPriority(a: BriefTask, b: BriefTask): number {
  const byImpact = impactRank(b.impact) - impactRank(a.impact);
  if (byImpact !== 0) return byImpact;

  const byEffort = effortRank(a.effort) - effortRank(b.effort);
  if (byEffort !== 0) return byEffort;

  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.id.localeCompare(b.id);
}

function formatFilesInline(files: readonly string[], max = 3): string {
  if (files.length === 0) return "--";
  const head = files.slice(0, max).map((f) => `\`${f}\``).join(", ");
  const rest = files.length > max ? `, +${files.length - max} more` : "";
  return head + rest;
}

export function renderEngineeringBriefMarkdown(brief: NgInspectorBrief): string {
  const lines: string[] = [];

  lines.push("# ng-inspector engineering brief");
  lines.push("");
  lines.push(`Workspace: \`${brief.workspaceRoot}\``);
  lines.push(`Generated: \`${brief.generatedAt}\``);
  lines.push(`Health: **${brief.health.score}/100 (${brief.health.grade})**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Findings: ${brief.summary.findings.total} (E ${brief.summary.findings.bySeverity.error} / W ${brief.summary.findings.bySeverity.warning} / I ${brief.summary.findings.bySeverity.info})`);
  lines.push(`- Import cycles: ${brief.summary.importCycles}`);
  lines.push(`- Duplicate groups: ${brief.summary.duplicateGroups}`);
  lines.push(`- Hotspot files: ${brief.summary.hotspots}`);
  lines.push("");
  lines.push("## Priority Areas");
  lines.push("");

  for (const a of brief.priorityAreas) {
    lines.push(`- **[${a.priority}] ${markdownSafe(a.title)}**: ${markdownSafe(a.summary)}`);
  }

  lines.push("");
  lines.push("## Refactor Tracks");
  lines.push("");

  for (const t of brief.tracks) {
    const taskCount = t.tasks.length;
    lines.push(`### [${t.priority}] ${markdownSafe(t.title)} (${taskCount} task${taskCount === 1 ? "" : "s"})`);
    lines.push("");
    lines.push(markdownSafe(t.description));
    lines.push("");

    if (taskCount === 0) {
      lines.push("_No tasks generated for this track._");
      lines.push("");
      continue;
    }

    const maxTasks = 10;
    const shown = t.tasks.slice(0, maxTasks);
    for (const task of shown) {
      lines.push(`- \`${task.id}\` ${markdownSafe(task.title)} (impact: ${task.impact}, effort: ${task.effort})`);
      lines.push(`  - files: ${formatFilesInline(task.affectedFiles)}`);
      if (task.dependencies.length > 0) lines.push(`  - deps: ${task.dependencies.map((d) => `\`${d}\``).join(", ")}`);
    }

    if (taskCount > shown.length) {
      lines.push(`- _...and ${taskCount - shown.length} more._`);
    }

    lines.push("");
  }

  return lines.join("\n") + "\n";
}
