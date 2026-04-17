import { Injectable, computed, signal } from "@angular/core";
import type { AuditReport } from "../lib/report-schema";
import { createScanSnapshot, type ScanSnapshot, type ScanSource } from "../lib/scan-snapshot";

interface PersistedStateV1 {
  version: 1;
  scans: ScanSnapshot[];
}

const STORAGE_KEY = "ngInspector.scanHistory.v1";
const MAX_SCANS = 20;

@Injectable({ providedIn: "root" })
export class ScanHistoryService {
  private readonly _scans = signal<ScanSnapshot[]>(loadScans());

  readonly scans = this._scans.asReadonly();
  readonly latest = computed<ScanSnapshot | null>(() => this.scans()[0] ?? null);

  addReport(report: AuditReport, source: ScanSource): ScanSnapshot {
    const snap = createScanSnapshot(report, source);
    const next = [snap, ...this.scans()].slice(0, MAX_SCANS);
    this._scans.set(next);
    persistScans(next);
    return snap;
  }

  remove(id: string): void {
    const next = this.scans().filter((s) => s.id !== id);
    this._scans.set(next);
    persistScans(next);
  }

  clear(): void {
    this._scans.set([]);
    persistScans([]);
  }
}

function loadScans(): ScanSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const obj = parsed as Partial<PersistedStateV1>;
    if (obj.version !== 1) return [];
    if (!Array.isArray(obj.scans)) return [];
    return obj.scans.filter(isValidSnapshot);
  } catch {
    return [];
  }
}

function persistScans(scans: ScanSnapshot[]): void {
  try {
    const state: PersistedStateV1 = { version: 1, scans };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota/serialization errors; history is best-effort.
  }
}

function isValidSnapshot(value: unknown): value is ScanSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as ScanSnapshot;
  return typeof v.id === "string" && typeof v.workspaceRoot === "string" && typeof v.generatedAt === "string";
}

