import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { compareSeverityDesc } from "../lib/findings-filter";
import type { AnalyzerFinding, FindingSeverity } from "../lib/report-schema";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { LocalScanApiService, type SourceSpanResult } from "../state/local-scan-api.service";
import { ReportStoreService } from "../state/report-store.service";

type Detection = "yes" | "no" | "unknown";

interface LifecycleSignals {
  hasNgOnDestroy: Detection;
  hasTakeUntilDestroyed: Detection;
  hasTakeUntil: Detection;
  hasUnsubscribe: Detection;
  hasCleanup: Detection;
}

@Component({
  selector: "ngi-lifecycle-page",
  standalone: true,
  imports: [EmptyStateComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./lifecycle.page.html",
  styleUrl: "./lifecycle.page.css"
})
export class LifecyclePageComponent {
  private readonly store = inject(ReportStoreService);
  private readonly api = inject(LocalScanApiService);
  readonly report = this.store.report;

  readonly severity = signal<FindingSeverity | "all">("all");
  readonly query = signal<string>("");

  readonly selectedKey = signal<string>("");
  readonly selected = signal<AnalyzerFinding | null>(null);

  readonly spanLoading = signal<boolean>(false);
  readonly spanError = signal<string>("");
  readonly span = signal<Extract<SourceSpanResult, { ok: true }> | null>(null);

  private loadToken = 0;

  readonly findings = computed<AnalyzerFinding[]>(() =>
    this.store.findings().filter((f) => f.category === "lifecycle"),
  );

  readonly counts = computed<Record<FindingSeverity, number>>(() => {
    const c: Record<FindingSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const f of this.findings()) c[f.severity] += 1;
    return c;
  });

  readonly visible = computed<AnalyzerFinding[]>(() => {
    const sev = this.severity();
    const q = this.query().trim().toLowerCase();

    const filtered = this.findings().filter((f) => {
      if (sev !== "all" && f.severity !== sev) return false;
      if (!q) return true;
      const hay = `${f.code}\n${f.message}\n${f.filePath}`.toLowerCase();
      return hay.includes(q);
    });

    return [...filtered].sort((a, b) => {
      const bySev = compareSeverityDesc(a.severity, b.severity);
      if (bySev !== 0) return bySev;
      const byCode = a.code.localeCompare(b.code);
      if (byCode !== 0) return byCode;
      const byFile = a.filePath.localeCompare(b.filePath);
      if (byFile !== 0) return byFile;
      return a.message.localeCompare(b.message);
    });
  });

  private readonly ngOnDestroyKeys = computed(() => {
    const set = new Set<string>();
    const r = this.report();
    if (!r) return set;
    for (const m of r.symbols.methods) {
      if (m.name !== "ngOnDestroy") continue;
      set.add(`${m.filePath}::${m.className}`);
    }
    return set;
  });

  onQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.query.set(value);
  }

  trackFinding(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);
    const line = metaNumber(meta, "line");
    const col = metaNumber(meta, "column");
    const loc = line ? `${line}:${col ?? 1}` : "";
    return `${f.filePath}::${f.code}::${loc}`;
  }

  locLabel(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);
    const line = metaNumber(meta, "line");
    const col = metaNumber(meta, "column");
    if (!line) return "";
    return `#L${line}:${col ?? 1}`;
  }

  classMethodLabel(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);
    const cls = metaString(meta, "className");
    const m = metaString(meta, "methodName");
    if (!cls && !m) return "";
    if (cls && m) return `${cls}.${m}()`;
    return cls || m || "";
  }

  selectFinding(f: AnalyzerFinding): void {
    const key = this.trackFinding(f);
    this.selectedKey.set(key);
    this.selected.set(f);
    void this.loadSourceSpan(f);
  }

  sourceKind(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);
    return metaString(meta, "rootKind") || "lifecycle";
  }

  sourceSummary(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);

    switch (f.code) {
      case "lifecycle-unmanaged-subscribe": {
        const rootKind = metaString(meta, "rootKind") || "observable";
        const rootText = metaString(meta, "rootText") || "--";
        const reason = metaString(meta, "reason") || "--";
        return `${rootKind}: ${rootText}\nreason: ${reason}`;
      }
      case "lifecycle-fromEvent-subscribe-no-cleanup": {
        const eventName = metaString(meta, "eventName") || "event";
        const target = metaString(meta, "targetText") || "target";
        return `fromEvent(${target}, '${eventName}').subscribe(...)`;
      }
      case "lifecycle-broken-destroy-subject": {
        const subj = metaString(meta, "subjectProperty") || "destroy$";
        return `takeUntil(this.${subj})`;
      }
      case "lifecycle-subscription-field-not-unsubscribed": {
        const fieldName = metaString(meta, "fieldName") || "subscription";
        const inMethod = metaString(meta, "assignedInMethod") || "--";
        return `this.${fieldName} = <Subscription>\nassigned in: ${inMethod}`;
      }
      case "lifecycle-addEventListener-no-remove": {
        const target = metaString(meta, "targetText") || "target";
        const eventName = metaString(meta, "eventName") || "event";
        const handler = metaString(meta, "handlerText") || "handler";
        const once = metaBoolean(meta, "hasOnceOption") === true ? ", { once: true }" : "";
        return `${target}.addEventListener('${eventName}', ${handler}${once})`;
      }
      case "lifecycle-setInterval-no-clearInterval": {
        const prop = metaString(meta, "intervalIdProperty") || "intervalId";
        return `this.${prop} = setInterval(...)`;
      }
      case "lifecycle-requestAnimationFrame-no-cancelAnimationFrame": {
        const prop = metaString(meta, "requestIdProperty") || "rafId";
        return `this.${prop} = requestAnimationFrame(...)`;
      }
      case "lifecycle-effect-missing-onCleanup": {
        const resources = metaStringArray(meta, "resources")?.join(", ") || "--";
        return `effect(() => { /* uses: ${resources} */ })`;
      }
      case "lifecycle-toSignal-manualCleanup":
        return "toSignal(source$, { manualCleanup: true })";
      default:
        return "--";
    }
  }

  signalsFor(f: AnalyzerFinding): LifecycleSignals {
    const meta = asRecord(f.metadata);
    const hasNgOnDestroy = this.detectNgOnDestroy(f, meta);

    switch (f.code) {
      case "lifecycle-broken-destroy-subject":
        return {
          hasNgOnDestroy: asDetection(metaBoolean(meta, "hasNgOnDestroy") ?? (hasNgOnDestroy === "yes")),
          hasTakeUntilDestroyed: "unknown",
          hasTakeUntil: "yes",
          hasUnsubscribe: "unknown",
          hasCleanup: asDetection(metaBoolean(meta, "callsNext") === true),
        };
      case "lifecycle-unmanaged-subscribe":
      case "lifecycle-fromEvent-subscribe-no-cleanup":
        return {
          hasNgOnDestroy,
          hasTakeUntilDestroyed: "no",
          hasTakeUntil: "no",
          hasUnsubscribe: "no",
          hasCleanup: "no",
        };
      case "lifecycle-subscription-field-not-unsubscribed":
        return {
          hasNgOnDestroy,
          hasTakeUntilDestroyed: "unknown",
          hasTakeUntil: "unknown",
          hasUnsubscribe: "no",
          hasCleanup: "no",
        };
      case "lifecycle-addEventListener-no-remove":
      case "lifecycle-setInterval-no-clearInterval":
      case "lifecycle-requestAnimationFrame-no-cancelAnimationFrame":
      case "lifecycle-effect-missing-onCleanup":
      case "lifecycle-toSignal-manualCleanup":
        return {
          hasNgOnDestroy,
          hasTakeUntilDestroyed: "unknown",
          hasTakeUntil: "unknown",
          hasUnsubscribe: "unknown",
          hasCleanup: "no",
        };
      default:
        return {
          hasNgOnDestroy,
          hasTakeUntilDestroyed: "unknown",
          hasTakeUntil: "unknown",
          hasUnsubscribe: "unknown",
          hasCleanup: "unknown",
        };
    }
  }

  signalNotes(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);
    switch (f.code) {
      case "lifecycle-broken-destroy-subject": {
        const subj = metaString(meta, "subjectProperty") || "destroy$";
        const callsNext = metaBoolean(meta, "callsNext");
        const callsComplete = metaBoolean(meta, "callsComplete");
        const hasOnDestroy = metaBoolean(meta, "hasNgOnDestroy");
        return `Detected takeUntil(this.${subj}). ngOnDestroy: ${fmtBool(hasOnDestroy)}. ${subj}.next(): ${fmtBool(
          callsNext,
        )}. ${subj}.complete(): ${fmtBool(callsComplete)}.`;
      }
      case "lifecycle-effect-missing-onCleanup": {
        const resources = metaStringArray(meta, "resources")?.join(", ") || "--";
        const hasParam = metaBoolean(meta, "hasOnCleanupParam");
        return `effect() creates long-running work (${resources}). onCleanup param: ${fmtBool(hasParam)}.`;
      }
      case "lifecycle-toSignal-manualCleanup":
        return "Detected toSignal(..., { manualCleanup: true }), which disables DestroyRef-based cleanup.";
      default:
        return "";
    }
  }

  fixPattern(f: AnalyzerFinding): string {
    const meta = asRecord(f.metadata);

    switch (f.code) {
      case "lifecycle-fromEvent-subscribe-no-cleanup":
      case "lifecycle-unmanaged-subscribe":
        return [
          "// Preferred (Angular rxjs-interop):",
          "source$",
          "  .pipe(takeUntilDestroyed(this.destroyRef))",
          "  .subscribe((value) => {",
          "    // ...",
          "  });",
          "",
          "// Alternative (manual destroy$ pattern):",
          "private readonly destroy$ = new Subject<void>();",
          "",
          "ngOnDestroy() {",
          "  this.destroy$.next();",
          "  this.destroy$.complete();",
          "}",
          "",
          "source$",
          "  .pipe(takeUntil(this.destroy$))",
          "  .subscribe(...);",
        ].join("\n");
      case "lifecycle-broken-destroy-subject": {
        const subj = metaString(meta, "subjectProperty") || "destroy$";
        return [
          `private readonly ${subj} = new Subject<void>();`,
          "",
          "ngOnDestroy() {",
          `  this.${subj}.next();`,
          `  this.${subj}.complete();`,
          "}",
          "",
          `source$.pipe(takeUntil(this.${subj})).subscribe(...);`,
          "",
          "// Or replace with takeUntilDestroyed(this.destroyRef).",
        ].join("\n");
      }
      case "lifecycle-subscription-field-not-unsubscribed": {
        const field = metaString(meta, "fieldName") || "sub";
        return [
          `private ${field}: Subscription | null = null;`,
          "",
          `this.${field} = source$.subscribe(...);`,
          "",
          "ngOnDestroy() {",
          `  this.${field}?.unsubscribe();`,
          `  this.${field} = null;`,
          "}",
          "",
          "// Or avoid storing subscriptions by using takeUntilDestroyed().",
        ].join("\n");
      }
      case "lifecycle-addEventListener-no-remove":
        return [
          "private readonly handler = (ev: Event) => {",
          "  // ...",
          "};",
          "",
          "ngOnInit() {",
          "  target.addEventListener('event', this.handler);",
          "}",
          "",
          "ngOnDestroy() {",
          "  target.removeEventListener('event', this.handler);",
          "}",
          "",
          "// If appropriate, prefer `{ once: true }` for one-shot listeners.",
        ].join("\n");
      case "lifecycle-setInterval-no-clearInterval": {
        const prop = metaString(meta, "intervalIdProperty") || "intervalId";
        return [
          `private ${prop}: number | null = null;`,
          "",
          `this.${prop} = window.setInterval(() => {`,
          "  // ...",
          "}, 1000);",
          "",
          "ngOnDestroy() {",
          `  if (this.${prop} !== null) window.clearInterval(this.${prop});`,
          `  this.${prop} = null;`,
          "}",
        ].join("\n");
      }
      case "lifecycle-requestAnimationFrame-no-cancelAnimationFrame": {
        const prop = metaString(meta, "requestIdProperty") || "rafId";
        return [
          `private ${prop}: number | null = null;`,
          "",
          `this.${prop} = window.requestAnimationFrame(() => {`,
          "  // ...",
          "});",
          "",
          "ngOnDestroy() {",
          `  if (this.${prop} !== null) window.cancelAnimationFrame(this.${prop});`,
          `  this.${prop} = null;`,
          "}",
        ].join("\n");
      }
      case "lifecycle-effect-missing-onCleanup":
        return [
          "effect((onCleanup) => {",
          "  const id = window.setInterval(() => {",
          "    // ...",
          "  }, 1000);",
          "",
          "  onCleanup(() => window.clearInterval(id));",
          "});",
        ].join("\n");
      case "lifecycle-toSignal-manualCleanup":
        return [
          "// Prefer automatic cleanup (DestroyRef-based):",
          "const value = toSignal(source$, { injector: this.injector });",
          "",
          "// Or ensure the observable completes / is scoped:",
          "const value2 = toSignal(",
          "  source$.pipe(takeUntilDestroyed(this.destroyRef))",
          ");",
        ].join("\n");
      default:
        return (f.suggestedActions ?? []).join("\n") || "--";
    }
  }

  signalsLabel(s: LifecycleSignals): string {
    const yes = [s.hasNgOnDestroy, s.hasTakeUntilDestroyed, s.hasTakeUntil, s.hasUnsubscribe, s.hasCleanup].filter(
      (v) => v === "yes",
    ).length;
    const no = [s.hasNgOnDestroy, s.hasTakeUntilDestroyed, s.hasTakeUntil, s.hasUnsubscribe, s.hasCleanup].filter(
      (v) => v === "no",
    ).length;
    return `${yes} yes / ${no} no`;
  }

  caretPadPx(column: number): number {
    const col = Number.isFinite(column) && column > 1 ? column : 1;
    return 56 + 10 + (col - 1) * 7;
  }

  private detectNgOnDestroy(f: AnalyzerFinding, meta: Record<string, unknown> | null): Detection {
    const has = metaBoolean(meta, "hasNgOnDestroy");
    if (typeof has === "boolean") return has ? "yes" : "no";

    const cls = metaString(meta, "className");
    if (!cls) return "unknown";
    const key = `${f.filePath}::${cls}`;
    return this.ngOnDestroyKeys().has(key) ? "yes" : "no";
  }

  private async loadSourceSpan(f: AnalyzerFinding): Promise<void> {
    const r = this.report();
    if (!r) return;

    const meta = asRecord(f.metadata);
    const line = metaNumber(meta, "line");
    const column = metaNumber(meta, "column") ?? 1;
    if (!line) {
      this.span.set(null);
      this.spanError.set("This finding did not include a source location (line/column).");
      return;
    }

    const token = ++this.loadToken;
    this.spanLoading.set(true);
    this.spanError.set("");
    this.span.set(null);

    const result = await this.api.sourceSpan(r.workspaceRoot, f.filePath, line, column, 6);
    if (token !== this.loadToken) return;

    this.spanLoading.set(false);
    if (!result.ok) {
      this.spanError.set(result.error);
      return;
    }

    this.span.set(result);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function metaString(meta: Record<string, unknown> | null, key: string): string {
  const v = meta?.[key];
  return typeof v === "string" ? v : "";
}

function metaNumber(meta: Record<string, unknown> | null, key: string): number | null {
  const v = meta?.[key];
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

function metaBoolean(meta: Record<string, unknown> | null, key: string): boolean | null {
  const v = meta?.[key];
  return typeof v === "boolean" ? v : null;
}

function metaStringArray(meta: Record<string, unknown> | null, key: string): string[] | null {
  const v = meta?.[key];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

function asDetection(value: boolean | null | undefined): Detection {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function fmtBool(value: boolean | null): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}
