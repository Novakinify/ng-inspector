/**
 * Minimal extraction of module specifiers from TypeScript/JavaScript source.
 *
 * Goal: be conservative and avoid false positives.
 * - Skips comments and string/template literals while scanning.
 * - Extracts specifiers from:
 *   - `import ... from "x"` / `export ... from "x"`
 *   - `import "x"` (side-effect import)
 *   - `import("x")` (dynamic import)
 *
 * Non-goals (for now):
 * - Full AST parsing
 * - Handling `require("x")` or unusual TS syntax forms
 */

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$";
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function skipLineComment(text: string, i: number): number {
  while (i < text.length && text[i] !== "\n") i += 1;
  return i;
}

function skipBlockComment(text: string, i: number): number {
  const end = text.indexOf("*/", i + 2);
  return end >= 0 ? end + 2 : text.length;
}

function skipQuotedString(text: string, i: number, quote: "'" | '"'): number {
  // i points at the opening quote.
  i += 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplateLiteral(text: string, i: number): number {
  // i points at the opening backtick.
  i += 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && text[i + 1] === "{") {
      i = skipTemplateExpression(text, i + 2);
      continue;
    }
    i += 1;
  }
  return i;
}

function skipTemplateExpression(text: string, i: number): number {
  // i is the first char after `${`
  let depth = 1;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "/") {
      i = skipLineComment(text, i + 2);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = skipQuotedString(text, i, ch);
      continue;
    }
    if (ch === "`") {
      i = skipTemplateLiteral(text, i);
      continue;
    }

    if (ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      i += 1;
      continue;
    }

    i += 1;
  }
  return i;
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    return i;
  }
  return i;
}

function skipWhitespaceAndComments(text: string, i: number): number {
  for (;;) {
    const before = i;
    i = skipWhitespace(text, i);
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      i = skipLineComment(text, i + 2);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    if (i === before) return i;
  }
}

function readIdentifier(text: string, i: number): { ident: string; next: number } {
  const start = i;
  i += 1;
  while (i < text.length && isIdentChar(text[i] ?? "")) i += 1;
  return { ident: text.slice(start, i), next: i };
}

function readStringLiteral(text: string, i: number): { value: string; next: number } | null {
  const quote = text[i];
  if (quote !== "'" && quote !== '"') return null;
  i += 1;
  let value = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      // Minimal escape handling: include the escaped char if present.
      const escaped = text[i + 1];
      if (escaped) value += escaped;
      i += 2;
      continue;
    }
    if (ch === quote) return { value, next: i + 1 };
    value += ch;
    i += 1;
  }
  return null;
}

function parseDynamicImport(text: string, i: number): { specifier: string; next: number } | null {
  i = skipWhitespaceAndComments(text, i);
  if (text[i] !== "(") return null;
  i += 1;
  i = skipWhitespaceAndComments(text, i);
  const lit = readStringLiteral(text, i);
  if (!lit) return null;
  return { specifier: lit.value, next: lit.next };
}

function scanForFromSpecifier(text: string, i: number): { specifier: string; next: number } | null {
  const max = Math.min(text.length, i + 50_000);

  while (i < max) {
    i = skipWhitespaceAndComments(text, i);
    const ch = text[i];
    const next = text[i + 1];
    if (!ch) break;

    if (ch === "'" || ch === '"') {
      i = skipQuotedString(text, i, ch);
      continue;
    }
    if (ch === "`") {
      i = skipTemplateLiteral(text, i);
      continue;
    }

    if (ch === "/" && next === "/") {
      i = skipLineComment(text, i + 2);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(text, i);
      continue;
    }

    if (ch === ";") return null;

    if (isIdentStart(ch)) {
      const ident = readIdentifier(text, i);
      i = ident.next;
      if (ident.ident === "from") {
        i = skipWhitespaceAndComments(text, i);
        const lit = readStringLiteral(text, i);
        if (!lit) return null;
        return { specifier: lit.value, next: lit.next };
      }
      continue;
    }

    i += 1;
  }

  return null;
}

export function extractModuleSpecifiers(tsText: string): string[] {
  const specifiers: string[] = [];

  let i = 0;
  while (i < tsText.length) {
    const ch = tsText[i];
    const next = tsText[i + 1];

    if (ch === "/" && next === "/") {
      i = skipLineComment(tsText, i + 2);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(tsText, i);
      continue;
    }

    if (ch === "'" || ch === '"') {
      i = skipQuotedString(tsText, i, ch);
      continue;
    }
    if (ch === "`") {
      i = skipTemplateLiteral(tsText, i);
      continue;
    }

    if (isIdentStart(ch)) {
      const ident = readIdentifier(tsText, i);
      i = ident.next;

      if (ident.ident === "import") {
        const after = skipWhitespaceAndComments(tsText, i);

        const dyn = parseDynamicImport(tsText, after);
        if (dyn) {
          specifiers.push(dyn.specifier);
          i = dyn.next;
          continue;
        }

        const sideEffect = readStringLiteral(tsText, after);
        if (sideEffect) {
          specifiers.push(sideEffect.value);
          i = sideEffect.next;
          continue;
        }

        const fromSpec = scanForFromSpecifier(tsText, after);
        if (fromSpec) {
          specifiers.push(fromSpec.specifier);
          i = fromSpec.next;
          continue;
        }
        continue;
      }

      if (ident.ident === "export") {
        const after = skipWhitespaceAndComments(tsText, i);
        const fromSpec = scanForFromSpecifier(tsText, after);
        if (fromSpec) {
          specifiers.push(fromSpec.specifier);
          i = fromSpec.next;
          continue;
        }
        continue;
      }

      continue;
    }

    i += 1;
  }

  return specifiers;
}

