export function printHelp(): void {
  // Keep formatting plain so it works well in CI logs too.
  // eslint-disable-next-line no-console
  console.log(
    [
      "ng-inspector",
      "",
      "Usage:",
      "  ng-inspector audit [--workspace <path>]",
      "",
      "Commands:",
      "  audit    Audit an Angular workspace and write report.json + report.html + brief.json + brief.md (default: ./.ng-inspector/)",
      "",
      "Options:",
      "  -w, --workspace   Workspace root (default: current directory)",
      "  -h, --help        Show help",
      "  -v, --version     Print version",
      "",
    ].join("\n"),
  );
}
