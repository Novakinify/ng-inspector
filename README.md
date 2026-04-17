# ng-inspector

Open-source Angular workspace auditor.

`ng-inspector` scans an Angular workspace (reads `angular.json`), discovers common Angular artifacts, runs a few conservative analyzers, and writes a structured JSON report.

Current status: early. CLI is primary; an Angular dashboard exists for local report viewing.

## Planned At plannex.io

This project was planned at plannex.io.

## Quick Start (From This Repo)

1. Install deps:

```bash
npm install
```

2. Run an audit:

```bash
npm run ng-inspector -- audit --workspace <path-to-angular-workspace>
```

3. Open the report:

- `<workspace>/.ng-inspector/report.json`
- `<workspace>/.ng-inspector/report.html`
- `<workspace>/.ng-inspector/brief.json`
- `<workspace>/.ng-inspector/brief.md`

Notes:
- `--workspace` defaults to the current directory if omitted.
- `npm run ng-inspector -- --help` shows CLI help.
- The CLI prints the `report.json` path; `report.html` is written alongside it (same output directory).

## What It Produces

The report is written inside the audited workspace:
- `./.ng-inspector/report.json` (structured data)
- `./.ng-inspector/report.html` (static summary view)
- `./.ng-inspector/brief.json` (deterministic, refactor-oriented engineering brief)
- `./.ng-inspector/brief.md` (human-readable brief)

`report.json` contains:
- `projects`: discovered components/services/routes per Angular project
- `findings`: analyzer findings (typed, with metadata). Each finding includes `category`, `confidence`, `whyItMatters`, and `suggestedActions`.
- `importGraph`: a small summary (nodes/edges/cycles)
- `projectTree`: normalized project/sourceRoot folder tree model
- `duplicateGroups`: conservative duplicate block groups (exact + normalized)
- `hotspotScores`: per-file hotspot scoring (complexity/duplication/spec/import coupling)
- `analyzerCategories`: index of analyzers/categories contributing to the report

### Using brief.json In plannex.io

`brief.json` is a deterministic, rule-based engineering brief generated from the scan report. It groups findings into refactor tracks and emits task candidates with stable IDs, affected files, effort/impact, and (when available) dependencies.

Plannex workflow (manual for now):
1. Run the CLI audit for a workspace.
2. Open `<workspace>/.ng-inspector/brief.json`.
3. Copy/paste (or upload) the JSON into plannex.io to generate an initial refactoring blueprint plan (nodes + tasks + flow), then review and refine.

## Dashboard (Angular App)

The dashboard is an Angular app (presentation only) living in `apps/dashboard`. It consumes an existing `report.json` file produced by the CLI.

### Run The Dashboard

```bash
npm run dashboard:start
```

Then open the URL printed by Angular (usually `http://localhost:4200`) and:

1. Generate a report in the target workspace (CLI):

```bash
npm run ng-inspector -- audit --workspace <path-to-angular-workspace>
```

2. In the dashboard header click:
- `Load report.json` and select `<workspace>/.ng-inspector/report.json`
- or `Load mock` for a bundled example report (useful for UI dev)

3. Use the left sidebar to navigate:
- `Overview`: high-level counts
- `Findings`: filter by severity/category/rule code and sort
- `Lifecycle Risks`: lifecycle and cleanup risk findings with drilldown (when present in the report)
- `Project Tree`: normalized folder tree view
- `Hotspots`: top files by score
- `Duplicates`: duplicate groups + occurrences
- `Import Graph`: summary + cycles

### Local Scan Workflow (Optional)

Browsers cannot spawn processes or read arbitrary disk paths, so to trigger scans from the dashboard UI you need a tiny local server.

Run the dashboard + local scan server together:

```bash
npm run dashboard:local
```

Then open `http://127.0.0.1:4177` and go to the `Scans` view to:
- set the workspace path (must contain `angular.json`)
- click `Run audit` (runs `ng-inspector audit` and loads the resulting report into the UI)
- scan history is recorded locally (localStorage) and a basic compare view is available when you have 2+ scans

If you prefer running the dashboard via `ng serve` (`npm run dashboard:start`), you can still use the local scan server by setting the API base URL in the `Scans` view to `http://127.0.0.1:4177/api`.

### Build The Dashboard

```bash
npm run dashboard:build
```

## Configuration

If `<workspace>/ng-inspector.config.json` exists, it is loaded and merged over defaults.

Supported sections:
- `exclude.paths`: workspace-relative path patterns to exclude (`*`, `**`, `?` supported; no-glob patterns are treated as prefixes)
- `thresholds`: line-count thresholds used by analyzers
- `rules`: per-finding-code severity overrides (`off`, `info`, `warning`, `error`)
- `report.outputDir`: output dir relative to the workspace root (defaults to `.ng-inspector`)

## Findings (Current)

Component analyzer:
- `component-large-ts` (warning)
- `component-large-template` (warning)
- `component-inline-template` (info)
- `component-inline-styles` (info)
- `component-missing-spec` (warning)
- `component-http-calls` (warning, conservative)
- `component-many-injections` (warning, conservative)
- `component-standalone-duplicate-imports` (info, conservative)

Service analyzer:
- `service-large-ts` (warning)
- `service-mixed-responsibility` (warning, heuristic, conservative)
- `service-missing-spec` (warning)

Routes:
- `routes-large-config` (warning, conservative)

Import graph:
- `import-cycle` (warning, conservative SCC-based detection)

## Open-source and commercial direction

ng-inspector's core analysis engine is open source under Apache-2.0.

In the future, hosted features, enterprise workflows, team history, and premium integrations may be offered separately. The open-source core will remain publicly available under its published license.

## Development

Build + run tests (TypeScript strict + `node --test`):

```bash
npm run ng-inspector:test
```

Run the CLI against this repo:

```bash
npm run ng-inspector -- audit --workspace .
```

## Known Limitations (By Design)

- Artifact and route discovery are AST-based but conservative (no type-checker; common patterns only).
- Import graph only resolves relative imports to workspace `.ts` files.
- Thresholds are configurable via `ng-inspector.config.json` (not via CLI yet).
