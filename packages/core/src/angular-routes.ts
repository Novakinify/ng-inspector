import ts from "typescript";

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

interface RouterImports {
  routesTypeNames: Set<string>;
  provideRouterNames: Set<string>;
  routerModuleNames: Set<string>;
  namespaceNames: Set<string>;
}

function getRouterImports(sourceFile: ts.SourceFile): RouterImports {
  const out: RouterImports = {
    routesTypeNames: new Set<string>(),
    provideRouterNames: new Set<string>(),
    routerModuleNames: new Set<string>(),
    namespaceNames: new Set<string>(),
  };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleText = moduleSpecifierText(stmt.moduleSpecifier);
    if (moduleText !== "@angular/router") continue;

    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings) continue;

    if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        const local = el.name.text;
        if (imported === "Routes") out.routesTypeNames.add(local);
        if (imported === "provideRouter") out.provideRouterNames.add(local);
        if (imported === "RouterModule") out.routerModuleNames.add(local);
      }
    } else if (ts.isNamespaceImport(namedBindings)) {
      out.namespaceNames.add(namedBindings.name.text);
    }
  }

  return out;
}

function isIdentifierText(node: ts.Node, text: string): boolean {
  return ts.isIdentifier(node) && node.text === text;
}

function isTypeRefToAny(node: ts.TypeNode | undefined, names: Set<string>): boolean {
  if (!node) return false;
  if (!ts.isTypeReferenceNode(node)) return false;
  const t = node.typeName;
  return ts.isIdentifier(t) && names.has(t.text);
}

function unwrapArrayLiteral(expr: ts.Expression | undefined): ts.ArrayLiteralExpression | null {
  if (!expr) return null;
  if (ts.isParenthesizedExpression(expr)) return unwrapArrayLiteral(expr.expression);
  if (ts.isArrayLiteralExpression(expr)) return expr;
  if (ts.isAsExpression(expr)) return unwrapArrayLiteral(expr.expression);
  if (ts.isTypeAssertionExpression(expr)) return unwrapArrayLiteral(expr.expression);
  if (ts.isSatisfiesExpression(expr)) return unwrapArrayLiteral(expr.expression);
  return null;
}

function routeObjectPathValue(obj: ts.ObjectLiteralExpression): string | null {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name;
    const key = ts.isIdentifier(name) ? name.text : ts.isStringLiteral(name) ? name.text : null;
    if (key !== "path") continue;
    const init = prop.initializer;
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
  }
  return null;
}

function looksLikeRoutesArray(arr: ts.ArrayLiteralExpression): boolean {
  for (const el of arr.elements) {
    if (ts.isObjectLiteralExpression(el) && routeObjectPathValue(el) !== null) return true;
  }
  return false;
}

function extractPathsFromRoutesArray(arr: ts.ArrayLiteralExpression, out: Set<string>): void {
  for (const el of arr.elements) {
    if (ts.isObjectLiteralExpression(el)) {
      const p = routeObjectPathValue(el);
      if (p !== null) out.add(p);

      for (const prop of el.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = prop.name;
        const key = ts.isIdentifier(name) ? name.text : ts.isStringLiteral(name) ? name.text : null;
        if (key !== "children") continue;
        const childrenArr = unwrapArrayLiteral(prop.initializer);
        if (childrenArr) extractPathsFromRoutesArray(childrenArr, out);
      }
    }
  }
}

function isProvideRouterCall(expr: ts.LeftHandSideExpression, imports: RouterImports): boolean {
  if (ts.isIdentifier(expr)) return imports.provideRouterNames.has(expr.text);
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const ns = expr.expression.text;
    return imports.namespaceNames.has(ns) && expr.name.text === "provideRouter";
  }
  return false;
}

function isRouterModuleForRootOrChild(expr: ts.LeftHandSideExpression, imports: RouterImports): boolean {
  if (!ts.isPropertyAccessExpression(expr)) return false;
  const method = expr.name.text;
  if (method !== "forRoot" && method !== "forChild") return false;

  const target = expr.expression;
  if (ts.isIdentifier(target)) return imports.routerModuleNames.has(target.text);

  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
    const ns = target.expression.text;
    return imports.namespaceNames.has(ns) && target.name.text === "RouterModule";
  }

  return false;
}

export function extractRoutePaths(sourceFile: ts.SourceFile): string[] {
  const routerImports = getRouterImports(sourceFile);
  const hasAnyRouterImport =
    routerImports.routesTypeNames.size ||
    routerImports.provideRouterNames.size ||
    routerImports.routerModuleNames.size ||
    routerImports.namespaceNames.size;
  if (!hasAnyRouterImport) return [];

  const routeArraysByIdent = new Map<string, ts.ArrayLiteralExpression>();
  const routesArrayCandidates = new Set<ts.ArrayLiteralExpression>();

  // Pass 1: capture top-level arrays assigned to identifiers.
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const arr = unwrapArrayLiteral(decl.initializer);
      if (!arr) continue;
      routeArraysByIdent.set(decl.name.text, arr);

      // If explicitly typed as Routes, treat as a route array.
      if (isTypeRefToAny(decl.type, routerImports.routesTypeNames) && looksLikeRoutesArray(arr)) {
        routesArrayCandidates.add(arr);
      }

      // If `... satisfies Routes`, treat as a route array.
      if (
        decl.initializer &&
        ts.isSatisfiesExpression(decl.initializer) &&
        isTypeRefToAny(decl.initializer.type, routerImports.routesTypeNames)
      ) {
        if (looksLikeRoutesArray(arr)) routesArrayCandidates.add(arr);
      }
      if (decl.initializer && ts.isAsExpression(decl.initializer) && isTypeRefToAny(decl.initializer.type, routerImports.routesTypeNames)) {
        if (looksLikeRoutesArray(arr)) routesArrayCandidates.add(arr);
      }
    }
  }

  // Pass 2: capture arrays passed to provideRouter / RouterModule.forRoot / forChild.
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg0 = node.arguments[0];

      if (callee && isProvideRouterCall(callee, routerImports)) {
        const arr = unwrapArrayLiteral(arg0);
        if (arr && looksLikeRoutesArray(arr)) routesArrayCandidates.add(arr);
        if (arg0 && ts.isIdentifier(arg0)) {
          const mapped = routeArraysByIdent.get(arg0.text);
          if (mapped && looksLikeRoutesArray(mapped)) routesArrayCandidates.add(mapped);
        }
      }

      if (callee && isRouterModuleForRootOrChild(callee, routerImports)) {
        const arr = unwrapArrayLiteral(arg0);
        if (arr && looksLikeRoutesArray(arr)) routesArrayCandidates.add(arr);
        if (arg0 && ts.isIdentifier(arg0)) {
          const mapped = routeArraysByIdent.get(arg0.text);
          if (mapped && looksLikeRoutesArray(mapped)) routesArrayCandidates.add(mapped);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const paths = new Set<string>();
  for (const arr of routesArrayCandidates) extractPathsFromRoutesArray(arr, paths);

  return Array.from(paths).sort((a, b) => a.localeCompare(b));
}
