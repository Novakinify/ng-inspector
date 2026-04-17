import type {
  AnalyzerCategory,
  AnalyzerFinding,
  AuditReport,
  AuditSummary,
  ClassSymbol,
  DuplicateGroup,
  HotspotScore,
  ImportGraphSummary,
  MethodReference,
  MethodSymbol,
  ProjectReport,
  ProjectTree,
  SymbolIndex,
  SymbolVisibility
} from "./report-schema";

export type ParseAuditReportResult =
  | { ok: true; report: AuditReport }
  | { ok: false; error: string };

export function parseAuditReportJson(jsonText: string): ParseAuditReportResult {
  let value: unknown;
  try {
    value = JSON.parse(jsonText) as unknown;
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }

  const obj = asRecord(value);
  if (!obj) return { ok: false, error: "Expected a JSON object at the top level." };

  // Basic shape validation to avoid silently treating arbitrary JSON as an empty report.
  const schemaVersion = asNumber(obj["schemaVersion"]);
  const generatedAt = asString(obj["generatedAt"]);
  const workspaceRoot = asString(obj["workspaceRoot"]);
  const angularJsonPath = asString(obj["angularJsonPath"]);
  const projects = asArray(obj["projects"]);
  const findings = asArray(obj["findings"]);

  if (
    schemaVersion === null ||
    !generatedAt ||
    !workspaceRoot ||
    !angularJsonPath ||
    !projects ||
    !findings
  ) {
    return {
      ok: false,
      error:
        "This file does not look like an ng-inspector report.json (missing schemaVersion/generatedAt/workspaceRoot/angularJsonPath/projects/findings)."
    };
  }

  return { ok: true, report: normalizeAuditReport(obj) };
}

export function normalizeAuditReport(obj: Record<string, unknown>): AuditReport {
  const projects = normalizeProjects(asArray(obj["projects"]) ?? []);
  const findings = normalizeFindings(asArray(obj["findings"]) ?? []);

  return {
    schemaVersion: asNumber(obj["schemaVersion"]) ?? 0,
    generatedAt: asString(obj["generatedAt"]) ?? "",
    workspaceRoot: asString(obj["workspaceRoot"]) ?? "",
    angularJsonPath: asString(obj["angularJsonPath"]) ?? "",
    projects,
    findings,
    importGraph: normalizeImportGraph(asRecord(obj["importGraph"]) ?? {}),
    summary: normalizeSummary(asRecord(obj["summary"]) ?? {}, projects),
    projectTree: normalizeProjectTree(asRecord(obj["projectTree"]) ?? {}, projects),
    symbols: normalizeSymbols(asRecord(obj["symbols"]) ?? {}),
    methodReferences: normalizeMethodReferences(asArray(obj["methodReferences"]) ?? []),
    duplicateGroups: normalizeDuplicateGroups(asArray(obj["duplicateGroups"]) ?? []),
    hotspotScores: normalizeHotspotScores(asArray(obj["hotspotScores"]) ?? []),
    analyzerCategories: normalizeAnalyzerCategories(asArray(obj["analyzerCategories"]) ?? [])
  };
}

function normalizeImportGraph(obj: Record<string, unknown>): ImportGraphSummary {
  return {
    nodes: asNumber(obj["nodes"]) ?? 0,
    edges: asNumber(obj["edges"]) ?? 0,
    cycles: asNumber(obj["cycles"]) ?? 0
  };
}

function normalizeSummary(obj: Record<string, unknown>, projects: ProjectReport[]): AuditSummary {
  const fallback: AuditSummary = {
    projects: projects.length,
    components: projects.reduce((sum, p) => sum + p.components.length, 0),
    services: projects.reduce((sum, p) => sum + p.services.length, 0),
    routes: projects.reduce((sum, p) => sum + p.routes.length, 0)
  };

  return {
    projects: asNumber(obj["projects"]) ?? fallback.projects,
    components: asNumber(obj["components"]) ?? fallback.components,
    services: asNumber(obj["services"]) ?? fallback.services,
    routes: asNumber(obj["routes"]) ?? fallback.routes
  };
}

function normalizeProjects(items: unknown[]): ProjectReport[] {
  return items
    .map((it): ProjectReport | null => {
      const obj = asRecord(it);
      if (!obj) return null;

      return {
        name: asString(obj["name"]) ?? "unknown",
        root: asNullableString(obj["root"]),
        sourceRoot: asNullableString(obj["sourceRoot"]),
        components: normalizeDiscoveredFiles(obj["components"]),
        directives: normalizeDiscoveredFiles(obj["directives"]),
        pipes: normalizeDiscoveredFiles(obj["pipes"]),
        services: normalizeDiscoveredFiles(obj["services"]),
        routes: normalizeRoutes(obj["routes"])
      };
    })
    .filter(isNotNull);
}

function normalizeDiscoveredFiles(value: unknown): { filePath: string }[] {
  const arr = asArray(value);
  if (!arr) return [];
  return arr
    .map((it): { filePath: string } | null => {
      const obj = asRecord(it);
      const filePath = obj ? asString(obj["filePath"]) : null;
      return filePath ? { filePath } : null;
    })
    .filter(isNotNull);
}

function normalizeRoutes(value: unknown): { filePath: string; path: string }[] {
  const arr = asArray(value);
  if (!arr) return [];
  return arr
    .map((it): { filePath: string; path: string } | null => {
      const obj = asRecord(it);
      if (!obj) return null;
      const filePath = asString(obj["filePath"]);
      const path = asString(obj["path"]);
      if (!filePath || path === null) return null;
      return { filePath, path: path ?? "" };
    })
    .filter(isNotNull);
}

function normalizeFindings(items: unknown[]): AnalyzerFinding[] {
  return items
    .map((it): AnalyzerFinding | null => {
      const obj = asRecord(it);
      if (!obj) return null;

      const severity = normalizeSeverity(asString(obj["severity"]));
      const category = asString(obj["category"]) ?? "imports";
      const confidence = normalizeConfidence(asString(obj["confidence"]));
      const code = asString(obj["code"]) ?? "unknown";
      const message = asString(obj["message"]) ?? "";
      const whyItMatters = asString(obj["whyItMatters"]) ?? "";
      const suggestedActions = normalizeStringArray(obj["suggestedActions"]);
      const filePath = asString(obj["filePath"]) ?? "";
      const metadata = asRecord(obj["metadata"]) ?? {};

      return {
        severity,
        category,
        confidence,
        code,
        message,
        whyItMatters,
        suggestedActions,
        filePath,
        metadata
      };
    })
    .filter(isNotNull);
}

function normalizeSeverity(value: string | null): AnalyzerFinding["severity"] {
  if (value === "error" || value === "warning" || value === "info") return value;
  return "info";
}

function normalizeConfidence(value: string | null): AnalyzerFinding["confidence"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function normalizeProjectTree(obj: Record<string, unknown>, projects: ProjectReport[]): ProjectTree {
  // Prefer the report-provided projectTree. If it's missing (older schema), synthesize a minimal one.
  const fromReport = asArray(obj["projects"]);
  if (fromReport) {
    return {
      projects: fromReport
        .map((p): ProjectTree["projects"][number] | null => {
          const pobj = asRecord(p);
          if (!pobj) return null;
          const sourceRoots = asArray(pobj["sourceRoots"]) ?? [];
          return {
            name: asString(pobj["name"]) ?? "unknown",
            root: asNullableString(pobj["root"]),
            sourceRoot: asNullableString(pobj["sourceRoot"]),
            sourceRoots: sourceRoots
              .map((sr): ProjectTree["projects"][number]["sourceRoots"][number] | null => {
                const srobj = asRecord(sr);
                if (!srobj) return null;
                const sourceRoot = asString(srobj["sourceRoot"]);
                const rootFolder = asRecord(srobj["rootFolder"]);
                if (!sourceRoot || !rootFolder) return null;
                return {
                  sourceRoot,
                  rootFolder: normalizeProjectTreeFolder(rootFolder)
                };
              })
              .filter(isNotNull)
          };
        })
        .filter(isNotNull)
    };
  }

  return {
    projects: projects.map((p) => ({
      name: p.name,
      root: p.root,
      sourceRoot: p.sourceRoot,
      sourceRoots: []
    }))
  };
}

function normalizeProjectTreeFolder(obj: Record<string, unknown>): ProjectTree["projects"][number]["sourceRoots"][number]["rootFolder"] {
  const folders = asArray(obj["folders"]) ?? [];
  const files = asArray(obj["files"]) ?? [];
  return {
    path: asString(obj["path"]) ?? "",
    folders: folders
      .map((f): ProjectTree["projects"][number]["sourceRoots"][number]["rootFolder"] | null => {
        const fobj = asRecord(f);
        if (!fobj) return null;
        return normalizeProjectTreeFolder(fobj);
      })
      .filter(isNotNull),
    files: files
      .map((it): ProjectTree["projects"][number]["sourceRoots"][number]["rootFolder"]["files"][number] | null => {
        const fobj = asRecord(it);
        if (!fobj) return null;
        const filePath = asString(fobj["filePath"]);
        if (!filePath) return null;
        const classes = asArray(fobj["classes"]) ?? [];
        return {
          filePath,
          classes: classes
            .map((c): ProjectTree["projects"][number]["sourceRoots"][number]["rootFolder"]["files"][number]["classes"][number] | null => {
              const cobj = asRecord(c);
              if (!cobj) return null;
              const classId = asString(cobj["classId"]);
              if (!classId) return null;
              const methodIds = normalizeStringArray(cobj["methodIds"]);
              return { classId, methodIds };
            })
            .filter(isNotNull),
        };
      })
      .filter(isNotNull),
    components: normalizeDiscoveredFiles(obj["components"]),
    directives: normalizeDiscoveredFiles(obj["directives"]),
    pipes: normalizeDiscoveredFiles(obj["pipes"]),
    services: normalizeDiscoveredFiles(obj["services"]),
    routes: normalizeRoutes(obj["routes"])
  };
}

function normalizeSymbols(obj: Record<string, unknown>): SymbolIndex {
  const files = asArray(obj["files"]) ?? [];
  const classes = asArray(obj["classes"]) ?? [];
  const methods = asArray(obj["methods"]) ?? [];

  return {
    files: files
      .map((it): SymbolIndex["files"][number] | null => {
        const o = asRecord(it);
        if (!o) return null;
        const id = asString(o["id"]);
        const filePath = asString(o["filePath"]);
        if (!id || !filePath) return null;
        return { id, filePath };
      })
      .filter(isNotNull),
    classes: classes
      .map((it): ClassSymbol | null => {
        const o = asRecord(it);
        if (!o) return null;
        const id = asString(o["id"]);
        const name = asString(o["name"]);
        const filePath = asString(o["filePath"]);
        const startLine = asNumber(o["startLine"]);
        const endLine = asNumber(o["endLine"]);
        if (!id || !name || !filePath || startLine === null || endLine === null) return null;
        return { id, name, filePath, startLine, endLine };
      })
      .filter(isNotNull),
    methods: methods
      .map((it): MethodSymbol | null => {
        const o = asRecord(it);
        if (!o) return null;
        const id = asString(o["id"]);
        const name = asString(o["name"]);
        const filePath = asString(o["filePath"]);
        const classId = asString(o["classId"]);
        const className = asString(o["className"]);
        const visibility = normalizeVisibility(asString(o["visibility"]));
        const startLine = asNumber(o["startLine"]);
        const endLine = asNumber(o["endLine"]);
        const metrics = asRecord(o["metrics"]) ?? {};
        if (!id || !name || !filePath || !classId || !className || startLine === null || endLine === null) return null;
        return {
          id,
          name,
          filePath,
          classId,
          className,
          visibility,
          startLine,
          endLine,
          metrics: {
            lineCount: asNumber(metrics["lineCount"]) ?? 0,
            branchCount: asNumber(metrics["branchCount"]) ?? 0,
            parameterCount: asNumber(metrics["parameterCount"]) ?? 0
          }
        };
      })
      .filter(isNotNull)
  };
}

function normalizeVisibility(value: string | null): SymbolVisibility {
  if (value === "public" || value === "protected" || value === "private") return value;
  return "public";
}

function normalizeMethodReferences(items: unknown[]): MethodReference[] {
  return items
    .map((it): MethodReference | null => {
      const o = asRecord(it);
      if (!o) return null;
      const methodId = asString(o["methodId"]);
      const filePath = asString(o["filePath"]);
      const line = asNumber(o["line"]);
      const column = asNumber(o["column"]);
      const snippet = asString(o["snippet"]);
      if (!methodId || !filePath || line === null || column === null || snippet === null) return null;
      return { methodId, filePath, line, column, snippet };
    })
    .filter(isNotNull);
}

function normalizeDuplicateGroups(items: unknown[]): DuplicateGroup[] {
  return items
    .map((it): DuplicateGroup | null => {
      const obj = asRecord(it);
      if (!obj) return null;
      const kind = asString(obj["kind"]);
      if (kind !== "exact" && kind !== "normalized") return null;
      const occurrences = asArray(obj["occurrences"]) ?? [];
      const hash = asString(obj["hash"]) ?? "";
      const id = asString(obj["id"]) ?? `dup:${kind}:${hash}`;
      return {
        id,
        kind,
        hash,
        tokenCount: asNumber(obj["tokenCount"]) ?? 0,
        lineCount: asNumber(obj["lineCount"]) ?? 0,
        preview: asString(obj["preview"]) ?? undefined,
        occurrences: occurrences
          .map((occ): DuplicateGroup["occurrences"][number] | null => {
            const o = asRecord(occ);
            if (!o) return null;
            const filePath = asString(o["filePath"]);
            const startLine = asNumber(o["startLine"]);
            const endLine = asNumber(o["endLine"]);
            if (!filePath || startLine === null || endLine === null) return null;
            return {
              filePath,
              startLine,
              endLine,
              lineCount: asNumber(o["lineCount"]) ?? 0,
              tokenCount: asNumber(o["tokenCount"]) ?? 0,
              methodId: asString(o["methodId"]) ?? undefined
            };
          })
          .filter(isNotNull)
      };
    })
    .filter(isNotNull);
}

function normalizeHotspotScores(items: unknown[]): HotspotScore[] {
  return items
    .map((it): HotspotScore | null => {
      const obj = asRecord(it);
      if (!obj) return null;
      const filePath = asString(obj["filePath"]);
      if (!filePath) return null;

      const factors = asRecord(obj["factors"]) ?? {};
      const metrics = asRecord(obj["metrics"]) ?? {};

      return {
        filePath,
        score: asNumber(obj["score"]) ?? 0,
        factors: {
          complexity: asNumber(factors["complexity"]) ?? 0,
          duplication: asNumber(factors["duplication"]) ?? 0,
          missingSpec: asNumber(factors["missingSpec"]) ?? 0,
          importFanIn: asNumber(factors["importFanIn"]) ?? 0,
          importFanOut: asNumber(factors["importFanOut"]) ?? 0
        },
        metrics: {
          lineCount: asNumber(metrics["lineCount"]) ?? 0,
          methodCount: asNumber(metrics["methodCount"]) ?? 0,
          constructorParamCountMax: asNumber(metrics["constructorParamCountMax"]) ?? 0,
          branchCount: asNumber(metrics["branchCount"]) ?? 0,
          duplicateGroupCount: asNumber(metrics["duplicateGroupCount"]) ?? 0,
          duplicateOccurrenceCount: asNumber(metrics["duplicateOccurrenceCount"]) ?? 0,
          duplicatedLineCount: asNumber(metrics["duplicatedLineCount"]) ?? 0,
          missingSpec: asBoolean(metrics["missingSpec"]) ?? false,
          fanIn: asNumber(metrics["fanIn"]) ?? 0,
          fanOut: asNumber(metrics["fanOut"]) ?? 0
        }
      };
    })
    .filter(isNotNull);
}

function normalizeAnalyzerCategories(items: unknown[]): AnalyzerCategory[] {
  return items
    .map((it): AnalyzerCategory | null => {
      const obj = asRecord(it);
      if (!obj) return null;
      const id = asString(obj["id"]);
      if (!id) return null;
      return {
        id,
        title: asString(obj["title"]) ?? id,
        description: asString(obj["description"]) ?? "",
        findingCodes: normalizeStringArray(obj["findingCodes"]),
        reportKeys: normalizeStringArray(obj["reportKeys"])
      };
    })
    .filter(isNotNull);
}

function normalizeStringArray(value: unknown): string[] {
  const arr = asArray(value);
  if (!arr) return [];
  return arr.map((x) => asString(x)).filter(isNonEmptyString);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null) return null;
  return asString(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isNonEmptyString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}
