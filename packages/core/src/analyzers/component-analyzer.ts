import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import { toWorkspaceRelativePosixPath } from "../path";
import type { AnalyzerFinding } from "../types";

export interface ComponentAnalyzerConfig {
  maxComponentTsLines: number;
  maxTemplateLines: number;
}

export const DEFAULT_COMPONENT_ANALYZER_CONFIG: ComponentAnalyzerConfig = {
  maxComponentTsLines: 200,
  maxTemplateLines: 200,
};

export interface AnalyzeComponentsOptions {
  workspaceRootAbs: string;
  projectName: string;
  componentFilePaths: string[]; // workspace-relative, posix
  config?: Partial<ComponentAnalyzerConfig>;
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

// Conservative property matching to reduce false positives from string literals.
const TEMPLATE_URL_RE = /(^|[,{]\s*)templateUrl\s*:\s*(['"`])([^'"`]+)\2/m;
const INLINE_TEMPLATE_RE = /(^|[,{]\s*)template\s*:/m;
const INLINE_TEMPLATE_BT_RE = /(^|[,{]\s*)template\s*:\s*`([\s\S]*?)`/m;
const INLINE_STYLES_RE = /(^|[,{]\s*)styles\s*:/m;

const COMPONENT_DECORATOR_CALL_RE = /@Component\s*\(/;
const CLASS_DECL_RE = /^\s*export\s+(default\s+)?class\b/m;
const DECORATOR_WINDOW_MAX_CHARS = 200_000;

const MAX_CONSTRUCTOR_INJECTIONS = 8;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "request"]);

function countLines(text: string): number {
  // Note: this counts blank lines too; it's a simple conservative heuristic.
  return text.split(/\r?\n/).length;
}

function sliceComponentDecoratorWindow(tsSourceText: string): string {
  const idx = tsSourceText.search(COMPONENT_DECORATOR_CALL_RE);
  if (idx < 0) return tsSourceText;

  const maxWindow = tsSourceText.slice(idx, idx + DECORATOR_WINDOW_MAX_CHARS);
  const classMatch = maxWindow.match(CLASS_DECL_RE);
  if (classMatch && typeof classMatch.index === "number") {
    return maxWindow.slice(0, classMatch.index);
  }
  return maxWindow;
}

function expectedSpecPath(componentFilePath: string): string | null {
  if (!componentFilePath.endsWith(".component.ts")) return null;
  return componentFilePath.replace(/\.component\.ts$/, ".component.spec.ts");
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function isWithinDir(parentAbs: string, childAbs: string): boolean {
  const rel = path.relative(parentAbs, childAbs);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function stableSortFindings(findings: AnalyzerFinding[]): void {
  findings.sort((a, b) => {
    const keyA = `${a.filePath}\n${a.code}`;
    const keyB = `${b.filePath}\n${b.code}`;
    return keyA.localeCompare(keyB);
  });
}

interface AngularComponentImports {
  componentNames: Set<string>;
  namespaceNames: Set<string>;
}

interface AngularHttpImports {
  httpClientNames: Set<string>;
  namespaceNames: Set<string>;
}

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function getAngularCoreComponentImports(sourceFile: ts.SourceFile): AngularComponentImports {
  const out: AngularComponentImports = { componentNames: new Set<string>(), namespaceNames: new Set<string>() };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleText = moduleSpecifierText(stmt.moduleSpecifier);
    if (moduleText !== "@angular/core") continue;

    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings) continue;

    if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        const local = el.name.text;
        if (imported === "Component") out.componentNames.add(local);
      }
    } else if (ts.isNamespaceImport(namedBindings)) {
      out.namespaceNames.add(namedBindings.name.text);
    }
  }

  return out;
}

function getAngularHttpClientImports(sourceFile: ts.SourceFile): AngularHttpImports {
  const out: AngularHttpImports = { httpClientNames: new Set<string>(), namespaceNames: new Set<string>() };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleText = moduleSpecifierText(stmt.moduleSpecifier);
    if (moduleText !== "@angular/common/http") continue;

    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings) continue;

    if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        const local = el.name.text;
        if (imported === "HttpClient") out.httpClientNames.add(local);
      }
    } else if (ts.isNamespaceImport(namedBindings)) {
      out.namespaceNames.add(namedBindings.name.text);
    }
  }

  return out;
}

function decoratorCallName(
  expr: ts.LeftHandSideExpression,
  imports: AngularComponentImports,
): { kind: "id"; name: string } | { kind: "ns"; namespace: string; name: string } | null {
  if (ts.isIdentifier(expr)) return { kind: "id", name: expr.text };

  // core.Component
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const namespace = expr.expression.text;
    if (!imports.namespaceNames.has(namespace)) return null;
    return { kind: "ns", namespace, name: expr.name.text };
  }

  return null;
}

function getComponentDecoratorCall(classDecl: ts.ClassDeclaration, imports: AngularComponentImports): ts.CallExpression | null {
  if (!ts.canHaveDecorators(classDecl)) return null;
  const decorators = ts.getDecorators(classDecl);
  if (!decorators || !decorators.length) return null;

  for (const d of decorators) {
    const e = d.expression;
    if (!ts.isCallExpression(e)) continue;
    const name = decoratorCallName(e.expression, imports);
    if (!name) continue;
    if (name.kind === "id" && imports.componentNames.has(name.name)) return e;
    if (name.kind === "ns" && name.name === "Component") return e;
  }

  return null;
}

function getDecoratorObjectArg(call: ts.CallExpression): ts.ObjectLiteralExpression | null {
  const arg0 = call.arguments[0];
  return arg0 && ts.isObjectLiteralExpression(arg0) ? arg0 : null;
}

function readBooleanProperty(obj: ts.ObjectLiteralExpression, key: string): boolean | null {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    if (!ts.isIdentifier(p.name) || p.name.text !== key) continue;
    if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  }
  return null;
}

function readArrayProperty(obj: ts.ObjectLiteralExpression, key: string): ts.ArrayLiteralExpression | null {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    if (!ts.isIdentifier(p.name) || p.name.text !== key) continue;
    return ts.isArrayLiteralExpression(p.initializer) ? p.initializer : null;
  }
  return null;
}

function hasParameterPropertyModifier(param: ts.ParameterDeclaration): boolean {
  const mods = ts.getModifiers(param);
  if (!mods) return false;
  for (const m of mods) {
    if (
      m.kind === ts.SyntaxKind.PublicKeyword ||
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.ReadonlyKeyword
    ) {
      return true;
    }
  }
  return false;
}

function isHttpClientType(typeNode: ts.TypeNode | undefined, imports: AngularHttpImports): boolean {
  if (!typeNode) return false;
  if (!ts.isTypeReferenceNode(typeNode)) return false;

  const name = typeNode.typeName;
  if (ts.isIdentifier(name)) return imports.httpClientNames.has(name.text);

  // core.HttpClient
  if (ts.isQualifiedName(name) && ts.isIdentifier(name.left) && ts.isIdentifier(name.right)) {
    return imports.namespaceNames.has(name.left.text) && name.right.text === "HttpClient";
  }

  return false;
}

function stringifyImportExpr(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) return `${expr.expression.text}.${expr.name.text}`;
  return null;
}

function findHttpMethodsCalledOnProperty(classDecl: ts.ClassDeclaration, propName: string): string[] {
  const methods = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const isPropAccess = ts.isPropertyAccessExpression(expr);
      if (isPropAccess) {
        const method = expr.name.text;
        if (HTTP_METHODS.has(method)) {
          const recv = expr.expression;
          if (ts.isPropertyAccessExpression(recv) && recv.expression.kind === ts.SyntaxKind.ThisKeyword) {
            if (recv.name.text === propName) methods.add(method);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  for (const m of classDecl.members) ts.forEachChild(m, visit);

  return Array.from(methods).sort((a, b) => a.localeCompare(b));
}

export async function analyzeComponents(options: AnalyzeComponentsOptions): Promise<AnalyzerFinding[]> {
  const config: ComponentAnalyzerConfig = { ...DEFAULT_COMPONENT_ANALYZER_CONFIG, ...(options.config ?? {}) };

  const findings: AnalyzerFinding[] = [];

  for (const componentFilePath of options.componentFilePaths) {
    if (options.isExcludedPath?.(componentFilePath)) continue;

    const componentAbs = path.resolve(options.workspaceRootAbs, componentFilePath);
    const tsText = await fs.readFile(componentAbs, "utf8");
    const sourceFile = ts.createSourceFile(componentAbs, tsText, ts.ScriptTarget.Latest, true);

    // Avoid reporting on files that look like components by name but lack the decorator call.
    const decoratorText = sliceComponentDecoratorWindow(tsText);
    const hasComponentDecorator = COMPONENT_DECORATOR_CALL_RE.test(decoratorText);
    if (!hasComponentDecorator) continue;

    const coreImports = getAngularCoreComponentImports(sourceFile);
    const httpImports = getAngularHttpClientImports(sourceFile);

    // Component anti-patterns (AST-based, conservative)
    for (const stmt of sourceFile.statements) {
      if (!ts.isClassDeclaration(stmt)) continue;
      const componentCall = getComponentDecoratorCall(stmt, coreImports);
      if (!componentCall) continue;

      const ctor = stmt.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
      const ctorParamCount = ctor?.parameters.length ?? 0;
      if (ctorParamCount > MAX_CONSTRUCTOR_INJECTIONS) {
        findings.push({
          severity: "warning",
          category: "components",
          confidence: "high",
          code: "component-many-injections",
          message: `${componentFilePath} constructor injects ${ctorParamCount} dependencies (max ${MAX_CONSTRUCTOR_INJECTIONS}).`,
          whyItMatters: "Many constructor injections often indicate a component that owns too many responsibilities and is harder to test.",
          suggestedActions: [
            "Extract UI logic into smaller child components.",
            "Move orchestration/data-fetching into a facade/service.",
            "Group related dependencies behind a single service interface.",
          ],
          filePath: componentFilePath,
          metadata: {
            projectName: options.projectName,
            componentFilePath,
            constructorParamCount: ctorParamCount,
            maxConstructorParams: MAX_CONSTRUCTOR_INJECTIONS,
          },
        });
      }

      if (ctor) {
        for (const p of ctor.parameters) {
          if (!hasParameterPropertyModifier(p)) continue;
          if (!ts.isIdentifier(p.name)) continue;
          if (!isHttpClientType(p.type, httpImports)) continue;

          const propName = p.name.text;
          const methods = findHttpMethodsCalledOnProperty(stmt, propName);
          if (methods.length === 0) continue;

          findings.push({
            severity: "warning",
            category: "components",
            confidence: "high",
            code: "component-http-calls",
            message: `${componentFilePath} performs HTTP calls directly via HttpClient (${methods.join(", ")}).`,
            whyItMatters: "HTTP calls in components can couple UI to data access, making reuse and testing harder.",
            suggestedActions: [
              "Move HTTP calls into a dedicated service/facade.",
              "Keep the component focused on presentation and user interaction.",
              "Test the service separately and mock it in component tests.",
            ],
            filePath: componentFilePath,
            metadata: {
              projectName: options.projectName,
              componentFilePath,
              httpPropertyName: propName,
              methods,
            },
          });
        }
      }

      const decoObj = getDecoratorObjectArg(componentCall);
      if (decoObj) {
        const isStandalone = readBooleanProperty(decoObj, "standalone") === true;
        if (isStandalone) {
          const importsArr = readArrayProperty(decoObj, "imports");
          if (importsArr) {
            const seen = new Set<string>();
            const dup = new Set<string>();
            for (const el of importsArr.elements) {
              if (!ts.isExpression(el)) continue;
              const s = stringifyImportExpr(el);
              if (!s) continue;
              if (seen.has(s)) dup.add(s);
              else seen.add(s);
            }
            const duplicates = Array.from(dup).sort((a, b) => a.localeCompare(b));
            if (duplicates.length) {
              findings.push({
                severity: "info",
                category: "components",
                confidence: "high",
                code: "component-standalone-duplicate-imports",
                message: `${componentFilePath} has duplicate standalone imports: ${duplicates.join(", ")}.`,
                whyItMatters: "Duplicate entries in a standalone component's imports add noise and can hide real unused imports.",
                suggestedActions: ["Remove duplicate entries from the @Component imports array."],
                filePath: componentFilePath,
                metadata: {
                  projectName: options.projectName,
                  componentFilePath,
                  duplicates,
                },
              });
            }
          }
        }
      }
    }

    const tsLineCount = countLines(tsText);
    if (tsLineCount > config.maxComponentTsLines) {
      findings.push({
        severity: "warning",
        category: "components",
        confidence: "high",
        code: "component-large-ts",
        message: `${componentFilePath} is ${tsLineCount} lines (max ${config.maxComponentTsLines}).`,
        whyItMatters: "Large component files are harder to understand, review, and maintain.",
        suggestedActions: ["Split the component into smaller components.", "Move logic into services or helpers."],
        filePath: componentFilePath,
        metadata: {
          projectName: options.projectName,
          componentFilePath,
          tsLineCount,
          maxTsLines: config.maxComponentTsLines,
        },
      });
    }

    const specRel = expectedSpecPath(componentFilePath);
    if (specRel) {
      const specAbs = path.resolve(options.workspaceRootAbs, specRel);
      const hasSpec = await fileExists(specAbs);
      if (!hasSpec) {
        findings.push({
          severity: "warning",
          category: "components",
          confidence: "high",
          code: "component-missing-spec",
          message: `${componentFilePath} has no matching spec file (${specRel}).`,
          whyItMatters: "Missing specs reduce confidence in refactors and make regressions harder to catch.",
          suggestedActions: ["Add a basic component spec and cover key behaviors."],
          filePath: componentFilePath,
          metadata: {
            projectName: options.projectName,
            componentFilePath,
            expectedSpecFilePath: specRel,
          },
        });
      }
    }

    const templateUrlMatch = decoratorText.match(TEMPLATE_URL_RE);
    if (templateUrlMatch) {
      const templateUrl = templateUrlMatch[3];
      if (typeof templateUrl === "string" && templateUrl.length) {
        const templateAbs = path.resolve(path.dirname(componentAbs), templateUrl);
        if (isWithinDir(options.workspaceRootAbs, templateAbs)) {
          const hasTemplate = await fileExists(templateAbs);
          if (hasTemplate) {
            const templateText = await fs.readFile(templateAbs, "utf8");
            const templateLineCount = countLines(templateText);

            if (templateLineCount > config.maxTemplateLines) {
              const templateFilePath = toWorkspaceRelativePosixPath(options.workspaceRootAbs, templateAbs);
              if (!options.isExcludedPath?.(templateFilePath)) {
                findings.push({
                  severity: "warning",
                  category: "components",
                  confidence: "high",
                  code: "component-large-template",
                  message: `${templateFilePath} is ${templateLineCount} lines (max ${config.maxTemplateLines}).`,
                  whyItMatters: "Large templates can become difficult to maintain and are prone to subtle UI bugs.",
                  suggestedActions: ["Extract parts into child components.", "Move complex logic out of the template."],
                  filePath: templateFilePath,
                  metadata: {
                    projectName: options.projectName,
                    componentFilePath,
                    templateKind: "external",
                    templateFilePath,
                    templateLineCount,
                    maxTemplateLines: config.maxTemplateLines,
                  },
                });
              }
            }
          }
        }
      }
    }

    if (INLINE_TEMPLATE_RE.test(decoratorText)) {
      const inlineTemplateMatch = decoratorText.match(INLINE_TEMPLATE_BT_RE);
      const inlineTemplateText = inlineTemplateMatch?.[2];
      const templateLineCount = typeof inlineTemplateText === "string" ? countLines(inlineTemplateText) : undefined;

      findings.push({
        severity: "info",
        category: "components",
        confidence: "medium",
        code: "component-inline-template",
        message: `${componentFilePath} uses an inline template.`,
        whyItMatters: "Inline templates can make components harder to scan and diff, especially as they grow.",
        suggestedActions: ["Prefer external templates for non-trivial components."],
        filePath: componentFilePath,
        metadata: {
          projectName: options.projectName,
          componentFilePath,
          templateKind: "inline",
          templateLineCount,
        },
      });

      if (typeof templateLineCount === "number" && templateLineCount > config.maxTemplateLines) {
        findings.push({
          severity: "warning",
          category: "components",
          confidence: "high",
          code: "component-large-template",
          message: `${componentFilePath} inline template is ${templateLineCount} lines (max ${config.maxTemplateLines}).`,
          whyItMatters: "Large inline templates are especially hard to maintain because logic and markup are interleaved.",
          suggestedActions: ["Move the template to an external HTML file.", "Extract parts into child components."],
          filePath: componentFilePath,
          metadata: {
            projectName: options.projectName,
            componentFilePath,
            templateKind: "inline",
            templateLineCount,
            maxTemplateLines: config.maxTemplateLines,
          },
        });
      }
    }

    if (INLINE_STYLES_RE.test(decoratorText)) {
      findings.push({
        severity: "info",
        category: "components",
        confidence: "medium",
        code: "component-inline-styles",
        message: `${componentFilePath} uses inline styles.`,
        whyItMatters: "Inline styles can grow quickly and make styles harder to reuse and review.",
        suggestedActions: ["Prefer external style files for non-trivial components."],
        filePath: componentFilePath,
        metadata: {
          projectName: options.projectName,
          componentFilePath,
        },
      });
    }
  }

  stableSortFindings(findings);
  return findings;
}
