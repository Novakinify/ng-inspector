import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "ngi-empty-state",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty">
      <div class="empty__card">
        <h2 class="empty__title">{{ title() }}</h2>
        <p class="empty__text">
          {{ text() }}
        </p>
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      .empty {
        display: grid;
        place-items: center;
        min-height: 50vh;
      }
      .empty__card {
        width: min(720px, 100%);
        padding: 24px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        background: color-mix(in srgb, var(--surface) 85%, transparent);
        border-radius: 16px;
        box-shadow: var(--shadow-lg);
      }
      .empty__title {
        margin: 0 0 8px 0;
        font-size: 20px;
        letter-spacing: -0.02em;
      }
      .empty__text {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
    `
  ]
})
export class EmptyStateComponent {
  readonly title = input<string>("No report loaded");
  readonly text = input<string>(
    "Load an ng-inspector report.json from disk to see findings and project insights."
  );
}

