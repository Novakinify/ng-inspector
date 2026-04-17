import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { ReportStoreService } from "../state/report-store.service";
import type { DuplicateGroup, MethodSymbol } from "../lib/report-schema";

type DuplicateKindFilter = "all" | "exact" | "normalized";

@Component({
  selector: "ngi-duplicates-page",
  standalone: true,
  imports: [EmptyStateComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as r) {
      <section class="page">
        <header class="page__header">
          <h1 class="page__title">Duplicates</h1>
          <p class="page__subtitle">
            Conservative duplicate method bodies (exact + normalized) extracted from TypeScript source.
            Start here, then manually confirm before refactoring.
          </p>
        </header>

        <div class="controls">
          <div class="controls__group">
            <label class="label" for="kind">Kind</label>
            <select
              id="kind"
              class="select"
              [value]="kind()"
              (change)="onKindChange($event)"
            >
              <option value="all">All</option>
              <option value="exact">Exact</option>
              <option value="normalized">Normalized</option>
            </select>
          </div>
          <div class="controls__group">
            <label class="label" for="min">Min lines</label>
            <input
              id="min"
              class="input"
              type="number"
              min="1"
              [value]="minLines()"
              (input)="onMinLinesInput($event)"
            />
          </div>
        </div>

        <div class="meta">
          Showing <span class="mono">{{ visible().length }}</span> of
          <span class="mono">{{ r.duplicateGroups.length }}</span>.
        </div>

        <div class="list">
          @for (g of visible(); track g.id) {
            <article class="item">
              <header class="item__head">
                <div class="item__title">
                  <span class="badge" [class]="'badge--' + g.kind">{{ g.kind }}</span>
                  <span class="mono dim">{{ g.id }}</span>
                </div>
                <div class="item__stats mono">
                  {{ g.lineCount }} lines
                  <span class="dot"></span>
                  {{ g.tokenCount }} tokens
                  <span class="dot"></span>
                  {{ g.occurrences.length }} occurrences
                </div>
              </header>

              @if (g.preview) {
                <pre class="pre">{{ g.preview }}</pre>
              }

              <details class="details">
                <summary>Occurrences</summary>
                <div class="occ">
                  <div class="thead">
                    <div>Method</div>
                    <div>File</div>
                    <div class="num">Start</div>
                    <div class="num">End</div>
                    <div class="num">Lines</div>
                    <div class="num">Tokens</div>
                  </div>
                  @for (o of g.occurrences; track o.filePath + ':' + o.startLine) {
                    <div class="tr">
                      <div class="mono method">
                        @if (o.methodId) {
                          <a
                            class="method__link"
                            [routerLink]="['/project-tree']"
                            [queryParams]="{ method: o.methodId }"
                            [title]="o.methodId"
                          >
                            {{ methodLabel(o.methodId) }}
                          </a>
                        } @else {
                          <span class="dim">--</span>
                        }
                      </div>
                      <div class="mono file" [title]="o.filePath">{{ o.filePath }}</div>
                      <div class="mono num">{{ o.startLine }}</div>
                      <div class="mono num">{{ o.endLine }}</div>
                      <div class="mono num">{{ o.lineCount }}</div>
                      <div class="mono num">{{ o.tokenCount }}</div>
                    </div>
                  }
                </div>
              </details>
            </article>
          }
        </div>
      </section>
    } @else {
      <ngi-empty-state />
    }
  `,
  styles: [
    `
      .page__header {
        margin-bottom: 16px;
      }
      .page__title {
        margin: 0;
        font-size: 28px;
        letter-spacing: -0.03em;
      }
      .page__subtitle {
        margin: 8px 0 0 0;
        color: var(--muted);
        line-height: 1.5;
      }

      .controls {
        display: grid;
        grid-template-columns: 220px 180px;
        gap: 10px;
        align-items: end;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 70%, transparent);
        box-shadow: var(--shadow);
      }
      @media (max-width: 680px) {
        .controls {
          grid-template-columns: 1fr;
        }
      }
      .controls__group {
        min-width: 0;
      }
      .label {
        display: block;
        font-size: 12px;
        color: var(--muted);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 0 0 6px 2px;
      }
      .input,
      .select {
        width: 100%;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
        background: color-mix(in srgb, var(--surface) 92%, transparent);
        color: var(--text);
        padding: 10px 12px;
        outline: none;
      }

      .meta {
        margin: 12px 2px;
        color: var(--muted);
        font-size: 13px;
      }
      .mono {
        font-family: var(--font-mono);
      }
      .dim {
        color: color-mix(in srgb, var(--muted) 90%, transparent);
      }
      .dot {
        display: inline-block;
        width: 4px;
        height: 4px;
        border-radius: 99px;
        background: color-mix(in srgb, var(--muted) 70%, transparent);
        vertical-align: middle;
        margin: 0 10px;
      }

      .list {
        display: grid;
        gap: 10px;
      }
      .item {
        padding: 14px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
        box-shadow: var(--shadow);
      }
      .item__head {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        align-items: center;
      }
      @media (max-width: 780px) {
        .item__head {
          grid-template-columns: 1fr;
        }
      }
      .item__title {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .item__stats {
        color: var(--muted);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 6px 10px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 92%, transparent);
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .badge--exact {
        color: var(--sev-warning);
        border-color: color-mix(in srgb, var(--sev-warning) 55%, var(--border));
        background: color-mix(in srgb, var(--sev-warning) 10%, var(--surface));
      }
      .badge--normalized {
        color: var(--sev-info);
        border-color: color-mix(in srgb, var(--sev-info) 55%, var(--border));
        background: color-mix(in srgb, var(--sev-info) 10%, var(--surface));
      }

      .pre {
        margin: 12px 0 0 0;
        padding: 10px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--bg0) 55%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        overflow: auto;
        font-family: var(--font-mono);
        font-size: 12px;
        color: color-mix(in srgb, var(--text) 90%, transparent);
        white-space: pre-wrap;
      }

      .details {
        margin-top: 10px;
      }
      .details summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 13px;
        user-select: none;
      }
      .occ {
        margin-top: 10px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--bg0) 25%, transparent);
      }
      .thead,
      .tr {
        display: grid;
        grid-template-columns: 0.9fr 1fr 70px 70px 70px 70px;
        gap: 10px;
        padding: 10px 12px;
        align-items: center;
      }
      .thead {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
      }
      .tr {
        border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
      }
      .tr:last-child {
        border-bottom: none;
      }
      .file {
        word-break: break-word;
      }
      .method {
        word-break: break-word;
      }
      .method__link {
        color: color-mix(in srgb, var(--text) 92%, transparent);
        text-decoration: none;
      }
      .method__link:hover {
        text-decoration: underline;
        color: var(--accent);
      }
      .num {
        text-align: right;
      }
      @media (max-width: 980px) {
        .thead {
          display: none;
        }
        .tr {
          grid-template-columns: 1fr;
          align-items: start;
        }
        .num {
          text-align: left;
        }
      }
    `
  ]
})
export class DuplicatesPageComponent {
  private readonly store = inject(ReportStoreService);
  readonly report = this.store.report;

  readonly kind = signal<DuplicateKindFilter>("all");
  readonly minLines = signal<number>(10);

  private readonly methodById = computed<Map<string, MethodSymbol>>(() => {
    const map = new Map<string, MethodSymbol>();
    const r = this.report();
    if (!r) return map;
    for (const m of r.symbols.methods) map.set(m.id, m);
    return map;
  });

  readonly visible = computed<DuplicateGroup[]>(() => {
    const kind = this.kind();
    const min = this.minLines();

    const filtered = this.store.duplicates().filter((g) => {
      if (kind !== "all" && g.kind !== kind) return false;
      if (g.lineCount < min) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      const byLines = b.lineCount - a.lineCount;
      if (byLines !== 0) return byLines;
      return b.occurrences.length - a.occurrences.length;
    });
  });

  methodLabel(methodId: string): string {
    const m = this.methodById().get(methodId) ?? null;
    if (!m) return methodId;
    return `${m.className}.${m.name}`;
  }

  onKindChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? "all";
    if (value === "all" || value === "exact" || value === "normalized") {
      this.kind.set(value);
      return;
    }
    this.kind.set("all");
  }

  onMinLinesInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.minLines.set(toInt(value, 10));
  }
}

function toInt(value: string, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}
