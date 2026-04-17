import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { JsonPipe } from "@angular/common";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { ReportStoreService } from "../state/report-store.service";
import type { HotspotScore } from "../lib/report-schema";

type HotspotLimit = "25" | "50" | "100" | "all";

@Component({
  selector: "ngi-hotspots-page",
  standalone: true,
  imports: [EmptyStateComponent, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as r) {
      <section class="page">
        <header class="page__header">
          <h1 class="page__title">Hotspots</h1>
          <p class="page__subtitle">
            A simple, deterministic score per file based on multiple conservative signals (complexity,
            duplication, missing spec, import fan-in/out).
          </p>
        </header>

        <div class="controls">
          <div class="controls__group">
            <label class="label" for="q">Search path</label>
            <input
              id="q"
              class="input"
              type="text"
              placeholder="src/app/..."
              [value]="query()"
              (input)="onQueryInput($event)"
            />
          </div>
          <div class="controls__group">
            <label class="label" for="limit">Limit</label>
            <select
              id="limit"
              class="select"
              [value]="limit()"
              (change)="onLimitChange($event)"
            >
              <option value="25">Top 25</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>

        <div class="meta">
          Showing <span class="mono">{{ visible().length }}</span> of
          <span class="mono">{{ r.hotspotScores.length }}</span>.
        </div>

        <div class="list">
          @for (h of visible(); track h.filePath) {
            <article class="item">
              <header class="item__head">
                <div class="item__path mono" [title]="h.filePath">{{ h.filePath }}</div>
                <div class="item__score mono">{{ h.score.toFixed(1) }}</div>
              </header>

              <div class="chips">
                <span class="chip">lines {{ h.metrics.lineCount }}</span>
                <span class="chip">methods {{ h.metrics.methodCount }}</span>
                <span class="chip">branches {{ h.metrics.branchCount }}</span>
                <span class="chip">dupLines {{ h.metrics.duplicatedLineCount }}</span>
                <span class="chip" [class.chip--warn]="h.metrics.missingSpec">spec {{ h.metrics.missingSpec ? "no" : "yes" }}</span>
                <span class="chip">fanIn {{ h.metrics.fanIn }}</span>
                <span class="chip">fanOut {{ h.metrics.fanOut }}</span>
              </div>

              <details class="details">
                <summary>Factors + Metrics</summary>
                <div class="details__grid">
                  <div>
                    <div class="details__k">Factors</div>
                    <pre class="pre">{{ h.factors | json }}</pre>
                  </div>
                  <div>
                    <div class="details__k">Metrics</div>
                    <pre class="pre">{{ h.metrics | json }}</pre>
                  </div>
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
        grid-template-columns: 1fr 180px;
        gap: 10px;
        align-items: end;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 70%, transparent);
        box-shadow: var(--shadow);
      }
      @media (max-width: 780px) {
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
      .input::placeholder {
        color: color-mix(in srgb, var(--muted) 70%, transparent);
      }
      .meta {
        margin: 12px 2px;
        color: var(--muted);
        font-size: 13px;
      }
      .mono {
        font-family: var(--font-mono);
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
      .item__path {
        word-break: break-word;
        color: color-mix(in srgb, var(--text) 96%, transparent);
      }
      .item__score {
        padding: 8px 10px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
        background: color-mix(in srgb, var(--accent) 12%, var(--surface));
        color: var(--text);
        min-width: 70px;
        text-align: right;
      }

      .chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .chip {
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 92%, transparent);
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .chip--warn {
        color: var(--sev-warning);
        border-color: color-mix(in srgb, var(--sev-warning) 55%, var(--border));
        background: color-mix(in srgb, var(--sev-warning) 10%, var(--surface));
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
      .details__grid {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      @media (max-width: 900px) {
        .details__grid {
          grid-template-columns: 1fr;
        }
      }
      .details__k {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }
      .pre {
        margin: 0;
        padding: 10px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--bg0) 65%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        overflow: auto;
        font-family: var(--font-mono);
        font-size: 12px;
      }
    `
  ]
})
export class HotspotsPageComponent {
  private readonly store = inject(ReportStoreService);
  readonly report = this.store.report;

  readonly query = signal<string>("");
  readonly limit = signal<HotspotLimit>("50");

  private readonly filtered = computed<HotspotScore[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.store.hotspots();
    if (!q) return all;
    return all.filter((h) => h.filePath.toLowerCase().includes(q));
  });

  readonly visible = computed<HotspotScore[]>(() => {
    const sorted = [...this.filtered()].sort((a, b) => b.score - a.score);
    const limit = this.limit();
    if (limit === "all") return sorted;
    const n = Number(limit);
    return sorted.slice(0, Number.isFinite(n) ? n : 50);
  });

  onQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.query.set(value);
  }

  onLimitChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? "50";
    if (value === "25" || value === "50" || value === "100" || value === "all") {
      this.limit.set(value);
      return;
    }
    this.limit.set("50");
  }
}
