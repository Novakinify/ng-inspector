import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import type { AnalyzerFinding } from "../types";

export interface AnalyzeLifecycleLeakRisksOptions {
  workspaceRootAbs: string;
  filePaths: string[]; // workspace-relative posix paths
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

interface ImportNames {
  rxjsNamespace: Set<string>;
  rxjsInteropNamespace: Set<string>;
  angularCoreNamespace: Set<string>;

  fromEvent: Set<string>;
  interval: Set<string>;
  takeUntil: Set<string>;
  takeUntilDestroyed: Set<string>;
  toSignal: Set<string>;
  effect: Set<string>;
  Subscription: Set<string>;
}

interface NodeLocation {
  line: number;
  column: number;
}

interface Context {
  className?: string;
  methodName?: string;
}

function normalizePosixPath(p: string): string {
  let out = p.trim().replace(/\\/g, "/");
  if (out.startsWith("./")) out = out.slice(2);
  if (out.startsWith("/")) out = out.slice(1);
  return out;
}

function isAnalyzableTsPath(workspaceRelPosixPath: string): boolean {
  const p = normalizePosixPath(workspaceRelPosixPath);
  if (!p.endsWith(".ts")) return false;
  if (p.endsWith(".d.ts")) return false;
  if (p.endsWith(".spec.ts")) return false;
  return true;
}

function moduleSpecifierText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function collectImports(sourceFile: ts.SourceFile): ImportNames {
  const out: ImportNames = {
    rxjsNamespace: new Set<string>(),
    rxjsInteropNamespace: new Set<string>(),
    angularCoreNamespace: new Set<string>(),
    fromEvent: new Set<string>(),
    interval: new Set<string>(),
    takeUntil: new Set<string>(),
    takeUntilDestroyed: new Set<string>(),
    toSignal: new Set<string>(),
    effect: new Set<string>(),
    Subscription: new Set<string>(),
  };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleText = moduleSpecifierText(stmt.moduleSpecifier);
    if (!moduleText) continue;

    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings) continue;

    if (ts.isNamespaceImport(namedBindings)) {
      if (moduleText === "rxjs") out.rxjsNamespace.add(namedBindings.name.text);
      if (moduleText === "@angular/core/rxjs-interop") out.rxjsInteropNamespace.add(namedBindings.name.text);
      if (moduleText === "@angular/core") out.angularCoreNamespace.add(namedBindings.name.text);
      continue;
    }

    if (!ts.isNamedImports(namedBindings)) continue;
    for (const el of namedBindings.elements) {
      const imported = el.propertyName?.text ?? el.name.text;
      const local = el.name.text;

      if (moduleText === "rxjs") {
        if (imported === "fromEvent") out.fromEvent.add(local);
        if (imported === "interval") out.interval.add(local);
        if (imported === "takeUntil") out.takeUntil.add(local);
        if (imported === "Subscription") out.Subscription.add(local);
      }

      if (moduleText === "rxjs/operators") {
        if (imported === "takeUntil") out.takeUntil.add(local);
      }

      if (moduleText === "@angular/core/rxjs-interop") {
        if (imported === "takeUntilDestroyed") out.takeUntilDestroyed.add(local);
        if (imported === "toSignal") out.toSignal.add(local);
      }

      if (moduleText === "@angular/core") {
        if (imported === "effect") out.effect.add(local);
      }
    }
  }

  // Conservative fallbacks (rarely user-defined).
  out.fromEvent.add("fromEvent");
  out.interval.add("interval");
  out.takeUntil.add("takeUntil");
  out.takeUntilDestroyed.add("takeUntilDestroyed");
  out.toSignal.add("toSignal");
  out.effect.add("effect");
  out.Subscription.add("Subscription");

  return out;
}

function lineFromPos(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function columnFromPos(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).character + 1;
}

function locOfNode(sourceFile: ts.SourceFile, node: ts.Node): NodeLocation {
  const pos = node.getStart(sourceFile);
  return { line: lineFromPos(sourceFile, pos), column: columnFromPos(sourceFile, pos) };
}

function stableSortFindings(findings: AnalyzerFinding[]): void {
  findings.sort((a, b) => `${a.filePath}\n${a.code}`.localeCompare(`${b.filePath}\n${b.code}`));
}

function isCallToIdentifier(
  expr: ts.Expression,
  localNames: Set<string>,
  namespaceNames: Set<string>,
  importedName: string,
): boolean {
  if (ts.isIdentifier(expr)) return localNames.has(expr.text);
  if (ts.isPropertyAccessExpression(expr)) {
    if (!ts.isIdentifier(expr.expression)) return false;
    return namespaceNames.has(expr.expression.text) && expr.name.text === importedName;
  }
  return false;
}

function isCallExpressionTo(
  node: ts.CallExpression,
  localNames: Set<string>,
  namespaceNames: Set<string>,
  importedName: string,
): boolean {
  return isCallToIdentifier(node.expression, localNames, namespaceNames, importedName);
}

function unwrapObservableChain(expr: ts.Expression): { root: ts.Expression; pipeArgs: ts.Expression[] } {
  let current: ts.Expression = expr;
  const pipeArgs: ts.Expression[] = [];

  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }

    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "pipe"
    ) {
      for (const a of current.arguments) pipeArgs.push(a);
      current = current.expression.expression;
      continue;
    }

    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "asObservable"
    ) {
      current = current.expression.expression;
      continue;
    }

    break;
  }

  return { root: current, pipeArgs };
}

function hasOperatorCall(
  pipeArgs: ts.Expression[],
  opNames: Set<string>,
  opNs: Set<string>,
  opImportedName: string,
): boolean {
  for (const arg of pipeArgs) {
    if (!ts.isCallExpression(arg)) continue;
    if (isCallExpressionTo(arg, opNames, opNs, opImportedName)) return true;
  }
  return false;
}

function hasOneShotOperatorInPipe(pipeArgs: ts.Expression[]): boolean {
  // Conservative one-shot operator heuristics to reduce noise.
  // - take(1)
  // - first()
  for (const arg of pipeArgs) {
    if (!ts.isCallExpression(arg)) continue;
    const callee = arg.expression;
    if (!ts.isIdentifier(callee)) continue;
    if (callee.text === "first") return true;
    if (callee.text === "take") {
      const n0 = arg.arguments[0];
      if (n0 && ts.isNumericLiteral(n0) && n0.text === "1") return true;
    }
  }
  return false;
}

function thisPropertyName(expr: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expr)) return null;
  if (!isThisExpression(expr.expression)) return null;
  return expr.name.text;
}

function assignedToThisProp(call: ts.CallExpression): string | null {
  const parent = call.parent;
  if (!parent || !ts.isBinaryExpression(parent)) return null;
  if (parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (parent.right !== call) return null;
  return thisPropertyName(parent.left);
}

function findAddedToCompositeThisProp(call: ts.CallExpression): string | null {
  const parent = call.parent;
  if (!parent || !ts.isCallExpression(parent)) return null;
  if (!parent.arguments.some((a) => a === call)) return null;
  const callee = parent.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (callee.name.text !== "add") return null;
  return thisPropertyName(callee.expression);
}

function callIsThisPropMethod(call: ts.CallExpression, methodName: string): string | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (callee.name.text !== methodName) return null;
  return thisPropertyName(callee.expression);
}

function clearCallThisPropArg(call: ts.CallExpression, fnName: string): string | null {
  const callee = call.expression;
  const isId = ts.isIdentifier(callee) && callee.text === fnName;
  const isProp = ts.isPropertyAccessExpression(callee) && callee.name.text === fnName;
  if (!isId && !isProp) return null;
  const a0 = call.arguments[0];
  if (!a0) return null;
  return thisPropertyName(a0);
}

function propText(sourceFile: ts.SourceFile, expr: ts.Expression): string {
  return expr.getText(sourceFile).trim();
}

function isStringLiteralLike(expr: ts.Expression): expr is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr);
}

function addRemoveEventKey(targetText: string, eventName: string, handlerText: string): string {
  return `${targetText}::${eventName}::${handlerText}`;
}

function isObjectLiteralOnceTrue(expr: ts.Expression | undefined): boolean {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return false;
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name;
    const key = ts.isIdentifier(name) ? name.text : ts.isStringLiteral(name) ? name.text : null;
    if (key !== "once") continue;
    return prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}

function destroySubjectPropertyFromExpr(expr: ts.Expression): "destroy$" | "destroyed$" | null {
  if (!ts.isPropertyAccessExpression(expr)) return null;
  if (!isThisExpression(expr.expression)) return null;
  const name = expr.name.text;
  if (name === "destroy$" || name === "destroyed$") return name;
  return null;
}

function isThisExpression(node: ts.Node): node is ts.ThisExpression {
  return node.kind === ts.SyntaxKind.ThisKeyword;
}

interface SubscribeCallInfo {
  loc: NodeLocation;
  ctx: Context;
  rootKind: "fromEvent" | "interval" | "observable";
  rootText: string;
  rootPropertyName?: string;
  isLikelyHttpOneShot: boolean;
  isFromEvent: boolean;
  hasTakeUntilDestroyed: boolean;
  hasTakeUntilDestroySubject: boolean;
  destroySubjectProperty?: "destroy$" | "destroyed$";
  hasOneShotOperator: boolean;
  assignedToThisProperty?: string;
  addedToCompositeProperty?: string;
  fromEventEventName?: string;
  fromEventTargetText?: string;
}

interface SubscriptionFieldAssignment {
  fieldName: string;
  loc: NodeLocation;
  ctx: Context;
  assignedInMethod?: string;
  hasCleanupOperator: boolean;
}

interface CompositeSubscriptionField {
  fieldName: string;
  loc: NodeLocation;
}

interface AddEventListenerInfo {
  loc: NodeLocation;
  ctx: Context;
  targetText: string;
  eventName: string;
  handlerText: string;
  hasOnceOption: boolean;
}

interface SetIntervalInfo {
  loc: NodeLocation;
  ctx: Context;
  propertyName: string;
}

interface RafInfo {
  loc: NodeLocation;
  ctx: Context;
  propertyName: string;
}

interface EffectInfo {
  loc: NodeLocation;
  ctx: Context;
  hasOnCleanupParam: boolean;
  callsOnCleanup: boolean;
  resources: string[];
}

interface ToSignalInfo {
  loc: NodeLocation;
  ctx: Context;
}

const HTTP_METHOD_NAMES = new Set<string>(["get", "post", "put", "patch", "delete", "request"]);

function takeUntilUsesDestroySubject(call: ts.CallExpression): "destroy$" | "destroyed$" | null {
  const a0 = call.arguments[0];
  if (!a0) return null;
  return destroySubjectPropertyFromExpr(a0);
}

function scanEffectResources(
  sourceFile: ts.SourceFile,
  fn: ts.FunctionLikeDeclarationBase,
): { resources: string[]; callsOnCleanup: boolean } {
  const resources = new Set<string>();
  let callsOnCleanup = false;

  const onCleanupParam = fn.parameters[0];
  const onCleanupName = onCleanupParam && ts.isIdentifier(onCleanupParam.name) ? onCleanupParam.name.text : null;

  const visit = (node: ts.Node) => {
    if (onCleanupName && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === onCleanupName) {
      callsOnCleanup = true;
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        if (callee.text === "setInterval") resources.add("setInterval");
        if (callee.text === "requestAnimationFrame") resources.add("requestAnimationFrame");
      } else if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === "addEventListener") resources.add("addEventListener");
      }
    }

    ts.forEachChild(node, visit);
  };

  if (fn.body) ts.forEachChild(fn.body, visit);
  return { resources: Array.from(resources).sort(), callsOnCleanup };
}

function getSubscribeInfo(
  sourceFile: ts.SourceFile,
  imports: ImportNames,
  call: ts.CallExpression,
  ctx: Context,
): SubscribeCallInfo | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (callee.name.text !== "subscribe") return null;

  const { root, pipeArgs } = unwrapObservableChain(callee.expression);

  const hasTakeUntilDestroyed = hasOperatorCall(
    pipeArgs,
    imports.takeUntilDestroyed,
    imports.rxjsInteropNamespace,
    "takeUntilDestroyed",
  );

  let destroySubjectProperty: "destroy$" | "destroyed$" | undefined;
  let hasTakeUntilDestroySubject = false;
  for (const arg of pipeArgs) {
    if (!ts.isCallExpression(arg)) continue;
    if (!isCallExpressionTo(arg, imports.takeUntil, imports.rxjsNamespace, "takeUntil")) continue;
    const subj = takeUntilUsesDestroySubject(arg);
    if (!subj) continue;
    destroySubjectProperty = subj;
    hasTakeUntilDestroySubject = true;
    break;
  }

  const hasOneShotOperator = hasOneShotOperatorInPipe(pipeArgs);

  let rootKind: SubscribeCallInfo["rootKind"] = "observable";
  let isFromEvent = false;
  let fromEventEventName: string | undefined;
  let fromEventTargetText: string | undefined;
  let rootPropertyName: string | undefined;
  let isLikelyHttpOneShot = false;

  if (ts.isPropertyAccessExpression(root)) rootPropertyName = root.name.text;
  if (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression)) {
    const method = root.expression.name.text;
    if (HTTP_METHOD_NAMES.has(method)) {
      const recv = propText(sourceFile, root.expression.expression).toLowerCase();
      // Heuristic only: avoid loudly flagging one-shot HttpClient subscriptions.
      if (recv.includes("http")) isLikelyHttpOneShot = true;
    }
  }

  if (ts.isCallExpression(root) && isCallExpressionTo(root, imports.fromEvent, imports.rxjsNamespace, "fromEvent")) {
    rootKind = "fromEvent";
    isFromEvent = true;
    const target = root.arguments[0];
    const ev = root.arguments[1];
    if (target) fromEventTargetText = propText(sourceFile, target);
    if (ev && isStringLiteralLike(ev)) fromEventEventName = ev.text;
  } else if (ts.isCallExpression(root) && isCallExpressionTo(root, imports.interval, imports.rxjsNamespace, "interval")) {
    rootKind = "interval";
  }

  return {
    loc: locOfNode(sourceFile, callee.name),
    ctx,
    rootKind,
    rootText: propText(sourceFile, root),
    rootPropertyName,
    isLikelyHttpOneShot,
    isFromEvent,
    hasTakeUntilDestroyed,
    hasTakeUntilDestroySubject,
    destroySubjectProperty,
    hasOneShotOperator,
    fromEventEventName,
    fromEventTargetText,
  };
}

function methodNameForMember(member: ts.ClassElement): string | undefined {
  if (ts.isConstructorDeclaration(member)) return "constructor";
  if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) return member.name.text;
  return undefined;
}

const LONG_LIVED_OBSERVABLE_PROPERTY_NAMES = new Set<string>([
  "events", // Router.events
  "valueChanges", // forms
  "statusChanges",
  "params", // ActivatedRoute
  "queryParams",
  "paramMap",
  "queryParamMap",
]);

function analyzeClass(
  sourceFile: ts.SourceFile,
  filePath: string,
  imports: ImportNames,
  node: ts.ClassDeclaration,
): AnalyzerFinding[] {
  const className = node.name?.text;
  const baseCtx: Context = className ? { className } : {};

  // Cleanup facts (class-wide, conservative: if we see cleanup anywhere, we treat it as handled).
  const unsubscribedProps = new Set<string>();
  const clearedIntervalProps = new Set<string>();
  const canceledRafProps = new Set<string>();
  const removedEventKeys = new Set<string>();
  const destroySubjectsUsedInTakeUntil = new Map<"destroy$" | "destroyed$", NodeLocation>();

  const compositeFields: CompositeSubscriptionField[] = [];
  const compositeUsed = new Set<string>();

  // ngOnDestroy-specific destroy$ teardown (for takeUntil(destroy$) correctness).
  const destroyNextInOnDestroy = new Set<"destroy$" | "destroyed$">();
  const destroyCompleteInOnDestroy = new Set<"destroy$" | "destroyed$">();
  let hasNgOnDestroy = false;

  let ngOnDestroyMethod: ts.MethodDeclaration | null = null;
  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    if (member.name.text !== "ngOnDestroy") continue;
    hasNgOnDestroy = true;
    ngOnDestroyMethod = member;
  }

  if (ngOnDestroyMethod?.body) {
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const nextProp = callIsThisPropMethod(n, "next");
        const completeProp = callIsThisPropMethod(n, "complete");
        if (nextProp === "destroy$" || nextProp === "destroyed$") destroyNextInOnDestroy.add(nextProp);
        if (completeProp === "destroy$" || completeProp === "destroyed$") destroyCompleteInOnDestroy.add(completeProp);
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(ngOnDestroyMethod.body, visit);
  }

  // Scan class for cleanup calls, takeUntil destroy$ usage, and composite subscription fields.
  const scanClassWide = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const unsubProp = callIsThisPropMethod(n, "unsubscribe");
      if (unsubProp) unsubscribedProps.add(unsubProp);

      const cleared = clearCallThisPropArg(n, "clearInterval");
      if (cleared) clearedIntervalProps.add(cleared);

      const canceled = clearCallThisPropArg(n, "cancelAnimationFrame");
      if (canceled) canceledRafProps.add(canceled);

      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "removeEventListener") {
        const a0 = n.arguments[0];
        const a1 = n.arguments[1];
        if (a0 && a1 && isStringLiteralLike(a0) && (ts.isIdentifier(a1) || ts.isPropertyAccessExpression(a1))) {
          const targetText = propText(sourceFile, callee.expression);
          removedEventKeys.add(addRemoveEventKey(targetText, a0.text, propText(sourceFile, a1)));
        }
      }

      if (isCallExpressionTo(n, imports.takeUntil, imports.rxjsNamespace, "takeUntil")) {
        const subj = takeUntilUsesDestroySubject(n);
        const a0 = n.arguments[0];
        if (subj && a0 && !destroySubjectsUsedInTakeUntil.has(subj)) {
          destroySubjectsUsedInTakeUntil.set(subj, locOfNode(sourceFile, a0));
        }
      }

      // this.subs.add(...)
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "add") {
        const prop = thisPropertyName(callee.expression);
        if (prop) compositeUsed.add(prop);
      }
    }

    if (ts.isPropertyDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      const propName = n.name.text;
      if (ts.isNewExpression(n.initializer)) {
        if (isCallToIdentifier(n.initializer.expression, imports.Subscription, imports.rxjsNamespace, "Subscription")) {
          compositeFields.push({ fieldName: propName, loc: locOfNode(sourceFile, n.name) });
        }
      }
    }

    ts.forEachChild(n, scanClassWide);
  };

  ts.forEachChild(node, scanClassWide);

  // Member-level scans for risky patterns (subscribe, addEventListener, timers, effect, toSignal).
  const subscribeCalls: SubscribeCallInfo[] = [];
  const subscriptionFieldAssignments: SubscriptionFieldAssignment[] = [];
  const addListeners: AddEventListenerInfo[] = [];
  const setIntervals: SetIntervalInfo[] = [];
  const rafs: RafInfo[] = [];
  const effects: EffectInfo[] = [];
  const toSignals: ToSignalInfo[] = [];

  const scanWithContext = (member: ts.ClassElement) => {
    const methodName = methodNameForMember(member);
    const ctx: Context = methodName ? { ...baseCtx, methodName } : baseCtx;

    const owningPropName =
      ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const sub = getSubscribeInfo(sourceFile, imports, n, ctx);
        if (sub) {
          const assigned = assignedToThisProp(n) ?? owningPropName;
          if (assigned) sub.assignedToThisProperty = assigned;
          const composite = findAddedToCompositeThisProp(n);
          if (composite) sub.addedToCompositeProperty = composite;
          subscribeCalls.push(sub);

          if (assigned) {
            const hasCleanupOperator =
              sub.hasTakeUntilDestroyed ||
              sub.hasTakeUntilDestroySubject ||
              sub.hasOneShotOperator ||
              sub.isLikelyHttpOneShot;
            subscriptionFieldAssignments.push({
              fieldName: assigned,
              loc: sub.loc,
              ctx,
              assignedInMethod: ctx.methodName,
              hasCleanupOperator,
            });
          }
        }

        const callee = n.expression;

        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "addEventListener") {
          const a0 = n.arguments[0];
          const a1 = n.arguments[1];
          const a2 = n.arguments[2];
          if (a0 && a1 && isStringLiteralLike(a0) && (ts.isIdentifier(a1) || ts.isPropertyAccessExpression(a1))) {
            addListeners.push({
              loc: locOfNode(sourceFile, callee.name),
              ctx,
              targetText: propText(sourceFile, callee.expression),
              eventName: a0.text,
              handlerText: propText(sourceFile, a1),
              hasOnceOption: isObjectLiteralOnceTrue(a2),
            });
          }
        }

        if (ts.isIdentifier(callee) && callee.text === "setInterval") {
          const prop = assignedToThisProp(n) ?? owningPropName;
          if (prop) setIntervals.push({ loc: locOfNode(sourceFile, callee), ctx, propertyName: prop });
        }

        if (ts.isIdentifier(callee) && callee.text === "requestAnimationFrame") {
          const prop = assignedToThisProp(n) ?? owningPropName;
          if (prop) rafs.push({ loc: locOfNode(sourceFile, callee), ctx, propertyName: prop });
        }

        if (isCallExpressionTo(n, imports.effect, imports.angularCoreNamespace, "effect")) {
          const fn = n.arguments[0];
          if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
            const hasOnCleanupParam = fn.parameters.length >= 1;
            const { resources, callsOnCleanup } = scanEffectResources(sourceFile, fn);
            if (resources.length > 0) {
              effects.push({
                loc: locOfNode(sourceFile, n.expression),
                ctx,
                hasOnCleanupParam,
                callsOnCleanup,
                resources,
              });
            }
          }
        }

        if (isCallExpressionTo(n, imports.toSignal, imports.rxjsInteropNamespace, "toSignal")) {
          const opts = n.arguments[1];
          if (opts && ts.isObjectLiteralExpression(opts)) {
            for (const prop of opts.properties) {
              if (!ts.isPropertyAssignment(prop)) continue;
              const name = prop.name;
              const key = ts.isIdentifier(name) ? name.text : ts.isStringLiteral(name) ? name.text : null;
              if (key !== "manualCleanup") continue;
              if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                toSignals.push({ loc: locOfNode(sourceFile, n.expression), ctx });
              }
            }
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) && member.body) {
      visit(member.body);
    } else if (ts.isPropertyDeclaration(member) && member.initializer) {
      visit(member.initializer);
    }
  };

  for (const member of node.members) scanWithContext(member);

  const findings: AnalyzerFinding[] = [];

  // Broken destroy$ patterns: only when takeUntil(this.destroy$|destroyed$) is used.
  for (const [subj, loc] of destroySubjectsUsedInTakeUntil) {
    const callsNext = destroyNextInOnDestroy.has(subj);
    const callsComplete = destroyCompleteInOnDestroy.has(subj);
    if (hasNgOnDestroy && callsNext) continue;

    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "high",
      code: "lifecycle-broken-destroy-subject",
      message: `${filePath} uses takeUntil(this.${subj}) but ngOnDestroy does not trigger ${subj}.next().`,
      whyItMatters:
        "Completing a destroy$ subject without emitting does not trigger takeUntil(), leaving subscriptions alive longer than expected.",
      suggestedActions: [
        `In ngOnDestroy, call this.${subj}.next(); then this.${subj}.complete().`,
        "Or replace the pattern with takeUntilDestroyed() (Angular rxjs-interop).",
      ],
      filePath,
      metadata: {
        className,
        subjectProperty: subj,
        line: loc.line,
        column: loc.column,
        usesTakeUntil: true,
        hasNgOnDestroy,
        callsNext,
        callsComplete,
      },
    });
  }

  // Subscription fields that are assigned (from subscribe() or a composite Subscription) but never unsubscribed.
  const reportedFields = new Set<string>();

  for (const a of subscriptionFieldAssignments) {
    if (reportedFields.has(a.fieldName)) continue;
    if (a.hasCleanupOperator) continue;
    if (unsubscribedProps.has(a.fieldName)) continue;
    reportedFields.add(a.fieldName);

    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "high",
      code: "lifecycle-subscription-field-not-unsubscribed",
      message: `${filePath} assigns a Subscription to ${a.ctx.className ? "this." : ""}${a.fieldName} but never unsubscribes it.`,
      whyItMatters: "Subscriptions held on a class instance can keep streams alive and leak work after destruction.",
      suggestedActions: [
        "Unsubscribe the field in ngOnDestroy (this." + a.fieldName + ".unsubscribe()).",
        "Or use takeUntilDestroyed() to avoid manual subscription management.",
      ],
      filePath,
      metadata: {
        className: a.ctx.className,
        fieldName: a.fieldName,
        assignedInMethod: a.assignedInMethod,
        line: a.loc.line,
        column: a.loc.column,
      },
    });
  }

  for (const c of compositeFields) {
    if (reportedFields.has(c.fieldName)) continue;
    if (!compositeUsed.has(c.fieldName)) continue;
    if (unsubscribedProps.has(c.fieldName)) continue;
    reportedFields.add(c.fieldName);

    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-subscription-field-not-unsubscribed",
      message: `${filePath} uses this.${c.fieldName}.add(...) but never unsubscribes this.${c.fieldName}.`,
      whyItMatters: "A composite Subscription accumulates inner subscriptions; forgetting to unsubscribe can leak listeners and timers.",
      suggestedActions: [
        "Unsubscribe the composite in ngOnDestroy (this." + c.fieldName + ".unsubscribe()).",
        "Or use takeUntilDestroyed() for each stream instead of manual aggregation.",
      ],
      filePath,
      metadata: {
        className,
        fieldName: c.fieldName,
        assignedInMethod: undefined,
        line: c.loc.line,
        column: c.loc.column,
      },
    });
  }

  // addEventListener without removeEventListener.
  for (const add of addListeners) {
    if (add.hasOnceOption) continue;
    const key = addRemoveEventKey(add.targetText, add.eventName, add.handlerText);
    if (removedEventKeys.has(key)) continue;

    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-addEventListener-no-remove",
      message: `${filePath} adds an event listener (${add.eventName}) without a matching removeEventListener().`,
      whyItMatters: "Unremoved event listeners can keep components/services alive and cause repeated work over time.",
      suggestedActions: [
        "Remove the listener in ngOnDestroy (removeEventListener with the same handler reference).",
        "Consider RxJS fromEvent(...).pipe(takeUntilDestroyed(...)) in Angular code.",
      ],
      filePath,
      metadata: {
        className: add.ctx.className,
        methodName: add.ctx.methodName,
        line: add.loc.line,
        column: add.loc.column,
        targetText: add.targetText,
        eventName: add.eventName,
        handlerText: add.handlerText,
        hasOnceOption: add.hasOnceOption,
      },
    });
  }

  // setInterval without clearInterval (only when id is stored on this.*).
  for (const si of setIntervals) {
    if (clearedIntervalProps.has(si.propertyName)) continue;
    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-setInterval-no-clearInterval",
      message: `${filePath} stores a setInterval id (this.${si.propertyName}) without clearInterval(this.${si.propertyName}).`,
      whyItMatters: "Intervals keep firing after teardown, causing memory and CPU leaks.",
      suggestedActions: [
        "Clear the interval in ngOnDestroy (clearInterval(this." + si.propertyName + ")).",
        "Prefer RxJS interval().pipe(takeUntilDestroyed(...)) when possible.",
      ],
      filePath,
      metadata: {
        className: si.ctx.className,
        methodName: si.ctx.methodName,
        line: si.loc.line,
        column: si.loc.column,
        intervalIdProperty: si.propertyName,
      },
    });
  }

  // requestAnimationFrame without cancelAnimationFrame (only when id is stored on this.*).
  for (const r of rafs) {
    if (canceledRafProps.has(r.propertyName)) continue;
    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-requestAnimationFrame-no-cancelAnimationFrame",
      message: `${filePath} stores a requestAnimationFrame id (this.${r.propertyName}) without cancelAnimationFrame(this.${r.propertyName}).`,
      whyItMatters: "Uncanceled animation frames can keep work running and leak memory/CPU over time.",
      suggestedActions: ["Cancel the frame in ngOnDestroy (cancelAnimationFrame(this." + r.propertyName + "))."],
      filePath,
      metadata: {
        className: r.ctx.className,
        methodName: r.ctx.methodName,
        line: r.loc.line,
        column: r.loc.column,
        requestIdProperty: r.propertyName,
      },
    });
  }

  // toSignal(..., { manualCleanup: true })
  for (const t of toSignals) {
    findings.push({
      severity: "info",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-toSignal-manualCleanup",
      message: `${filePath} uses toSignal(..., { manualCleanup: true }).`,
      whyItMatters:
        "manualCleanup disables automatic teardown. If lifecycle cleanup is missed, the observable subscription can leak.",
      suggestedActions: ["Ensure you dispose/cleanup the subscription manually, or remove manualCleanup when not needed."],
      filePath,
      metadata: {
        className: t.ctx.className,
        methodName: t.ctx.methodName,
        line: t.loc.line,
        column: t.loc.column,
      },
    });
  }

  // effect() missing onCleanup when long-running resources are created.
  for (const e of effects) {
    if (e.callsOnCleanup) continue;
    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-effect-missing-onCleanup",
      message: `${filePath} creates long-running work inside effect() without registering cleanup.`,
      whyItMatters: "Effects can rerun and outlive the intended context; missing cleanup can leak timers/listeners and duplicate side effects.",
      suggestedActions: [
        "Accept an onCleanup parameter and register teardown (onCleanup(() => ...)).",
        "Avoid creating timers/listeners in effects unless they are explicitly cleaned up.",
      ],
      filePath,
      metadata: {
        className: e.ctx.className,
        methodName: e.ctx.methodName,
        line: e.loc.line,
        column: e.loc.column,
        resources: e.resources,
        hasOnCleanupParam: e.hasOnCleanupParam,
      },
    });
  }

  // Subscribe leak risks (conservative).
  const isLongLivedByPropName = (name: string | undefined) =>
    typeof name === "string" && LONG_LIVED_OBSERVABLE_PROPERTY_NAMES.has(name);

  for (const sub of subscribeCalls) {
    if (sub.hasTakeUntilDestroyed) continue;
    if (sub.hasTakeUntilDestroySubject) continue;
    if (sub.hasOneShotOperator) continue;
    if (sub.assignedToThisProperty) continue;
    // If it's added to a composite subscription, defer to the composite teardown rule to avoid duplicates/noise.
    if (sub.addedToCompositeProperty) continue;

    const isLongLived =
      sub.rootKind === "fromEvent" ||
      sub.rootKind === "interval" ||
      isLongLivedByPropName(sub.rootPropertyName);
    if (!isLongLived) continue;

    if (sub.rootKind === "fromEvent") {
      findings.push({
        severity: "warning",
        category: "lifecycle",
        confidence: "high",
        code: "lifecycle-fromEvent-subscribe-no-cleanup",
        message: `${filePath} subscribes to fromEvent(...) without a clear cleanup signal.`,
        whyItMatters: "fromEvent streams do not complete on their own; unmanaged subscriptions can leak event listeners.",
        suggestedActions: [
          "Use takeUntilDestroyed() in the pipe chain.",
          "Or store the Subscription and unsubscribe in ngOnDestroy.",
        ],
        filePath,
        metadata: {
          className: sub.ctx.className,
          methodName: sub.ctx.methodName,
          line: sub.loc.line,
          column: sub.loc.column,
          eventName: sub.fromEventEventName,
          targetText: sub.fromEventTargetText,
        },
      });
      continue;
    }

    findings.push({
      severity: "warning",
      category: "lifecycle",
      confidence: "medium",
      code: "lifecycle-unmanaged-subscribe",
      message: `${filePath} has a subscribe() call that may not be cleaned up.`,
      whyItMatters: "Long-lived subscriptions can leak work after teardown and cause hard-to-debug behavior over time.",
      suggestedActions: [
        "Prefer takeUntilDestroyed() (Angular) or takeUntil(destroy$) with a correct ngOnDestroy teardown.",
        "Or store the Subscription and unsubscribe in ngOnDestroy.",
      ],
      filePath,
      metadata: {
        className: sub.ctx.className,
        methodName: sub.ctx.methodName,
        line: sub.loc.line,
        column: sub.loc.column,
        rootKind: sub.rootKind,
        rootText: sub.rootText,
        reason: "No takeUntilDestroyed/takeUntil(destroy$) and not managed by unsubscribe().",
      },
    });
  }

  return findings;
}

function analyzeSourceFile(sourceFile: ts.SourceFile, filePath: string, imports: ImportNames): AnalyzerFinding[] {
  const out: AnalyzerFinding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node)) {
      out.push(...analyzeClass(sourceFile, filePath, imports, node));
      return; // class analysis already walks children
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return out;
}

export async function analyzeLifecycleLeakRisks(options: AnalyzeLifecycleLeakRisksOptions): Promise<AnalyzerFinding[]> {
  const workspaceRootAbs = path.resolve(options.workspaceRootAbs);
  const findings: AnalyzerFinding[] = [];

  for (const raw of options.filePaths) {
    const filePath = normalizePosixPath(raw);
    if (!isAnalyzableTsPath(filePath)) continue;
    if (options.isExcludedPath?.(filePath)) continue;

    const abs = path.resolve(workspaceRootAbs, filePath);
    let text: string;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }

    const sourceFile = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    const imports = collectImports(sourceFile);
    findings.push(...analyzeSourceFile(sourceFile, filePath, imports));
  }

  stableSortFindings(findings);
  return findings;
}
