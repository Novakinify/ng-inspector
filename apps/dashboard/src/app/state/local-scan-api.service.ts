import { Injectable, signal } from "@angular/core";

export type HealthResult =
  | { ok: true; time: string }
  | { ok: false; error: string };

export type AuditApiResult =
  | { ok: true; reportJsonText: string; reportPathAbs: string; htmlPathAbs: string }
  | { ok: false; error: string };

export interface SourceSpanLine {
  line: number;
  text: string;
}

export type SourceSpanResult =
  | {
      ok: true;
      filePath: string;
      spanText: string;
      startLine: number;
      endLine: number;
      highlightLine: number;
      highlightColumn: number;
      lines: SourceSpanLine[];
    }
  | { ok: false; error: string };

const STORAGE_KEY = "ngInspector.localApiBaseUrl.v1";

@Injectable({ providedIn: "root" })
export class LocalScanApiService {
  readonly baseUrl = signal<string>(loadBaseUrl());

  setBaseUrl(url: string): void {
    const normalized = normalizeBaseUrl(url);
    this.baseUrl.set(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
  }

  async health(): Promise<HealthResult> {
    const url = `${this.baseUrl()}/health`;
    try {
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const json = (await resp.json()) as unknown;
      const obj = asRecord(json);
      const time = typeof obj?.["time"] === "string" ? obj["time"] : new Date().toISOString();
      return { ok: true, time };
    } catch {
      return { ok: false, error: "Not reachable." };
    }
  }

  async audit(workspaceRoot: string): Promise<AuditApiResult> {
    const url = `${this.baseUrl()}/audit`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot })
      });

      const json = (await resp.json()) as unknown;
      const obj = asRecord(json);
      if (!resp.ok) {
        const msg = typeof obj?.["error"] === "string" ? obj["error"] : `HTTP ${resp.status}`;
        return { ok: false, error: msg };
      }

      const reportJsonText = typeof obj?.["reportJsonText"] === "string" ? obj["reportJsonText"] : "";
      const reportPathAbs = typeof obj?.["reportPathAbs"] === "string" ? obj["reportPathAbs"] : "";
      const htmlPathAbs = typeof obj?.["htmlPathAbs"] === "string" ? obj["htmlPathAbs"] : "";

      if (!reportJsonText) return { ok: false, error: "API did not return reportJsonText." };
      return { ok: true, reportJsonText, reportPathAbs, htmlPathAbs };
    } catch {
      return { ok: false, error: "Request failed." };
    }
  }

  async sourceSpan(
    workspaceRoot: string,
    filePath: string,
    line: number,
    column: number,
    contextLines: number
  ): Promise<SourceSpanResult> {
    const url = `${this.baseUrl()}/source`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot, filePath, line, column, contextLines })
      });

      const text = await resp.text();
      const obj = tryParseJsonObject(text);
      if (!resp.ok) {
        const msg = typeof obj?.["error"] === "string" ? obj["error"] : `HTTP ${resp.status}`;
        return { ok: false, error: msg };
      }

      const ok = obj?.["ok"] === true;
      if (!ok) {
        const msg = typeof obj?.["error"] === "string" ? obj["error"] : "API returned ok=false.";
        return { ok: false, error: msg };
      }

      const outFile = typeof obj?.["filePath"] === "string" ? obj["filePath"] : filePath;
      const spanText = typeof obj?.["spanText"] === "string" ? obj["spanText"] : "";
      const startLine = typeof obj?.["startLine"] === "number" ? obj["startLine"] : 0;
      const endLine = typeof obj?.["endLine"] === "number" ? obj["endLine"] : 0;
      const highlightLine = typeof obj?.["highlightLine"] === "number" ? obj["highlightLine"] : line;
      const highlightColumn = typeof obj?.["highlightColumn"] === "number" ? obj["highlightColumn"] : column;

      const linesRaw = obj?.["lines"];
      const lines: SourceSpanLine[] = [];
      if (Array.isArray(linesRaw)) {
        for (const it of linesRaw) {
          const rec = asRecord(it);
          const ln = typeof rec?.["line"] === "number" ? rec["line"] : null;
          const text = typeof rec?.["text"] === "string" ? rec["text"] : null;
          if (ln && text !== null) lines.push({ line: ln, text });
        }
      }

      if (!spanText && lines.length === 0) return { ok: false, error: "API did not return spanText/lines." };

      return {
        ok: true,
        filePath: outFile,
        spanText,
        startLine,
        endLine,
        highlightLine,
        highlightColumn,
        lines
      };
    } catch {
      return { ok: false, error: "Request failed." };
    }
  }
}

function loadBaseUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeBaseUrl(raw);
  } catch {
    // ignore
  }
  // Default works when running `npm run dashboard:local` (same origin).
  return "/api";
}

function normalizeBaseUrl(input: string): string {
  const s = input.trim();
  if (!s) return "/api";
  // Remove trailing slashes.
  return s.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const raw = text.trim();
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
