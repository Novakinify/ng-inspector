export type SchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type FindingSeverity = "error" | "warning" | "info";

export type FindingConfidence = "high" | "medium" | "low";

export type FindingCategory = "components" | "services" | "routes" | "imports" | "lifecycle";

export type RuleSeverityOverride = "off" | FindingSeverity;

export interface NgInspectorConfig {
  exclude: {
    /**
     * Workspace-relative (posix) path patterns to exclude from scanning.
     * Supports simple glob-style patterns:
     * - `*` matches within a single path segment
     * - `**` matches across path segments
     *
     * If a pattern has no glob tokens, it is treated as a path prefix.
     */
    paths: string[];
  };
  thresholds: {
    componentTsLines: number;
    componentTemplateLines: number;
    serviceTsLines: number;
    serviceMixedMinLines: number;
    serviceMixedMinSignals: number;
  };
  /**
   * Rule overrides by finding code (e.g. "component-large-ts").
   * Values are limited to: off, info, warning, error.
   */
  rules: Record<string, RuleSeverityOverride>;
  report: {
    /**
     * Output directory (relative to workspace root).
     */
    outputDir: string;
  };
}

export interface AuditWorkspaceOptions {
  /**
   * Absolute or relative path to the Angular workspace root.
   * Must contain an `angular.json` file.
   */
  workspaceRoot: string;
  /**
   * Optional effective config. If not provided, config will be loaded from
   * `<workspaceRoot>/ng-inspector.config.json` (if present) and merged over defaults.
   */
  config?: NgInspectorConfig;
}

export interface AuditReport {
  schemaVersion: SchemaVersion;
  generatedAt: string; // ISO timestamp
  workspaceRoot: string;
  angularJsonPath: string;
  projects: ProjectReport[];
  findings: AnalyzerFinding[];
  importGraph: ImportGraphSummary;
  summary: AuditSummary;

  /**
   * Normalized folder tree representation of discovered Angular artifacts.
   * Intended to be stable and easy for UIs to consume.
   */
  projectTree: ProjectTree;

  /**
   * Symbol index for drilldown UIs (classes/methods).
   */
  symbols: SymbolIndex;

  /**
   * Conservative references/usages for indexed methods.
   */
  methodReferences: MethodReference[];

  /**
   * Conservative duplication groups derived from TypeScript AST blocks.
   */
  duplicateGroups: DuplicateGroup[];

  /**
   * Simple per-file hotspot scoring derived from multiple signals.
   */
  hotspotScores: HotspotScore[];

  /**
   * A small index describing which analyzers/categories contributed to this report.
   */
  analyzerCategories: AnalyzerCategory[];
}

export interface AuditSummary {
  projects: number;
  components: number;
  services: number;
  routes: number;
}

export interface ImportGraphSummary {
  nodes: number;
  edges: number;
  cycles: number;
}

export interface ProjectReport {
  name: string;
  root: string | null;
  sourceRoot: string | null;
  components: DiscoveredFile[];
  directives: DiscoveredFile[];
  pipes: DiscoveredFile[];
  services: DiscoveredFile[];
  routes: DiscoveredRoute[];
}

export interface ProjectTree {
  projects: ProjectTreeProject[];
}

export interface ProjectTreeProject {
  name: string;
  root: string | null;
  sourceRoot: string | null;
  sourceRoots: ProjectTreeSourceRoot[];
}

export interface ProjectTreeSourceRoot {
  /**
   * Workspace-relative (posix) directory path, e.g. "src".
   */
  sourceRoot: string;
  rootFolder: ProjectTreeFolder;
}

export interface ProjectTreeFolder {
  /**
   * Workspace-relative (posix) directory path.
   */
  path: string;
  folders: ProjectTreeFolder[];
  files: ProjectTreeFile[];
  components: DiscoveredFile[];
  directives: DiscoveredFile[];
  pipes: DiscoveredFile[];
  services: DiscoveredFile[];
  routes: DiscoveredRoute[];
}

export interface ProjectTreeFile {
  /**
   * Workspace-relative (posix) file path.
   */
  filePath: string;
  classes: ProjectTreeFileClass[];
}

export interface ProjectTreeFileClass {
  classId: string;
  methodIds: string[];
}

export interface TsFileComplexityMetrics {
  filePath: string; // workspace-relative posix path
  lineCount: number;
  classCount: number;
  methodCount: number;
  constructorParamCountMax: number;
  branchCount: number;
}

export type SymbolVisibility = "public" | "protected" | "private";

export interface SymbolIndex {
  files: SymbolFileSymbol[];
  classes: ClassSymbol[];
  methods: MethodSymbol[];
}

export interface SymbolFileSymbol {
  id: string;
  filePath: string; // workspace-relative posix path
}

export interface ClassSymbol {
  id: string;
  name: string;
  filePath: string; // workspace-relative posix path
  startLine: number; // 1-based
  endLine: number; // 1-based inclusive
}

export interface MethodMetrics {
  lineCount: number;
  branchCount: number;
  parameterCount: number;
}

export interface MethodSymbol {
  id: string;
  name: string;
  filePath: string; // workspace-relative posix path
  classId: string;
  className: string;
  visibility: SymbolVisibility;
  startLine: number; // 1-based
  endLine: number; // 1-based inclusive
  metrics: MethodMetrics;
}

export interface MethodReference {
  methodId: string;
  filePath: string; // workspace-relative posix path
  line: number; // 1-based
  column: number; // 1-based
  snippet: string;
}

export interface DuplicateOccurrence {
  filePath: string; // workspace-relative posix path
  startLine: number; // 1-based
  endLine: number; // 1-based inclusive
  lineCount: number;
  tokenCount: number;
  methodId?: string;
}

export interface DuplicateGroup {
  id: string;
  kind: "exact" | "normalized";
  hash: string;
  tokenCount: number;
  lineCount: number;
  preview?: string;
  occurrences: DuplicateOccurrence[];
}

export interface HotspotScore {
  filePath: string; // workspace-relative posix path
  score: number;
  factors: {
    complexity: number;
    duplication: number;
    missingSpec: number;
    importFanIn: number;
    importFanOut: number;
  };
  metrics: {
    lineCount: number;
    methodCount: number;
    constructorParamCountMax: number;
    branchCount: number;
    duplicateGroupCount: number;
    duplicateOccurrenceCount: number;
    duplicatedLineCount: number;
    missingSpec: boolean;
    fanIn: number;
    fanOut: number;
  };
}

export interface AnalyzerCategory {
  id: string;
  title: string;
  description: string;
  /**
   * Finding codes contributed by this category (from `report.findings`).
   */
  findingCodes: string[];
  /**
   * Extra report keys produced by this category (beyond `findings`).
   */
  reportKeys: string[];
}

export interface DiscoveredFile {
  /**
   * File path relative to the workspace root, using forward slashes.
   */
  filePath: string;
}

export interface DiscoveredRoute {
  filePath: string;
  path: string;
}

interface BaseFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: FindingConfidence;
  code: string;
  message: string;
  whyItMatters: string;
  suggestedActions: string[];
  /**
   * File path relative to the workspace root, using forward slashes.
   */
  filePath: string;
  metadata: Record<string, unknown>;
}

export interface LargeComponentTsFinding extends BaseFinding {
  code: "component-large-ts";
  metadata: {
    projectName: string;
    componentFilePath: string;
    tsLineCount: number;
    maxTsLines: number;
  };
}

export interface LargeComponentTemplateFinding extends BaseFinding {
  code: "component-large-template";
  metadata: {
    projectName: string;
    componentFilePath: string;
    templateKind: "external" | "inline";
    templateFilePath?: string;
    templateLineCount: number;
    maxTemplateLines: number;
  };
}

export interface InlineTemplateFinding extends BaseFinding {
  code: "component-inline-template";
  metadata: {
    projectName: string;
    componentFilePath: string;
    templateKind: "inline";
    templateLineCount?: number;
  };
}

export interface InlineStylesFinding extends BaseFinding {
  code: "component-inline-styles";
  metadata: {
    projectName: string;
    componentFilePath: string;
  };
}

export interface MissingComponentSpecFinding extends BaseFinding {
  code: "component-missing-spec";
  metadata: {
    projectName: string;
    componentFilePath: string;
    expectedSpecFilePath: string;
  };
}

export interface LargeServiceTsFinding extends BaseFinding {
  code: "service-large-ts";
  metadata: {
    projectName: string;
    serviceFilePath: string;
    tsLineCount: number;
    maxTsLines: number;
  };
}

export interface MixedResponsibilityServiceFinding extends BaseFinding {
  code: "service-mixed-responsibility";
  metadata: {
    projectName: string;
    serviceFilePath: string;
    tsLineCount: number;
    signals: string[];
    minSignals: number;
    minLines: number;
  };
}

export interface MissingServiceSpecFinding extends BaseFinding {
  code: "service-missing-spec";
  metadata: {
    projectName: string;
    serviceFilePath: string;
    expectedSpecFilePath: string;
  };
}

export interface ImportCycleFinding extends BaseFinding {
  code: "import-cycle";
  metadata: {
    nodes: string[];
    nodeCount: number;
  };
}

export interface ComponentHttpCallsFinding extends BaseFinding {
  code: "component-http-calls";
  metadata: {
    projectName: string;
    componentFilePath: string;
    httpPropertyName: string;
    methods: string[];
  };
}

export interface ComponentManyInjectionsFinding extends BaseFinding {
  code: "component-many-injections";
  metadata: {
    projectName: string;
    componentFilePath: string;
    constructorParamCount: number;
    maxConstructorParams: number;
  };
}

export interface ComponentStandaloneDuplicateImportsFinding extends BaseFinding {
  code: "component-standalone-duplicate-imports";
  metadata: {
    projectName: string;
    componentFilePath: string;
    duplicates: string[];
  };
}

export interface LargeRoutesConfigFinding extends BaseFinding {
  code: "routes-large-config";
  metadata: {
    projectName: string;
    routesFilePath: string;
    tsLineCount: number;
    maxTsLines: number;
    routeObjectCount: number;
  };
}

export interface UnmanagedSubscribeFinding extends BaseFinding {
  code: "lifecycle-unmanaged-subscribe";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
    rootKind: "fromEvent" | "interval" | "observable";
    rootText: string;
    reason: string;
  };
}

export interface FromEventSubscribeNoCleanupFinding extends BaseFinding {
  code: "lifecycle-fromEvent-subscribe-no-cleanup";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
    eventName?: string;
    targetText?: string;
  };
}

export interface BrokenDestroySubjectFinding extends BaseFinding {
  code: "lifecycle-broken-destroy-subject";
  metadata: {
    className?: string;
    subjectProperty: string; // destroy$ / destroyed$
    line: number;
    column: number;
    usesTakeUntil: boolean;
    hasNgOnDestroy: boolean;
    callsNext: boolean;
    callsComplete: boolean;
  };
}

export interface SubscriptionFieldNotUnsubscribedFinding extends BaseFinding {
  code: "lifecycle-subscription-field-not-unsubscribed";
  metadata: {
    className?: string;
    fieldName: string;
    assignedInMethod?: string;
    line: number;
    column: number;
  };
}

export interface FromEventListenerNoRemoveFinding extends BaseFinding {
  code: "lifecycle-addEventListener-no-remove";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
    targetText: string;
    eventName: string;
    handlerText: string;
    hasOnceOption: boolean;
  };
}

export interface SetIntervalNoClearFinding extends BaseFinding {
  code: "lifecycle-setInterval-no-clearInterval";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
    intervalIdProperty: string;
  };
}

export interface RequestAnimationFrameNoCancelFinding extends BaseFinding {
  code: "lifecycle-requestAnimationFrame-no-cancelAnimationFrame";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
    requestIdProperty: string;
  };
}

export interface EffectMissingCleanupFinding extends BaseFinding {
  code: "lifecycle-effect-missing-onCleanup";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
    resources: string[];
    hasOnCleanupParam: boolean;
  };
}

export interface ToSignalManualCleanupFinding extends BaseFinding {
  code: "lifecycle-toSignal-manualCleanup";
  metadata: {
    className?: string;
    methodName?: string;
    line: number;
    column: number;
  };
}

export type AnalyzerFinding =
  | LargeComponentTsFinding
  | LargeComponentTemplateFinding
  | InlineTemplateFinding
  | InlineStylesFinding
  | MissingComponentSpecFinding
  | ComponentHttpCallsFinding
  | ComponentManyInjectionsFinding
  | ComponentStandaloneDuplicateImportsFinding
  | LargeServiceTsFinding
  | MixedResponsibilityServiceFinding
  | MissingServiceSpecFinding
  | ImportCycleFinding
  | LargeRoutesConfigFinding
  | UnmanagedSubscribeFinding
  | FromEventSubscribeNoCleanupFinding
  | BrokenDestroySubjectFinding
  | SubscriptionFieldNotUnsubscribedFinding
  | FromEventListenerNoRemoveFinding
  | SetIntervalNoClearFinding
  | RequestAnimationFrameNoCancelFinding
  | EffectMissingCleanupFinding
  | ToSignalManualCleanupFinding;

export interface AngularJson {
  version?: number;
  projects?: Record<string, AngularJsonProject>;
  defaultProject?: string;
}

export interface AngularJsonProject {
  root?: string;
  sourceRoot?: string;
  projectType?: string;
  // Keep extra fields without turning the file into `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
