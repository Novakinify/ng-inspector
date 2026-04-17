import ts from "typescript";

export interface AngularArtifactsInFile {
  hasComponent: boolean;
  hasDirective: boolean;
  hasPipe: boolean;
  hasInjectable: boolean;
}

interface AngularCoreImports {
  componentNames: Set<string>;
  directiveNames: Set<string>;
  pipeNames: Set<string>;
  injectableNames: Set<string>;
  namespaceNames: Set<string>;
}

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function getAngularCoreImports(sourceFile: ts.SourceFile): AngularCoreImports {
  const out: AngularCoreImports = {
    componentNames: new Set<string>(),
    directiveNames: new Set<string>(),
    pipeNames: new Set<string>(),
    injectableNames: new Set<string>(),
    namespaceNames: new Set<string>(),
  };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    const moduleText = moduleSpecifierText(spec);
    if (moduleText !== "@angular/core") continue;

    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings) continue;

    if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        const local = el.name.text;
        if (imported === "Component") out.componentNames.add(local);
        if (imported === "Directive") out.directiveNames.add(local);
        if (imported === "Pipe") out.pipeNames.add(local);
        if (imported === "Injectable") out.injectableNames.add(local);
      }
    } else if (ts.isNamespaceImport(namedBindings)) {
      out.namespaceNames.add(namedBindings.name.text);
    }
  }

  return out;
}

function decoratorCallName(
  expr: ts.LeftHandSideExpression,
  imports: AngularCoreImports,
): { kind: "id"; name: string } | { kind: "ns"; namespace: string; name: string } | null {
  if (ts.isIdentifier(expr)) return { kind: "id", name: expr.text };

  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const namespace = expr.expression.text;
    if (!imports.namespaceNames.has(namespace)) return null;
    return { kind: "ns", namespace, name: expr.name.text };
  }

  return null;
}

function hasDecorator(
  classDecl: ts.ClassDeclaration,
  imports: AngularCoreImports,
  localNames: Set<string>,
  namespaceDecoratorName: string,
): boolean {
  if (!ts.canHaveDecorators(classDecl)) return false;
  const decorators = ts.getDecorators(classDecl);
  if (!decorators || !decorators.length) return false;

  for (const d of decorators) {
    const e = d.expression;
    if (ts.isCallExpression(e)) {
      const name = decoratorCallName(e.expression, imports);
      if (!name) continue;
      if (name.kind === "id" && localNames.has(name.name)) return true;
      if (name.kind === "ns" && name.name === namespaceDecoratorName) return true;
    } else if (ts.isIdentifier(e)) {
      // Extremely uncommon in Angular, but harmless to support.
      if (localNames.has(e.text)) return true;
    }
  }

  return false;
}

export function detectAngularArtifacts(sourceFile: ts.SourceFile): AngularArtifactsInFile {
  const imports = getAngularCoreImports(sourceFile);

  // Conservative: if we didn't import anything relevant from @angular/core, don't report artifacts.
  const hasAnyImport =
    imports.componentNames.size ||
    imports.directiveNames.size ||
    imports.pipeNames.size ||
    imports.injectableNames.size ||
    imports.namespaceNames.size;
  if (!hasAnyImport) {
    return { hasComponent: false, hasDirective: false, hasPipe: false, hasInjectable: false };
  }

  let hasComponent = false;
  let hasDirective = false;
  let hasPipe = false;
  let hasInjectable = false;

  for (const stmt of sourceFile.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;

    if (!hasComponent && hasDecorator(stmt, imports, imports.componentNames, "Component")) hasComponent = true;
    if (!hasDirective && hasDecorator(stmt, imports, imports.directiveNames, "Directive")) hasDirective = true;
    if (!hasPipe && hasDecorator(stmt, imports, imports.pipeNames, "Pipe")) hasPipe = true;
    if (!hasInjectable && hasDecorator(stmt, imports, imports.injectableNames, "Injectable")) hasInjectable = true;

    if (hasComponent && hasDirective && hasPipe && hasInjectable) break;
  }

  return { hasComponent, hasDirective, hasPipe, hasInjectable };
}

