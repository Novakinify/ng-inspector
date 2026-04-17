import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { ReportLoaderService } from "./state/report-loader.service";
import { ReportStoreService } from "./state/report-store.service";
import { ScanHistoryService } from "./state/scan-history.service";

@Component({
  selector: "ngi-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly loader = inject(ReportLoaderService);
  private readonly store = inject(ReportStoreService);
  private readonly scanHistory = inject(ScanHistoryService);

  readonly report = this.store.report;
  readonly loading = this.store.loading;
  readonly error = this.store.error;

  readonly findingsCount = computed(() => this.store.findings().length);
  readonly lifecycleCount = computed(() => this.store.findings().filter((f) => f.category === "lifecycle").length);
  readonly hotspotsCount = computed(() => this.store.hotspots().length);
  readonly duplicatesCount = computed(() => this.store.duplicates().length);
  readonly cyclesCount = computed(() => this.report()?.importGraph.cycles ?? 0);

  async onFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    // Allow re-selecting the same file to re-load it.
    if (input) input.value = "";

    if (!file) return;

    this.store.setLoading(true);
    const result = await this.loader.loadFromFile(file);
    this.store.setLoading(false);

    if (!result.ok) {
      this.store.setError(result.error);
      return;
    }

    this.store.setReport(result.report);
    this.scanHistory.addReport(result.report, "file");
  }

  async loadMock(): Promise<void> {
    this.store.setLoading(true);
    const result = await this.loader.loadMock();
    this.store.setLoading(false);

    if (!result.ok) {
      this.store.setError(result.error);
      return;
    }

    this.store.setReport(result.report);
    this.scanHistory.addReport(result.report, "mock");
  }

  clear(): void {
    this.store.clearReport();
  }
}
