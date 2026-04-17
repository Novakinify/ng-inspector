import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { ReportStoreService } from "../state/report-store.service";
import type { AnalyzerFinding } from "../lib/report-schema";

interface CycleViewModel {
  nodeCount: number;
  nodes: string[];
}

@Component({
  selector: "ngi-import-graph-page",
  standalone: true,
  imports: [EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as r) {
      <section class="page">
        <header class="page__header">
          <h1 class="page__title">Import Graph Summary</h1>
          <p class="page__subtitle">
            Summary of the (relative) import graph and any detected cycles. Cycle detection is
            conservative and meant to be a starting point.
          </p>
        </header>

        <div class="cards">
          <div class="card">
            <div class="card__k">Nodes</div>
            <div class="card__v mono">{{ r.importGraph.nodes }}</div>
          </div>
          <div class="card">
            <div class="card__k">Edges</div>
            <div class="card__v mono">{{ r.importGraph.edges }}</div>
          </div>
          <div class="card">
            <div class="card__k">Cycles</div>
            <div class="card__v mono">{{ r.importGraph.cycles }}</div>
          </div>
        </div>

        <section class="section">
          <h2 class="section__title">Cycles</h2>
          @if (cycles().length === 0) {
            <div class="note">No cycle findings were reported.</div>
          } @else {
            <div class="list">
              @for (c of cycles(); track c.nodes.join('|')) {
                <article class="item">
                  <header class="item__head">
                    <div class="mono dim">{{ c.nodeCount }} nodes</div>
                  </header>
                  <ol class="nodes mono">
                    @for (n of c.nodes; track n) {
                      <li class="nodes__item" [title]="n">{{ n }}</li>
                    }
                  </ol>
                </article>
              }
            </div>
          }
        </section>
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
      @media (max-width: 820px) {
        .cards {
          grid-template-columns: 1fr;
        }
      }
      .card {
        padding: 14px;
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
        font-size: 22px;
        color: var(--text);
      }
      .mono {
        font-family: var(--font-mono);
      }
      .dim {
        color: color-mix(in srgb, var(--muted) 90%, transparent);
      }

      .section {
        margin-top: 18px;
      }
      .section__title {
        margin: 0 0 10px 0;
        font-size: 18px;
        letter-spacing: -0.02em;
      }
      .note {
        padding: 12px;
        border-radius: 12px;
        color: var(--muted);
        border: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 60%, transparent);
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
      .nodes {
        margin: 10px 0 0 0;
        padding-left: 20px;
        color: color-mix(in srgb, var(--text) 92%, transparent);
      }
      .nodes__item {
        word-break: break-word;
        line-height: 1.6;
        margin: 2px 0;
      }
    `
  ]
})
export class ImportGraphPageComponent {
  private readonly store = inject(ReportStoreService);
  readonly report = this.store.report;

  readonly cycles = computed<CycleViewModel[]>(() => {
    const raw = this.store.findings().filter((f) => f.code === "import-cycle");
    return raw
      .map((f) => cycleFromFinding(f))
      .filter((c): c is CycleViewModel => c !== null);
  });
}

function cycleFromFinding(f: AnalyzerFinding): CycleViewModel | null {
  const nodesValue = f.metadata["nodes"];
  const nodes = Array.isArray(nodesValue) ? nodesValue.filter((n) => typeof n === "string") : [];
  if (nodes.length === 0) return null;
  const nodeCount = typeof f.metadata["nodeCount"] === "number" ? f.metadata["nodeCount"] : nodes.length;
  return { nodeCount, nodes };
}

