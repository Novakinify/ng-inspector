export type FindingSeverity = "error" | "warning" | "info";

export type FindingConfidence = "high" | "medium" | "low";

// Allow forward-compatible categories without sacrificing intellisense.
export type FindingCategory =
  | "components"
  | "services"
  | "routes"
  | "imports"
  | "lifecycle"
  | (string & {});

export interface AnalyzerFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: FindingConfidence;
  code: string;
  message: string;
  whyItMatters: string;
  suggestedActions: string[];
  filePath: string; // workspace-relative posix path
  metadata: Record<string, unknown>;
}

export type SymbolVisibility = "public" | "protected" | "private";

export interface MethodMetrics {
  lineCount: number;
  branchCount: number;
  parameterCount: number;
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

export interface SymbolIndex {
  files: SymbolFileSymbol[];
  classes: ClassSymbol[];
  methods: MethodSymbol[];
}

export interface MethodReference {
  methodId: string;
  filePath: string; // workspace-relative posix path
  line: number; // 1-based
  column: number; // 1-based
  snippet: string;
}

export interface AuditReport {
  schemaVersion: number;
  generatedAt: string; // ISO timestamp
  workspaceRoot: string;
  angularJsonPath: string;
  projects: ProjectReport[];
  findings: AnalyzerFinding[];
  importGraph: ImportGraphSummary;
  summary: AuditSummary;
  projectTree: ProjectTree;
  symbols: SymbolIndex;
  methodReferences: MethodReference[];
  duplicateGroups: DuplicateGroup[];
  hotspotScores: HotspotScore[];
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
  sourceRoot: string; // workspace-relative posix directory path
  rootFolder: ProjectTreeFolder;
}

export interface ProjectTreeFolder {
  path: string; // workspace-relative posix directory path
  folders: ProjectTreeFolder[];
  files: ProjectTreeFile[];
  components: DiscoveredFile[];
  directives: DiscoveredFile[];
  pipes: DiscoveredFile[];
  services: DiscoveredFile[];
  routes: DiscoveredRoute[];
}

export interface ProjectTreeFile {
  filePath: string; // workspace-relative posix file path
  classes: ProjectTreeFileClass[];
}

export interface ProjectTreeFileClass {
  classId: string;
  methodIds: string[];
}

export interface DuplicateOccurrence {
  filePath: string;
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
  filePath: string;
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
  findingCodes: string[];
  reportKeys: string[];
}

export interface DiscoveredFile {
  filePath: string;
}

export interface DiscoveredRoute {
  filePath: string;
  path: string;
}
