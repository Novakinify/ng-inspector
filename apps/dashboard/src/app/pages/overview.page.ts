import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { ReportStoreService } from "../state/report-store.service";

@Component({
  selector: "ngi-overview-page",
  standalone: true,
  imports: [EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as r) {
      <section class="page">
        <header class="page__header">
          <h1 class="page__title">Overview</h1>
          <p class="page__subtitle">High-level summary of the loaded ng-inspector report.</p>
        </header>

        <div class="cards">
          <div class="card">
            <div class="card__k">Workspace</div>
            <div class="card__v mono" [title]="r.workspaceRoot">{{ r.workspaceRoot }}</div>
            <div class="card__m mono">Generated: {{ r.generatedAt }}</div>
          </div>

          <div class="card">
            <div class="card__k">Projects</div>
            <div class="card__v">{{ r.summary.projects }}</div>
            <div class="card__m">Angular projects discovered</div>
          </div>

          <div class="card">
            <div class="card__k">Artifacts</div>
            <div class="card__v">
              {{ r.summary.components }} components
              <span class="dot"></span>
              {{ r.summary.services }} services
              <span class="dot"></span>
              {{ r.summary.routes }} routes
            </div>
            <div class="card__m">Discovered conservatively</div>
          </div>

          <div class="card">
            <div class="card__k">Findings</div>
            <div class="card__v">
              <span class="sev sev--error">E {{ counts().error }}</span>
              <span class="sev sev--warning">W {{ counts().warning }}</span>
              <span class="sev sev--info">I {{ counts().info }}</span>
            </div>
            <div class="card__m">{{ totalFindings() }} total</div>
          </div>

          <div class="card">
            <div class="card__k">Import Graph</div>
            <div class="card__v">
              {{ r.importGraph.nodes }} nodes
              <span class="dot"></span>
              {{ r.importGraph.edges }} edges
              <span class="dot"></span>
              {{ r.importGraph.cycles }} cycles
            </div>
            <div class="card__m">Relative imports only</div>
          </div>

          <div class="card">
            <div class="card__k">Signals</div>
            <div class="card__v">
              {{ r.hotspotScores.length }} hotspots
              <span class="dot"></span>
              {{ r.duplicateGroups.length }} duplicate groups
            </div>
            <div class="card__m">Heuristics, low-noise by design</div>
          </div>
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

      .cards {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      @media (max-width: 980px) {
        .cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 680px) {
        .cards {
          grid-template-columns: 1fr;
        }
      }

      .card {
        padding: 16px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
        box-shadow: var(--shadow);
      }
      .card__k {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .card__v {
        margin-top: 10px;
        font-size: 18px;
        line-height: 1.35;
        word-break: break-word;
      }
      .card__m {
        margin-top: 10px;
        color: color-mix(in srgb, var(--muted) 80%, transparent);
        font-size: 12px;
      }
      .mono {
        font-family: var(--font-mono);
        font-size: 12px;
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
      .sev {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: var(--font-mono);
        font-size: 12px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 85%, transparent);
        margin-right: 8px;
      }
      .sev--error {
        color: var(--sev-error);
      }
      .sev--warning {
        color: var(--sev-warning);
      }
      .sev--info {
        color: var(--sev-info);
      }
    `
  ]
})
export class OverviewPageComponent {
  private readonly store = inject(ReportStoreService);
  readonly report = this.store.report;

  readonly counts = this.store.countsBySeverity;
  readonly totalFindings = computed(() => this.store.getTotalFindings("all"));
}

