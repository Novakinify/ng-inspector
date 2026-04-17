import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { parseAuditReportJson } from "../lib/report-parse";
import { compareScans } from "../lib/scan-compare";
import type { ScanSnapshot } from "../lib/scan-snapshot";
import { LocalScanApiService } from "../state/local-scan-api.service";
import { ReportStoreService } from "../state/report-store.service";
import { ScanHistoryService } from "../state/scan-history.service";

interface HealthState {
  ok: boolean;
  message: string;
  checkedAt: string | null;
}

interface LastRunState {
  reportPathAbs: string;
  htmlPathAbs: string;
}

const LAST_WORKSPACE_KEY = "ngInspector.lastWorkspaceRoot.v1";

@Component({
  selector: "ngi-scans-page",
  standalone: true,
  imports: [EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="page__header">
        <h1 class="page__title">Scans</h1>
        <p class="page__subtitle">
          Local, dev-friendly scan workflow. In a normal static build, the dashboard can only load an
          existing <span class="mono">report.json</span>. To run audits from the UI, start the local
          scan server.
        </p>
      </header>

      <div class="grid">
        <section class="card">
          <h2 class="card__title">Local Scan</h2>
          <p class="card__text">
            Start the local server with <span class="mono">npm run dashboard:local</span> (recommended),
            or run the dashboard separately and point the API base URL at the server.
          </p>

          <div class="fields">
            <div class="field">
              <label class="label" for="api">API base URL</label>
              <input
                id="api"
                class="input mono"
                type="text"
                [value]="apiBaseUrl()"
                (input)="onApiBaseUrlInput($event)"
                placeholder="/api or http://127.0.0.1:4177/api"
              />
              <div class="hint">Default: <span class="mono">/api</span></div>
            </div>

            <div class="field">
              <label class="label" for="ws">Workspace path</label>
              <input
                id="ws"
                class="input mono"
                type="text"
                [value]="workspaceRoot()"
                (input)="onWorkspaceRootInput($event)"
                placeholder="C:\\work\\your-angular-workspace"
              />
              <div class="hint">
                Must contain <span class="mono">angular.json</span>. The audit will write
                <span class="mono">.ng-inspector/report.json</span> inside the workspace (or configured outputDir).
              </div>
            </div>
          </div>

          <div class="row">
            <div class="health" [class.health--ok]="health().ok" [class.health--bad]="!health().ok">
              <span class="mono">{{ health().ok ? "online" : "offline" }}</span>
              <span class="dot"></span>
              <span>{{ health().message }}</span>
            </div>

            <div class="actions">
              <button class="btn btn--ghost" type="button" (click)="checkHealth()" [disabled]="running()">
                Check server
              </button>
              <button class="btn" type="button" (click)="runAudit()" [disabled]="running() || !workspaceRoot().trim()">
                {{ running() ? "Running…" : "Run audit" }}
              </button>
            </div>
          </div>

          <div class="cmd">
            <div class="label">Fallback CLI command</div>
            <div class="cmd__box">
              <code class="mono">{{ fallbackCommand() }}</code>
              <button class="btn btn--ghost" type="button" (click)="copyFallbackCommand()">Copy</button>
            </div>
          </div>

          @if (lastRun(); as lr) {
            <div class="note">
              <div class="note__k">Last run</div>
              <div class="note__v mono">report.json: {{ lr.reportPathAbs }}</div>
              <div class="note__v mono">report.html: {{ lr.htmlPathAbs || "(same folder)" }}</div>
            </div>
          }
        </section>

        <section class="card">
          <h2 class="card__title">Latest Scan</h2>

          @if (latestScan(); as s) {
            <div class="kv">
              <div class="kv__row">
                <div class="kv__k">Workspace</div>
                <div class="kv__v mono" [title]="s.workspaceRoot">{{ s.workspaceRoot }}</div>
              </div>
              <div class="kv__row">
                <div class="kv__k">Generated</div>
                <div class="kv__v mono">{{ s.generatedAt }}</div>
              </div>
              <div class="kv__row">
                <div class="kv__k">Summary</div>
                <div class="kv__v">
                  <span class="mono">{{ s.summary.projects }}</span> projects
                  <span class="sep"></span>
                  <span class="mono">{{ s.summary.components }}</span> components
                  <span class="sep"></span>
                  <span class="mono">{{ s.summary.services }}</span> services
                  <span class="sep"></span>
                  <span class="mono">{{ s.summary.routes }}</span> routes
                </div>
              </div>
              <div class="kv__row">
                <div class="kv__k">Findings</div>
                <div class="kv__v">
                  <span class="sev sev--error mono">E {{ s.findingsBySeverity.error }}</span>
                  <span class="sev sev--warning mono">W {{ s.findingsBySeverity.warning }}</span>
                  <span class="sev sev--info mono">I {{ s.findingsBySeverity.info }}</span>
                  <span class="sep"></span>
                  <span class="mono">{{ s.findingsTotal }}</span> total
                </div>
              </div>
            </div>

            <div class="hint dim">
              Latest scan is stored locally (scan history). Use the header’s “Load report.json” if you want to load
              a specific file into the dashboard.
            </div>
          } @else {
            <ngi-empty-state
              title="No scans recorded yet"
              text="Run an audit via the Local Scan workflow or load an existing report.json from disk."
            />
          }
        </section>
      </div>

      <section class="section">
        <header class="section__head">
          <h2 class="section__title">History</h2>
          <div class="section__actions">
            <button class="btn btn--ghost" type="button" (click)="clearHistory()" [disabled]="scans().length === 0">
              Clear history
            </button>
          </div>
        </header>

        @if (scans().length === 0) {
          <div class="note">No scan history yet.</div>
        } @else {
          <div class="table">
            <div class="thead">
              <div>Generated</div>
              <div>Workspace</div>
              <div class="num">Projects</div>
              <div class="num">Cmp</div>
              <div class="num">Svc</div>
              <div class="num">Routes</div>
              <div class="num">E</div>
              <div class="num">W</div>
              <div class="num">I</div>
            </div>
            @for (s of scans(); track s.id) {
              <div class="tr" (click)="selectForCompare(s)">
                <div class="mono">{{ s.generatedAt }}</div>
                <div class="mono dim" [title]="s.workspaceRoot">{{ s.workspaceRoot }}</div>
                <div class="mono num">{{ s.summary.projects }}</div>
                <div class="mono num">{{ s.summary.components }}</div>
                <div class="mono num">{{ s.summary.services }}</div>
                <div class="mono num">{{ s.summary.routes }}</div>
                <div class="mono num sev sev--error">{{ s.findingsBySeverity.error }}</div>
                <div class="mono num sev sev--warning">{{ s.findingsBySeverity.warning }}</div>
                <div class="mono num sev sev--info">{{ s.findingsBySeverity.info }}</div>
              </div>
            }
          </div>
          <div class="hint">Tip: click a row to quickly fill Compare selections.</div>
        }
      </section>

      <section class="section">
        <h2 class="section__title">Compare</h2>

        @if (scans().length < 2) {
          <div class="note">Need at least two scans in history to compare.</div>
        } @else {
          <div class="compare">
            <div class="compare__pick">
              <div class="field">
                <label class="label" for="from">From</label>
                <select id="from" class="select mono" [value]="fromId()" (change)="onFromChange($event)">
                  @for (s of scans(); track s.id) {
                    <option [value]="s.id">{{ s.generatedAt }} | {{ s.workspaceRoot }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="label" for="to">To</label>
                <select id="to" class="select mono" [value]="toId()" (change)="onToChange($event)">
                  @for (s of scans(); track s.id) {
                    <option [value]="s.id">{{ s.generatedAt }} | {{ s.workspaceRoot }}</option>
                  }
                </select>
              </div>
            </div>

            @if (compare(); as c) {
              <div class="compare__grid">
                <div class="metric">
                  <div class="metric__k">Findings</div>
                  <div class="metric__v mono">{{ fmtDelta(c.delta.findingsTotal) }}</div>
                  <div class="metric__m">
                    E {{ fmtDelta(c.delta.findingsBySeverity.error) }}
                    <span class="sep"></span>
                    W {{ fmtDelta(c.delta.findingsBySeverity.warning) }}
                    <span class="sep"></span>
                    I {{ fmtDelta(c.delta.findingsBySeverity.info) }}
                  </div>
                </div>
                <div class="metric">
                  <div class="metric__k">Artifacts</div>
                  <div class="metric__v mono">{{ fmtDelta(c.delta.components) }} cmp</div>
                  <div class="metric__m">
                    {{ fmtDelta(c.delta.services) }} svc
                    <span class="sep"></span>
                    {{ fmtDelta(c.delta.routes) }} routes
                  </div>
                </div>
                <div class="metric">
                  <div class="metric__k">Import cycles</div>
                  <div class="metric__v mono">{{ fmtDelta(c.delta.importCycles) }}</div>
                  <div class="metric__m">
                    nodes {{ fmtDelta(c.delta.importNodes) }}
                    <span class="sep"></span>
                    edges {{ fmtDelta(c.delta.importEdges) }}
                  </div>
                </div>
                <div class="metric">
                  <div class="metric__k">Dupes / Hotspots</div>
                  <div class="metric__v mono">{{ fmtDelta(c.delta.duplicatesGroupCount) }} dupes</div>
                  <div class="metric__m">{{ fmtDelta(c.delta.hotspotsCount) }} hotspots</div>
                </div>
              </div>

              <div class="codes">
                <div class="codes__head">
                  <div class="label">Top rule deltas</div>
                  <div class="hint dim">Absolute changes (increase or decrease)</div>
                </div>
                @if (c.topCodeDeltas.length === 0) {
                  <div class="note">No rule-count deltas detected.</div>
                } @else {
                  <div class="codes__table">
                    <div class="thead">
                      <div>Rule</div>
                      <div class="num">From</div>
                      <div class="num">To</div>
                      <div class="num">Delta</div>
                    </div>
                    @for (d of c.topCodeDeltas; track d.code) {
                      <div class="tr">
                        <div class="mono">{{ d.code }}</div>
                        <div class="mono num">{{ d.from }}</div>
                        <div class="mono num">{{ d.to }}</div>
                        <div class="mono num">{{ fmtDelta(d.delta) }}</div>
                      </div>
                    }
                  </div>
                }
              </div>
            } @else {
              <div class="note">Choose two different scans to compare.</div>
            }
          </div>
        }
      </section>
    </section>
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

      .mono {
        font-family: var(--font-mono);
      }
      .dim {
        color: color-mix(in srgb, var(--muted) 90%, transparent);
      }
      .sep {
        display: inline-block;
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--muted) 70%, transparent);
        vertical-align: middle;
        margin: 0 10px;
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

      .grid {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 12px;
      }
      @media (max-width: 980px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }

      .card {
        padding: 16px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
        box-shadow: var(--shadow);
        min-width: 0;
      }
      .card__title {
        margin: 0;
        font-size: 18px;
        letter-spacing: -0.02em;
      }
      .card__text {
        margin: 8px 0 0 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .fields {
        margin-top: 14px;
        display: grid;
        gap: 10px;
      }
      .field {
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
      .hint {
        margin: 6px 2px 0 2px;
        color: color-mix(in srgb, var(--muted) 85%, transparent);
        font-size: 12px;
        line-height: 1.5;
      }

      .row {
        margin-top: 14px;
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .health {
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 85%, transparent);
        color: var(--muted);
        font-size: 13px;
      }
      .health--ok {
        border-color: color-mix(in srgb, var(--accent2) 35%, var(--border));
        color: color-mix(in srgb, var(--accent2) 80%, var(--text));
      }
      .health--bad {
        border-color: color-mix(in srgb, var(--sev-warning) 35%, var(--border));
      }
      .actions {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .btn {
        border-radius: 12px;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--accent) 14%, var(--surface));
        color: var(--text);
        cursor: pointer;
        font-weight: 600;
        letter-spacing: -0.01em;
        transition: transform 0.06s ease, background 0.15s ease, border-color 0.15s ease;
      }
      .btn:hover {
        background: color-mix(in srgb, var(--accent) 20%, var(--surface));
        border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
      }
      .btn:active {
        transform: translateY(1px);
      }
      .btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .btn--ghost {
        background: color-mix(in srgb, var(--surface) 85%, transparent);
        color: color-mix(in srgb, var(--text) 92%, transparent);
      }

      .cmd {
        margin-top: 14px;
      }
      .cmd__box {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: center;
        padding: 10px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--bg0) 35%, transparent);
        overflow: auto;
      }

      .note {
        margin-top: 14px;
        padding: 12px;
        border-radius: 12px;
        color: var(--muted);
        border: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 60%, transparent);
      }
      .note__k {
        color: color-mix(in srgb, var(--muted) 90%, transparent);
        font-size: 12px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .note__v {
        margin-top: 8px;
        word-break: break-word;
      }

      .kv {
        margin-top: 14px;
        display: grid;
        gap: 10px;
      }
      .kv__row {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 12px;
        align-items: baseline;
      }
      .kv__k {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .kv__v {
        min-width: 0;
        word-break: break-word;
      }

      .sev {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
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

      .section {
        margin-top: 18px;
      }
      .section__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .section__title {
        margin: 0 0 10px 0;
        font-size: 18px;
        letter-spacing: -0.02em;
      }

      .table {
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
        box-shadow: var(--shadow);
      }
      .thead,
      .tr {
        display: grid;
        grid-template-columns: 260px 1fr 90px 90px 90px 90px 70px 70px 70px;
        gap: 10px;
        padding: 12px 14px;
        align-items: center;
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
        cursor: pointer;
      }
      .tr:hover {
        background: color-mix(in srgb, var(--surface) 92%, transparent);
      }
      .tr:last-child {
        border-bottom: none;
      }
      .num {
        text-align: right;
      }
      @media (max-width: 1100px) {
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

      .compare {
        padding: 14px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 70%, transparent);
        box-shadow: var(--shadow);
      }
      .compare__pick {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 980px) {
        .compare__pick {
          grid-template-columns: 1fr;
        }
      }
      .compare__grid {
        margin-top: 12px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      @media (max-width: 980px) {
        .compare__grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 560px) {
        .compare__grid {
          grid-template-columns: 1fr;
        }
      }

      .metric {
        padding: 12px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
      }
      .metric__k {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .metric__v {
        margin-top: 10px;
        font-size: 20px;
        color: var(--text);
      }
      .metric__m {
        margin-top: 10px;
        color: color-mix(in srgb, var(--muted) 85%, transparent);
        font-size: 12px;
        line-height: 1.5;
      }

      .codes {
        margin-top: 12px;
      }
      .codes__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      .codes__table {
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 78%, transparent);
      }
      .codes__table .thead,
      .codes__table .tr {
        grid-template-columns: 1fr 90px 90px 90px;
      }
    `
  ]
})
export class ScansPageComponent {
  private readonly api = inject(LocalScanApiService);
  private readonly store = inject(ReportStoreService);
  private readonly history = inject(ScanHistoryService);

  readonly scans = this.history.scans;
  readonly latestScan = this.history.latest;

  readonly apiBaseUrl = this.api.baseUrl;

  readonly running = signal<boolean>(false);
  readonly health = signal<HealthState>({ ok: false, message: "Not checked.", checkedAt: null });
  readonly lastRun = signal<LastRunState | null>(null);

  readonly workspaceRoot = signal<string>(loadLastWorkspaceRoot());

  readonly fallbackCommand = computed(() => {
    const root = this.workspaceRoot().trim() || "<path-to-angular-workspace>";
    return `npm run ng-inspector -- audit --workspace ${root}`;
  });

  readonly fromId = signal<string>("");
  readonly toId = signal<string>("");

  readonly compare = computed(() => {
    const a = findById(this.scans(), this.fromId());
    const b = findById(this.scans(), this.toId());
    if (!a || !b) return null;
    if (a.id === b.id) return null;
    return compareScans(a, b);
  });

  constructor() {
    // Initialize compare selection based on history.
    const scans = this.scans();
    this.fromId.set(scans[1]?.id ?? scans[0]?.id ?? "");
    this.toId.set(scans[0]?.id ?? "");

    void this.checkHealth();
  }

  onApiBaseUrlInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.api.setBaseUrl(value);
  }

  onWorkspaceRootInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? "";
    this.workspaceRoot.set(value);
    persistLastWorkspaceRoot(value);
  }

  async checkHealth(): Promise<void> {
    const res = await this.api.health();
    if (!res.ok) {
      this.health.set({ ok: false, message: res.error, checkedAt: new Date().toISOString() });
      return;
    }
    this.health.set({ ok: true, message: `OK (server time ${res.time})`, checkedAt: new Date().toISOString() });
  }

  async runAudit(): Promise<void> {
    const workspaceRoot = this.workspaceRoot().trim();
    if (!workspaceRoot) return;

    this.running.set(true);
    const result = await this.api.audit(workspaceRoot);
    this.running.set(false);

    if (!result.ok) {
      this.health.set({ ok: false, message: result.error, checkedAt: new Date().toISOString() });
      return;
    }

    const parsed = parseAuditReportJson(result.reportJsonText);
    if (!parsed.ok) {
      this.health.set({ ok: false, message: parsed.error, checkedAt: new Date().toISOString() });
      return;
    }

    this.store.setReport(parsed.report);
    this.history.addReport(parsed.report, "local");
    this.lastRun.set({ reportPathAbs: result.reportPathAbs, htmlPathAbs: result.htmlPathAbs });
    await this.checkHealth();
  }

  clearHistory(): void {
    this.history.clear();
    this.fromId.set("");
    this.toId.set("");
  }

  selectForCompare(scan: ScanSnapshot): void {
    // Quick fill: first click sets To, second click sets From.
    if (!this.toId()) {
      this.toId.set(scan.id);
      return;
    }
    if (!this.fromId()) {
      this.fromId.set(scan.id);
      return;
    }
    this.fromId.set(this.toId());
    this.toId.set(scan.id);
  }

  onFromChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? "";
    this.fromId.set(value);
  }

  onToChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? "";
    this.toId.set(value);
  }

  fmtDelta(n: number): string {
    if (n > 0) return `+${n}`;
    return String(n);
  }

  async copyFallbackCommand(): Promise<void> {
    const text = this.fallbackCommand();
    try {
      await navigator.clipboard.writeText(text);
      this.health.set({ ok: true, message: "Copied command to clipboard.", checkedAt: new Date().toISOString() });
    } catch {
      this.health.set({ ok: false, message: "Clipboard unavailable.", checkedAt: new Date().toISOString() });
    }
  }
}

function findById(scans: readonly ScanSnapshot[], id: string): ScanSnapshot | null {
  return scans.find((s) => s.id === id) ?? null;
}

function loadLastWorkspaceRoot(): string {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistLastWorkspaceRoot(value: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, value);
  } catch {
    // ignore
  }
}

