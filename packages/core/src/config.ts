import fs from "node:fs/promises";
import path from "node:path";

import type { AnalyzerFinding, FindingSeverity, NgInspectorConfig, RuleSeverityOverride } from "./types";

const CONFIG_FILE_NAME = "ng-inspector.config.json";

export const DEFAULT_CONFIG: NgInspectorConfig = {
  exclude: {
    paths: [],
  },
  thresholds: {
    componentTsLines: 200,
    componentTemplateLines: 200,
    serviceTsLines: 200,
    serviceMixedMinLines: 120,
    serviceMixedMinSignals: 3,
  },
  rules: {},
  report: {
    outputDir: ".ng-inspector",
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const el of value) {
    if (typeof el === "string" && el.trim().length) out.push(el);
  }
  return out;
}

function parseRuleSeverityOverride(value: unknown): RuleSeverityOverride | null {
  if (value === "off" || value === "info" || value === "warning" || value === "error") return value;
  return null;
}

function sanitizePathPattern(pattern: string): string {
  let p = pattern.trim().replace(/\\/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) p = p.slice(1);
  return p;
}

function parseConfigObject(value: unknown): Partial<NgInspectorConfig> {
  if (!isPlainObject(value)) return {};

  const out: Partial<NgInspectorConfig> = {};

  // exclude
  const exclude = value.exclude;
  if (isPlainObject(exclude)) {
    const pathsArr = readStringArray(exclude.paths);
    if (pathsArr) {
      out.exclude = { paths: pathsArr.map(sanitizePathPattern).filter((p) => p.length > 0) };
    }
  }

  // thresholds
  const thresholds = value.thresholds;
  if (isPlainObject(thresholds)) {
    const t: Partial<NgInspectorConfig["thresholds"]> = {};

    const componentTsLines = readNumber(thresholds.componentTsLines);
    if (typeof componentTsLines === "number" && componentTsLines > 0) t.componentTsLines = componentTsLines;

    const componentTemplateLines = readNumber(thresholds.componentTemplateLines);
    if (typeof componentTemplateLines === "number" && componentTemplateLines > 0)
      t.componentTemplateLines = componentTemplateLines;

    const serviceTsLines = readNumber(thresholds.serviceTsLines);
    if (typeof serviceTsLines === "number" && serviceTsLines > 0) t.serviceTsLines = serviceTsLines;

    const serviceMixedMinLines = readNumber(thresholds.serviceMixedMinLines);
    if (typeof serviceMixedMinLines === "number" && serviceMixedMinLines > 0) t.serviceMixedMinLines = serviceMixedMinLines;

    const serviceMixedMinSignals = readNumber(thresholds.serviceMixedMinSignals);
    if (typeof serviceMixedMinSignals === "number" && serviceMixedMinSignals > 0)
      t.serviceMixedMinSignals = serviceMixedMinSignals;

    if (Object.keys(t).length) out.thresholds = t as NgInspectorConfig["thresholds"];
  }

  // rules
  const rules = value.rules;
  if (isPlainObject(rules)) {
    const parsed: Record<string, RuleSeverityOverride> = {};
    for (const [key, val] of Object.entries(rules)) {
      const sev = parseRuleSeverityOverride(val);
      if (!sev) continue;
      parsed[key] = sev;
    }
    if (Object.keys(parsed).length) out.rules = parsed;
  }

  // report
  const report = value.report;
  if (isPlainObject(report)) {
    const outputDir = readString(report.outputDir);
    if (outputDir && outputDir.trim().length) {
      out.report = { outputDir: outputDir.trim() };
    }
  }

  return out;
}

export function mergeConfig(defaults: NgInspectorConfig, user: Partial<NgInspectorConfig>): NgInspectorConfig {
  return {
    exclude: {
      paths: user.exclude?.paths ?? defaults.exclude.paths,
    },
    thresholds: {
      componentTsLines: user.thresholds?.componentTsLines ?? defaults.thresholds.componentTsLines,
      componentTemplateLines: user.thresholds?.componentTemplateLines ?? defaults.thresholds.componentTemplateLines,
      serviceTsLines: user.thresholds?.serviceTsLines ?? defaults.thresholds.serviceTsLines,
      serviceMixedMinLines: user.thresholds?.serviceMixedMinLines ?? defaults.thresholds.serviceMixedMinLines,
      serviceMixedMinSignals: user.thresholds?.serviceMixedMinSignals ?? defaults.thresholds.serviceMixedMinSignals,
    },
    rules: {
      ...defaults.rules,
      ...(user.rules ?? {}),
    },
    report: {
      outputDir: user.report?.outputDir ?? defaults.report.outputDir,
    },
  };
}

export async function loadWorkspaceConfig(workspaceRootAbs: string): Promise<NgInspectorConfig> {
  const configPathAbs = path.join(workspaceRootAbs, CONFIG_FILE_NAME);

  let raw: string;
  try {
    raw = await fs.readFile(configPathAbs, "utf8");
  } catch (err) {
    // Missing config is normal: just use defaults.
    if (err && typeof err === "object" && (err as { code?: unknown }).code === "ENOENT") return DEFAULT_CONFIG;
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }

  const user = parseConfigObject(parsed);
  return mergeConfig(DEFAULT_CONFIG, user);
}

function globToRegExp(glob: string): RegExp | null {
  const g = sanitizePathPattern(glob);
  if (!g) return null;

  let out = "^";
  let i = 0;

  while (i < g.length) {
    const ch = g[i];

    if (ch === "*") {
      const next = g[i + 1];
      if (next === "*") {
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }

    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    // Escape regex special characters.
    if ("\\.[]{}()+-^$|".includes(ch)) out += `\\${ch}`;
    else out += ch;
    i += 1;
  }

  out += "$";
  try {
    return new RegExp(out);
  } catch {
    return null;
  }
}

export type ExcludeMatcher = (workspaceRelPosixPath: string) => boolean;

export function createExcludeMatcher(patterns: string[]): ExcludeMatcher {
  const matchers: ExcludeMatcher[] = [];

  for (const raw of patterns) {
    const p = sanitizePathPattern(raw);
    if (!p) continue;

    const hasGlob = p.includes("*") || p.includes("?");
    if (!hasGlob) {
      const prefix = p.replace(/\/+$/, "");
      matchers.push((candidate) => {
        const c = sanitizePathPattern(candidate);
        return c === prefix || c.startsWith(prefix + "/");
      });
      continue;
    }

    const re = globToRegExp(p);
    if (!re) continue;
    matchers.push((candidate) => re.test(sanitizePathPattern(candidate)));
  }

  return (candidate) => {
    for (const m of matchers) {
      if (m(candidate)) return true;
    }
    return false;
  };
}

export function applyRuleOverrides(
  findings: AnalyzerFinding[],
  rules: Record<string, RuleSeverityOverride>,
): AnalyzerFinding[] {
  const ruleKeys = Object.keys(rules);
  if (!ruleKeys.length) return findings;

  const out: AnalyzerFinding[] = [];
  for (const f of findings) {
    const override = rules[f.code];
    if (!override) {
      out.push(f);
      continue;
    }
    if (override === "off") continue;

    const severity: FindingSeverity = override;
    if (severity === f.severity) {
      out.push(f);
      continue;
    }
    out.push({ ...f, severity });
  }

  // Keep output stable.
  out.sort((a, b) => `${a.filePath}\n${a.code}`.localeCompare(`${b.filePath}\n${b.code}`));
  return out;
}
