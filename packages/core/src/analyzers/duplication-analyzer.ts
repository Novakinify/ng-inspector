import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { DuplicateGroup, DuplicateOccurrence } from "../types";

export interface DuplicationAnalyzerConfig {
  /**
   * Minimum block size (in lines) before we consider it for duplication.
   * Keeps results conservative and avoids small boilerplate matches.
   */
  minBlockLines: number;

  /**
   * Minimum token count before we consider a block.
   * Helps suppress noise when identifier/literal normalization is enabled.
   */
  minBlockTokens: number;
}

export const DEFAULT_DUPLICATION_ANALYZER_CONFIG: DuplicationAnalyzerConfig = {
  minBlockLines: 10,
  minBlockTokens: 80,
};

export interface DuplicationAnalyzerOptions {
  workspaceRootAbs: string;
  filePaths: string[]; // workspace-relative posix paths
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
  config?: Partial<DuplicationAnalyzerConfig>;
}

function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV-1a prime multiply.
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned and hex.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizePosixPath(p: string): string {
  let out = p.trim().replace(/\\/g, "/");
  if (out.startsWith("./")) out = out.slice(2);
  if (out.startsWith("/")) out = out.slice(1);
  return out;
}

function normalizeExactBlockText(blockText: string): string {
  const lines = blockText.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/g, ""));

  // Trim leading/trailing blank lines.
  while (lines.length && lines[0]?.trim().length === 0) lines.shift();
  while (lines.length && lines[lines.length - 1]?.trim().length === 0) lines.pop();

  // Strip common indentation (keeps matches stable across nesting changes).
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

function isIdentifierLike(kind: ts.SyntaxKind): boolean {
  // TypeScript's scanner returns keyword tokens for some words that are still legal as identifiers
  // in many value positions (e.g. `const out = ...`, `const type = ...`). If we don't normalize
  // these, normalized-duplication detection gets brittle (false negatives).
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
    const tokenText = scanner.getTokenText();
    normalized.push(normalizeToken(token, tokenText));
  }

  return { normalized, tokenCount: normalized.length };
}

function getBlockNode(node: ts.Node): ts.Block | null {
  if (ts.isMethodDeclaration(node) && node.body) return node.body;
  if (ts.isFunctionDeclaration(node) && node.body) return node.body;
  if (ts.isFunctionExpression(node) && node.body) return node.body;
  if (ts.isConstructorDeclaration(node) && node.body) return node.body;
  if (ts.isGetAccessorDeclaration(node) && node.body) return node.body;
  if (ts.isSetAccessorDeclaration(node) && node.body) return node.body;
  if (ts.isArrowFunction(node) && ts.isBlock(node.body)) return node.body;
  return null;
}

function lineFromPos(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function stableSortOccurrences(occurrences: DuplicateOccurrence[]): void {
  occurrences.sort((a, b) => `${a.filePath}\n${a.startLine}`.localeCompare(`${b.filePath}\n${b.startLine}`));
}

function groupsFromMap(kind: DuplicateGroup["kind"], map: Map<string, DuplicateOccurrence[]>): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];

  for (const [hash, occ] of map.entries()) {
    if (occ.length < 2) continue;
    const distinctFiles = new Set(occ.map((o) => o.filePath)).size;
    if (distinctFiles < 2) continue;

    stableSortOccurrences(occ);

    const first = occ[0];
    if (!first) continue;

    out.push({
      id: `dup:${kind}:${hash}`,
      kind,
      hash,
      tokenCount: first.tokenCount,
      lineCount: first.lineCount,
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

export async function analyzeDuplicates(options: DuplicationAnalyzerOptions): Promise<DuplicateGroup[]> {
  const config: DuplicationAnalyzerConfig = { ...DEFAULT_DUPLICATION_ANALYZER_CONFIG, ...(options.config ?? {}) };

  const exactMap = new Map<string, DuplicateOccurrence[]>();
  const normalizedMap = new Map<string, DuplicateOccurrence[]>();

  for (const filePathRaw of options.filePaths) {
    const filePath = normalizePosixPath(filePathRaw);
    if (options.isExcludedPath?.(filePath)) continue;

    const abs = path.resolve(options.workspaceRootAbs, filePath);
    let tsText: string;
    try {
      tsText = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }

    const sourceFile = ts.createSourceFile(abs, tsText, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node) => {
      const block = getBlockNode(node);
      if (block) {
        const startPos = block.getStart(sourceFile);
        const endPos = Math.max(block.getEnd() - 1, startPos);
        const startLine = lineFromPos(sourceFile, startPos);
        const endLine = lineFromPos(sourceFile, endPos);
        const lineCount = Math.max(1, endLine - startLine + 1);

        if (lineCount >= config.minBlockLines) {
          const blockText = block.getText(sourceFile);
          const exactText = normalizeExactBlockText(blockText);

          const { normalized, tokenCount } = scanNormalizedTokens(blockText);
          if (tokenCount >= config.minBlockTokens) {
            const occurrence: DuplicateOccurrence = {
              filePath,
              startLine,
              endLine,
              lineCount,
              tokenCount,
            };

            const exactHash = fnv1a32Hex(exactText);
            const normalizedHash = fnv1a32Hex(normalized.join(" "));

            const exactBucket = exactMap.get(exactHash) ?? [];
            if (!exactMap.has(exactHash)) exactMap.set(exactHash, exactBucket);
            exactBucket.push(occurrence);

            const normalizedBucket = normalizedMap.get(normalizedHash) ?? [];
            if (!normalizedMap.has(normalizedHash)) normalizedMap.set(normalizedHash, normalizedBucket);
            normalizedBucket.push(occurrence);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  const exactGroups = groupsFromMap("exact", exactMap);
  const normalizedGroups = groupsFromMap("normalized", normalizedMap);

  // Keep output stable and predictable for consumers.
  return [...exactGroups, ...normalizedGroups];
}
