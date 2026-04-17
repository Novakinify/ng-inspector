import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { JsonPipe } from "@angular/common";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { ReportStoreService } from "../state/report-store.service";
import { filterFindings, sortFindings, type FindingsSortKey } from "../lib/findings-filter";
import type { AnalyzerFinding, FindingSeverity } from "../lib/report-schema";

@Component({
  selector: "ngi-findings-page",
  standalone: true,
  imports: [EmptyStateComponent, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as r) {
      <section class="page">
        <header class="page__header">
          <h1 class="page__title">Findings</h1>
          <p class="page__subtitle">
            Filter and inspect findings. This UI is read-only; fix issues in your workspace and rerun
            <span class="mono">ng-inspector audit</span>.
          </p>
        </header>

        <div class="filters">
          <div class="filters__group">
            <label class="label">Severity</label>
            <div class="seg">
              <button class="seg__btn" [class.is-on]="severity() === 'all'" (click)="severity.set('all')">
                All ({{ r.findings.length }})
              </button>
              <button class="seg__btn" [class.is-on]="severity() === 'error'" (click)="severity.set('error')">
                Error ({{ counts().error }})
              </button>
              <button
                class="seg__btn"
                [class.is-on]="severity() === 'warning'"
                (click)="severity.set('warning')"
              >
                Warning ({{ counts().warning }})
              </button>
              <button class="seg__btn" [class.is-on]="severity() === 'info'" (click)="severity.set('info')">
                Info ({{ counts().info }})
              </button>
            </div>
          </div>

          <div class="filters__group">
            <label class="label" for="cat">Category</label>
            <select
              id="cat"
              class="select"
              [value]="category()"
              (change)="onCategoryChange($event)"
            >
              <option value="all">All</option>
              @for (c of categories(); track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
          </div>

          <div class="filters__group">
            <label class="label" for="code">Rule code</label>
            <input
              id="code"
              class="input"
              type="text"
              placeholder="e.g. component-large-template"
              [value]="codeQuery()"
              (input)="onCodeQueryInput($event)"
            />
          </div>

          <div class="filters__group">
            <label class="label" for="text">Text</label>
            <input
              id="text"
              class="input"
              type="text"
              placeholder="search message, path, why it matters"
              [value]="textQuery()"
              (input)="onTextQueryInput($event)"
            />
          </div>

          <div class="filters__group">
            <label class="label" for="sort">Sort</label>
            <select
              id="sort"
              class="select"
              [value]="sortKey()"
              (change)="onSortChange($event)"
            >
              <option value="severity">Severity</option>
              <option value="code">Rule code</option>
              <option value="filePath">File path</option>
            </select>
          </div>
        </div>

        <div class="meta">
          Showing <span class="mono">{{ filtered().length }}</span> of
          <span class="mono">{{ r.findings.length }}</span>.
        </div>

        <div class="table">
          <div class="thead">
            <div>Severity</div>
            <div>Category</div>
            <div>Rule</div>
            <div>Message</div>
            <div>File</div>
          </div>
          @for (f of filtered(); track trackFinding(f)) {
            <div class="tr">
              <div>
                <span class="badge" [class]="'badge--' + f.severity">{{ f.severity }}</span>
              </div>
              <div class="mono dim">{{ f.category }}</div>
              <div class="mono">{{ f.code }}</div>
              <div>
                <div class="msg">{{ f.message }}</div>
                <details class="details">
                  <summary>Details</summary>
                  <div class="details__grid">
                    <div>
                      <div class="details__k">Why it matters</div>
                      <div class="details__v">{{ f.whyItMatters || "—" }}</div>
                    </div>
                    <div>
                      <div class="details__k">Suggested actions</div>
                      <div class="details__v">
                        @if (f.suggestedActions.length > 0) {
                          <ul class="list">
                            @for (a of f.suggestedActions; track a) {
                              <li>{{ a }}</li>
                            }
                          </ul>
                        } @else {
                          —
                        }
                      </div>
                    </div>
                    <div class="details__full">
                      <div class="details__k">Metadata</div>
                      <pre class="pre">{{ f.metadata | json }}</pre>
                    </div>
                  </div>
                </details>
              </div>
              <div class="mono file" [title]="f.filePath">{{ f.filePath }}</div>
            </div>
          }
        </div>
      </section>
    } @else {
      <ngi-empty-state title="No findings to show yet">
        <div class="empty-actions">
          <p class="empty-actions__hint">
            Use the header button to load <span class="mono">report.json</span> or load the mock report.
          </p>
        </div>
      </ngi-empty-state>
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

      .filters {
        display: grid;
        grid-template-columns: 1.4fr 0.8fr 1fr 1.2fr 0.6fr;
        gap: 10px;
        align-items: end;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 70%, transparent);
        box-shadow: var(--shadow);
      }
      @media (max-width: 1100px) {
        .filters {
          grid-template-columns: 1fr 1fr;
        }
      }
      .filters__group {
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
      .seg {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .seg__btn {
        border-radius: 999px;
        padding: 8px 10px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 85%, transparent);
        color: var(--muted);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: 12px;
        transition: transform 0.06s ease, background 0.15s ease, color 0.15s ease;
      }
      .seg__btn:hover {
        background: color-mix(in srgb, var(--surface) 95%, transparent);
        color: var(--text);
      }
      .seg__btn:active {
        transform: translateY(1px);
      }
      .seg__btn.is-on {
        background: color-mix(in srgb, var(--accent) 15%, var(--surface));
        color: var(--text);
        border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
      }

      .meta {
        margin: 12px 2px;
        color: var(--muted);
        font-size: 13px;
      }

      .table {
        margin-top: 8px;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
        box-shadow: var(--shadow);
      }
      .thead,
      .tr {
        display: grid;
        grid-template-columns: 110px 150px 260px 1fr 0.9fr;
        gap: 12px;
        padding: 12px 14px;
        align-items: start;
      }
      .thead {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
        background: color-mix(in srgb, var(--surface) 90%, transparent);
      }
      .tr {
        border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
      }
      .tr:last-child {
        border-bottom: none;
      }
      @media (max-width: 980px) {
        .thead {
          display: none;
        }
        .tr {
          grid-template-columns: 1fr;
        }
        .file {
          margin-top: 8px;
        }
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
        text-transform: lowercase;
      }
      .badge--error {
        color: var(--sev-error);
        border-color: color-mix(in srgb, var(--sev-error) 55%, var(--border));
      }
      .badge--warning {
        color: var(--sev-warning);
        border-color: color-mix(in srgb, var(--sev-warning) 55%, var(--border));
      }
      .badge--info {
        color: var(--sev-info);
        border-color: color-mix(in srgb, var(--sev-info) 55%, var(--border));
      }

      .msg {
        line-height: 1.5;
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
      .details__full {
        grid-column: 1 / -1;
      }
      @media (max-width: 980px) {
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
      .details__v {
        line-height: 1.55;
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
        color: color-mix(in srgb, var(--text) 90%, transparent);
      }
      .list {
        margin: 0;
        padding-left: 18px;
      }
      .mono {
        font-family: var(--font-mono);
      }
      .dim {
        color: color-mix(in srgb, var(--muted) 90%, transparent);
      }
      .file {
        word-break: break-word;
      }
      .empty-actions {
        margin-top: 14px;
      }
      .empty-actions__hint {
        margin: 0;
        color: var(--muted);
      }
    `
  ]
})
export class FindingsPageComponent {
  private readonly store = inject(ReportStoreService);
  readonly report = this.store.report;
  readonly counts = this.store.countsBySeverity;
  readonly categories = this.store.findingCategories;

  readonly severity = signal<FindingSeverity | "all">("all");
  readonly category = signal<string | "all">("all");
  readonly codeQuery = signal<string>("");
  readonly textQuery = signal<string>("");
  readonly sortKey = signal<FindingsSortKey>("severity");

  readonly filtered = computed<AnalyzerFinding[]>(() => {
    const base = this.store.findings();
    const filtered = filterFindings(base, {
      severity: this.severity(),
      category: this.category(),
      codeQuery: this.codeQuery(),
      textQuery: this.textQuery()
    });
    return sortFindings(filtered, this.sortKey());
  });

  trackFinding(f: AnalyzerFinding): string {
    // Prefer a deterministic key for UI stability.
    return `${f.filePath}::${f.code}::${f.message}`;
  }

  onCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? "all";
    this.category.set(value);
  }

  onCodeQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.codeQuery.set(value);
  }

  onTextQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.textQuery.set(value);
  }

  onSortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? "severity";
    if (value === "severity" || value === "code" || value === "filePath") {
      this.sortKey.set(value);
      return;
    }
    this.sortKey.set("severity");
  }
}
