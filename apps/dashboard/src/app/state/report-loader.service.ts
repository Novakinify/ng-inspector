import { Injectable } from "@angular/core";
import type { AuditReport } from "../lib/report-schema";
import { parseAuditReportJson } from "../lib/report-parse";

export type LoadReportResult =
  | { ok: true; report: AuditReport }
  | { ok: false; error: string };

@Injectable({ providedIn: "root" })
export class ReportLoaderService {
  async loadFromFile(file: File): Promise<LoadReportResult> {
    if (!file) return { ok: false, error: "No file provided." };
    const text = await file.text();
    return parseAuditReportJson(text);
  }

  async loadMock(): Promise<LoadReportResult> {
    try {
      const resp = await fetch("/assets/mock-report.json", { cache: "no-store" });
      if (!resp.ok) return { ok: false, error: `Failed to load mock report (HTTP ${resp.status}).` };
      const text = await resp.text();
      return parseAuditReportJson(text);
    } catch {
      return { ok: false, error: "Failed to load mock report." };
    }
  }
}

