import path from "node:path";

import ts from "typescript";

import type {
  ClassSymbol,
  DuplicateGroup,
  DuplicateOccurrence,
  MethodReference,
  MethodSymbol,
  SymbolFileSymbol,
  SymbolIndex,
  SymbolVisibility,
} from "../types";

export interface SymbolsAnalyzerConfig {
  /**
   * Minimum method body size (in lines) before we consider it for duplication.
   * Keeps results conservative and avoids small boilerplate matches.
   */
  minBodyLines: number;

  /**
   * Minimum token count before we consider a method body for duplication.
   */
  minBodyTokens: number;

  /**
   * Maximum number of references to keep per method (safety cap for large workspaces).
   */
  maxReferencesPerMethod: number;

  /**
   * Preview limits for duplicate groups.
   */
  previewMaxLines: number;
  previewMaxChars: number;
}

export const DEFAULT_SYMBOLS_ANALYZER_CONFIG: SymbolsAnalyzerConfig = {
  minBodyLines: 10,
  minBodyTokens: 80,
  maxReferencesPerMethod: 200,
  previewMaxLines: 14,
  previewMaxChars: 900,
};

export interface SymbolsAnalyzerOptions {
  workspaceRootAbs: string;
  filePaths: string[]; // workspace-relative posix paths
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
  config?: Partial<SymbolsAnalyzerConfig>;
}

export interface SymbolsAnalyzerResult {
  symbols: SymbolIndex;
  methodReferences: MethodReference[];
  duplicateGroups: DuplicateGroup[]; // method-body duplicates
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

function lineFromPos(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function columnFromPos(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).character + 1;
}

function clampPreview(text: string, config: SymbolsAnalyzerConfig): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const limitedLines = lines.slice(0, Math.max(1, config.previewMaxLines));
  let out = limitedLines.join("\n").trimEnd();
  if (out.length > config.previewMaxChars) out = out.slice(0, config.previewMaxChars).trimEnd() + "...";
  return out;
}

function getVisibility(member: ts.ClassElement): SymbolVisibility {
  const flags = ts.getCombinedModifierFlags(member);
  if (flags & ts.ModifierFlags.Private) return "private";
  if (flags & ts.ModifierFlags.Protected) return "protected";
  return "public";
}

function branchDelta(node: ts.Node): number {
  if (ts.isIfStatement(node)) return 1;
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) return 1;
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return 1;
  if (ts.isConditionalExpression(node)) return 1;
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return 1;
  if (ts.isCatchClause(node)) return 1;
  return 0;
}

function countBranches(root: ts.Node): number {
  let branches = 0;
  const visit = (node: ts.Node) => {
    branches += branchDelta(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return branches;
}

function normalizeExactBlockText(blockText: string): string {
  const lines = blockText.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/g, ""));

  while (lines.length && lines[0]?.trim().length === 0) lines.shift();
  while (lines.length && lines[lines.length - 1]?.trim().length === 0) lines.pop();

  let minIndent: number | null = null;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const m = line.match(/^[ \t]+/);
    const indent = m ? m[0].length : 0;
    minIndent = minIndent === null ? indent : Math.min(minIndent, indent);
  }

  const strip = minIndent ?? 0;
  const stripped = strip > 0 ? lines.map((l) => (l.length >= strip ? l.slice(strip) : l)) : lines;
  return stripped.join("\n");
}

function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isIdentifierLike(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.Identifier ||
    kind === ts.SyntaxKind.PrivateIdentifier ||
    kind === ts.SyntaxKind.OutKeyword ||
    kind === ts.SyntaxKind.TypeKeyword
  );
}

function isStringLike(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.StringLiteral ||
    kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === ts.SyntaxKind.TemplateHead ||
    kind === ts.SyntaxKind.TemplateMiddle ||
    kind === ts.SyntaxKind.TemplateTail
  );
}

function isNumberLike(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral;
}

function normalizeToken(kind: ts.SyntaxKind, tokenText: string): string {
  if (isIdentifierLike(kind)) return "<id>";
  if (isStringLike(kind)) return "<str>";
  if (isNumberLike(kind)) return "<num>";
  if (kind === ts.SyntaxKind.RegularExpressionLiteral) return "<re>";
  return tokenText;
}

function scanNormalizedTokens(text: string): { normalized: string[]; tokenCount: number } {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const normalized: string[] = [];

  for (;;) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    normalized.push(normalizeToken(token, scanner.getTokenText()));
  }

  return { normalized, tokenCount: normalized.length };
}

function tryLoadTsConfigOptions(workspaceRootAbs: string): ts.CompilerOptions | null {
  const tsconfigAbs = path.join(workspaceRootAbs, "tsconfig.json");
  try {
    // Using sync TS helpers is fine here; we only need options.
    if (!ts.sys.fileExists(tsconfigAbs)) return null;
    const configFile = ts.readConfigFile(tsconfigAbs, ts.sys.readFile);
    if (configFile.error) return null;
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, workspaceRootAbs, undefined, tsconfigAbs);
    return parsed.options ?? null;
  } catch {
    return null;
  }
}

function buildProgram(workspaceRootAbs: string, filePaths: string[]): ts.Program {
  const rootNamesAbs = filePaths.map((p) => path.resolve(workspaceRootAbs, p));
  const tsconfigOptions = tryLoadTsConfigOptions(workspaceRootAbs);

  const options: ts.CompilerOptions = {
    // Conservative defaults that work well for local TS workspaces even without a tsconfig.json.
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ...(tsconfigOptions ?? {}),
    noEmit: true,
    skipLibCheck: true,
  };

  return ts.createProgram({ rootNames: rootNamesAbs, options });
}

function stableSortSymbols(out: SymbolIndex): void {
  out.files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  out.classes.sort((a, b) => `${a.filePath}\n${a.name}\n${a.startLine}`.localeCompare(`${b.filePath}\n${b.name}\n${b.startLine}`));
  out.methods.sort((a, b) =>
    `${a.filePath}\n${a.className}\n${a.name}\n${a.startLine}`.localeCompare(`${b.filePath}\n${b.className}\n${b.name}\n${b.startLine}`),
  );
}

function stableSortOccurrences(occurrences: DuplicateOccurrence[]): void {
  occurrences.sort((a, b) => `${a.filePath}\n${a.startLine}`.localeCompare(`${b.filePath}\n${b.startLine}`));
}

function buildGroupsFromBuckets(
  kind: DuplicateGroup["kind"],
  buckets: Map<string, { occurrences: DuplicateOccurrence[]; preview: string; tokenCount: number; lineCount: number }>,
): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];

  for (const [hash, bucket] of buckets.entries()) {
    const occ = bucket.occurrences;
    if (occ.length < 2) continue;
    const distinctFiles = new Set(occ.map((o) => o.filePath)).size;
    if (distinctFiles < 2) continue;

    stableSortOccurrences(occ);

    out.push({
      id: `dup:${kind}:${hash}`,
      kind,
      hash,
      tokenCount: bucket.tokenCount,
      lineCount: bucket.lineCount,
      preview: bucket.preview,
      occurrences: occ,
    });
  }

  out.sort((a, b) => {
    const keyA = `${a.kind}\n${String(a.occurrences.length).padStart(6, "0")}\n${a.hash}`;
    const keyB = `${b.kind}\n${String(b.occurrences.length).padStart(6, "0")}\n${b.hash}`;
    return keyB.localeCompare(keyA); // bigger groups first
  });

  return out;
}

function methodId(filePath: string, className: string, methodName: string, startLine: number): string {
  return `method:${normalizePosixPath(filePath)}#${className}.${methodName}@${startLine}`;
}

function classId(filePath: string, className: string, startLine: number): string {
  return `class:${normalizePosixPath(filePath)}#${className}@${startLine}`;
}

function fileId(filePath: string): string {
  return `file:${normalizePosixPath(filePath)}`;
}

function getWorkspaceRelPosixPath(workspaceRootAbs: string, fileNameAbs: string): string {
  const rel = path.relative(workspaceRootAbs, fileNameAbs);
  return normalizePosixPath(rel);
}

function lineSnippet(text: string, line1Based: number, maxLen = 220): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const line = lines[line1Based - 1] ?? "";
  const trimmed = line.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen).trimEnd() + "...";
}

export async function analyzeSymbols(options: SymbolsAnalyzerOptions): Promise<SymbolsAnalyzerResult> {
  const config: SymbolsAnalyzerConfig = { ...DEFAULT_SYMBOLS_ANALYZER_CONFIG, ...(options.config ?? {}) };
  const workspaceRootAbs = path.resolve(options.workspaceRootAbs);

  const filePaths = options.filePaths
    .map(normalizePosixPath)
    .filter((p) => isAnalyzableTsPath(p))
    .filter((p) => !options.isExcludedPath?.(p));

  const program = buildProgram(workspaceRootAbs, filePaths);
  const checker = program.getTypeChecker();

  const classSymbols: ClassSymbol[] = [];
  const methodSymbols: MethodSymbol[] = [];
  const fileSymbols: SymbolFileSymbol[] = [];

  const methodIdByDeclKey = new Map<string, string>();
  const methodCountById = new Map<string, number>();

  const fileSet = new Set(filePaths.map((p) => path.resolve(workspaceRootAbs, p)));

  for (const sourceFile of program.getSourceFiles()) {
    // Ignore lib files and any TS file not in our explicitly provided roots.
    if (!fileSet.has(path.resolve(sourceFile.fileName))) continue;

    const filePath = getWorkspaceRelPosixPath(workspaceRootAbs, sourceFile.fileName);

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        const startPos = node.getStart(sourceFile);
        const endPos = Math.max(node.getEnd() - 1, startPos);
        const startLine = lineFromPos(sourceFile, startPos);
        const endLine = lineFromPos(sourceFile, endPos);
        const cId = classId(filePath, name, startLine);

        classSymbols.push({ id: cId, name, filePath, startLine, endLine });

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          if (!member.body) continue;
          if (!member.name || !ts.isIdentifier(member.name)) continue;

          const methodName = member.name.text;
          const mStartPos = member.getStart(sourceFile);
          const mEndPos = Math.max(member.getEnd() - 1, mStartPos);
          const mStartLine = lineFromPos(sourceFile, mStartPos);
          const mEndLine = lineFromPos(sourceFile, mEndPos);
          const mId = methodId(filePath, name, methodName, mStartLine);

          const vis = getVisibility(member);
          const branchCount = countBranches(member.body);
          const lineCount = Math.max(1, mEndLine - mStartLine + 1);
          const parameterCount = member.parameters.length;

          methodSymbols.push({
            id: mId,
            name: methodName,
            filePath,
            classId: cId,
            className: name,
            visibility: vis,
            startLine: mStartLine,
            endLine: mEndLine,
            metrics: { lineCount, branchCount, parameterCount },
          });
          methodIdByDeclKey.set(`${filePath}:${member.getStart(sourceFile)}`, mId);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  const filePathsWithClasses = new Set(classSymbols.map((c) => c.filePath));
  for (const fp of Array.from(filePathsWithClasses).sort((a, b) => a.localeCompare(b))) {
    fileSymbols.push({ id: fileId(fp), filePath: fp });
  }

  const symbols: SymbolIndex = {
    files: fileSymbols,
    classes: classSymbols,
    methods: methodSymbols,
  };
  stableSortSymbols(symbols);

  const methodReferences: MethodReference[] = [];

  const getMethodIdFromSymbol = (sym: ts.Symbol | undefined): string | null => {
    if (!sym) return null;
    const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const decls = resolved.getDeclarations() ?? [];

    for (const decl of decls) {
      if (!ts.isMethodDeclaration(decl)) continue;
      const sf = decl.getSourceFile();
      const declFilePath = getWorkspaceRelPosixPath(workspaceRootAbs, sf.fileName);
      const key = `${declFilePath}:${decl.getStart(sf)}`;
      const mId = methodIdByDeclKey.get(key);
      if (mId) return mId;
    }
    return null;
  };

  // Build method references by scanning property accesses and using the checker to confirm symbol identity.
  for (const sourceFile of program.getSourceFiles()) {
    if (!fileSet.has(path.resolve(sourceFile.fileName))) continue;
    const filePath = getWorkspaceRelPosixPath(workspaceRootAbs, sourceFile.fileName);
    const text = sourceFile.text;

    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) {
        const nameNode = node.name;
        const sym = checker.getSymbolAtLocation(nameNode);
        const mId = getMethodIdFromSymbol(sym);
        if (mId) {
          const count = methodCountById.get(mId) ?? 0;
          if (count < config.maxReferencesPerMethod) {
            const pos = nameNode.getStart(sourceFile);
            const line = lineFromPos(sourceFile, pos);
            const column = columnFromPos(sourceFile, pos);
            methodReferences.push({
              methodId: mId,
              filePath,
              line,
              column,
              snippet: lineSnippet(text, line),
            });
            methodCountById.set(mId, count + 1);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  // Method-body duplicate groups (exact + normalized).
  const exactBuckets = new Map<string, { occurrences: DuplicateOccurrence[]; preview: string; tokenCount: number; lineCount: number }>();
  const normalizedBuckets = new Map<string, { occurrences: DuplicateOccurrence[]; preview: string; tokenCount: number; lineCount: number }>();

  for (const sourceFile of program.getSourceFiles()) {
    if (!fileSet.has(path.resolve(sourceFile.fileName))) continue;
    const filePath = getWorkspaceRelPosixPath(workspaceRootAbs, sourceFile.fileName);

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const cName = node.name.text;

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          if (!member.body) continue;
          if (!member.name || !ts.isIdentifier(member.name)) continue;

          const mStartLine = lineFromPos(sourceFile, member.getStart(sourceFile));
          const mId = methodId(filePath, cName, member.name.text, mStartLine);

          const body = member.body;
          const startPos = body.getStart(sourceFile);
          const endPos = Math.max(body.getEnd() - 1, startPos);
          const startLine = lineFromPos(sourceFile, startPos);
          const endLine = lineFromPos(sourceFile, endPos);
          const lineCount = Math.max(1, endLine - startLine + 1);
          if (lineCount < config.minBodyLines) continue;

          const bodyText = body.getText(sourceFile);
          const exactText = normalizeExactBlockText(bodyText);
          const { normalized, tokenCount } = scanNormalizedTokens(bodyText);
          if (tokenCount < config.minBodyTokens) continue;

          const occ: DuplicateOccurrence = {
            filePath,
            startLine,
            endLine,
            lineCount,
            tokenCount,
            methodId: mId,
          };

          const exactHash = fnv1a32Hex(exactText);
          const normalizedHash = fnv1a32Hex(normalized.join(" "));

          const exactBucket =
            exactBuckets.get(exactHash) ??
            { occurrences: [], preview: clampPreview(exactText, config), tokenCount, lineCount };
          if (!exactBuckets.has(exactHash)) exactBuckets.set(exactHash, exactBucket);
          exactBucket.occurrences.push(occ);

          const normalizedBucket =
            normalizedBuckets.get(normalizedHash) ??
            { occurrences: [], preview: clampPreview(exactText, config), tokenCount, lineCount };
          if (!normalizedBuckets.has(normalizedHash)) normalizedBuckets.set(normalizedHash, normalizedBucket);
          normalizedBucket.occurrences.push(occ);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  const exactGroups = buildGroupsFromBuckets("exact", exactBuckets);
  const normalizedGroups = buildGroupsFromBuckets("normalized", normalizedBuckets);

  return {
    symbols,
    methodReferences: methodReferences.sort((a, b) => `${a.methodId}\n${a.filePath}\n${a.line}\n${a.column}`.localeCompare(`${b.methodId}\n${b.filePath}\n${b.line}\n${b.column}`)),
    duplicateGroups: [...exactGroups, ...normalizedGroups],
  };
}
