export { auditWorkspace } from "./audit";
export { analyzeComponents, DEFAULT_COMPONENT_ANALYZER_CONFIG } from "./analyzers/component-analyzer";
export { analyzeTsComplexity } from "./analyzers/complexity-analyzer";
export { analyzeDuplicates, DEFAULT_DUPLICATION_ANALYZER_CONFIG } from "./analyzers/duplication-analyzer";
export { analyzeLifecycleLeakRisks } from "./analyzers/lifecycle-analyzer";
export { analyzeRoutes, DEFAULT_ROUTES_ANALYZER_CONFIG } from "./analyzers/routes-analyzer";
export { analyzeServices, DEFAULT_SERVICE_ANALYZER_CONFIG } from "./analyzers/service-analyzer";
export { analyzeSymbols, DEFAULT_SYMBOLS_ANALYZER_CONFIG } from "./analyzers/symbols-analyzer";
export { detectAngularArtifacts } from "./angular-artifacts";
export { extractRoutePaths } from "./angular-routes";
export { DEFAULT_CONFIG, applyRuleOverrides, createExcludeMatcher, loadWorkspaceConfig, mergeConfig } from "./config";
export { computeHotspotScores } from "./hotspots";
export { buildProjectTree } from "./project-tree";
export { renderHtmlReport } from "./report/html-report";
export { generateEngineeringBrief, renderEngineeringBriefMarkdown } from "./brief/brief";

export type {
  AnalyzerFinding,
  AnalyzerCategory,
  AngularJson,
  AngularJsonProject,
  AuditReport,
  AuditSummary,
  AuditWorkspaceOptions,
  ClassSymbol,
  DuplicateGroup,
  DuplicateOccurrence,
  FindingCategory,
  FindingConfidence,
  FindingSeverity,
  DiscoveredFile,
  DiscoveredRoute,
  HotspotScore,
  MethodMetrics,
  MethodReference,
  MethodSymbol,
  NgInspectorConfig,
  ProjectTree,
  ProjectTreeFile,
  ProjectTreeFileClass,
  RuleSeverityOverride,
  ProjectReport,
  SchemaVersion,
  SymbolFileSymbol,
  SymbolIndex,
  SymbolVisibility,
  TsFileComplexityMetrics,
} from "./types";

export type {
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
  BriefTaskEvidence,
  BriefTrack,
  BriefSchemaVersion,
  NgInspectorBrief,
} from "./brief/types";
