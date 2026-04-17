import { Injectable, computed, signal } from "@angular/core";
import type { AuditReport, FindingSeverity } from "../lib/report-schema";

export interface ReportCountsBySeverity {
  error: number;
  warning: number;
  info: number;
}

@Injectable({ providedIn: "root" })
export class ReportStoreService {
  private readonly _report = signal<AuditReport | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  readonly report = this._report.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly hasReport = computed(() => this.report() !== null);

  readonly findings = computed(() => this.report()?.findings ?? []);
  readonly hotspots = computed(() => this.report()?.hotspotScores ?? []);
  readonly duplicates = computed(() => this.report()?.duplicateGroups ?? []);

  readonly findingCategories = computed(() => {
    const categories = new Set<string>();
    for (const f of this.findings()) categories.add(f.category);
    return Array.from(categories).sort();
  });

  readonly countsBySeverity = computed<ReportCountsBySeverity>(() => {
    const counts: ReportCountsBySeverity = { error: 0, warning: 0, info: 0 };
    for (const f of this.findings()) counts[f.severity] += 1;
    return counts;
  });

  setLoading(loading: boolean): void {
    this._loading.set(loading);
  }

  setError(message: string | null): void {
    this._error.set(message);
  }

  setReport(report: AuditReport): void {
    this._report.set(report);
    this._error.set(null);
  }

  clearReport(): void {
    this._report.set(null);
    this._error.set(null);
  }

  getTotalFindings(severity: FindingSeverity | "all"): number {
    if (severity === "all") return this.findings().length;
    return this.findings().filter((f) => f.severity === severity).length;
  }
}

