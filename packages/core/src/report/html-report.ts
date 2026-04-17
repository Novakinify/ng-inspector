import type { AnalyzerFinding, AuditReport, FindingSeverity, ImportCycleFinding } from "../types";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function severityClass(sev: FindingSeverity): string {
  if (sev === "error") return "severity-error";
  if (sev === "warning") return "severity-warning";
  return "severity-info";
}

function countBySeverity(findings: AnalyzerFinding[]): Record<FindingSeverity, number> {
  return findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 } satisfies Record<FindingSeverity, number>,
  );
}

function isImportCycleFinding(f: AnalyzerFinding): f is ImportCycleFinding {
  return f.code === "import-cycle";
}

function jsonCell(value: unknown): string {
  try {
    return escapeHtml(JSON.stringify(value));
  } catch {
    return escapeHtml(String(value));
  }
}

function actionsCell(actions: string[]): string {
  if (!actions.length) return "<span class=\"meta\">(none)</span>";
  return `<ul>${actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`;
}

function countByCategory(findings: AnalyzerFinding[]): Record<string, Record<FindingSeverity, number>> {
  const out: Record<string, Record<FindingSeverity, number>> = {};
  for (const f of findings) {
    const key = f.category;
    out[key] ??= { error: 0, warning: 0, info: 0 };
    out[key][f.severity] += 1;
  }
  return out;
}

export function renderHtmlReport(report: AuditReport): string {
  const severityCounts = countBySeverity(report.findings);
  const totalFindings = report.findings.length;

  const totalComponents = report.projects.reduce((n, p) => n + p.components.length, 0);
  const totalDirectives = report.projects.reduce((n, p) => n + p.directives.length, 0);
  const totalPipes = report.projects.reduce((n, p) => n + p.pipes.length, 0);
  const totalServices = report.projects.reduce((n, p) => n + p.services.length, 0);
  const totalRoutes = report.projects.reduce((n, p) => n + p.routes.length, 0);

  const cycles = report.findings.filter(isImportCycleFinding);
  const findingsByCategory = countByCategory(report.findings);

  const categoryRows = Object.keys(findingsByCategory)
    .sort((a, b) => a.localeCompare(b))
    .map((cat) => {
      const c = findingsByCategory[cat];
      if (!c) return "";
      const total = (c.error ?? 0) + (c.warning ?? 0) + (c.info ?? 0);
      return [
        "<tr>",
        `<td><code>${escapeHtml(cat)}</code></td>`,
        `<td>${total}</td>`,
        `<td>${c.error ?? 0}</td>`,
        `<td>${c.warning ?? 0}</td>`,
        `<td>${c.info ?? 0}</td>`,
        "</tr>",
      ].join("");
    })
    .filter((r) => r.length > 0)
    .join("\n");

  const findingsRows = report.findings
    .map((f) => {
      return [
        "<tr>",
        `<td><span class="pill ${severityClass(f.severity)}">${escapeHtml(f.severity)}</span></td>`,
        `<td><code>${escapeHtml(f.category)}</code></td>`,
        `<td><code>${escapeHtml(f.code)}</code></td>`,
        `<td><code>${escapeHtml(f.filePath)}</code></td>`,
        `<td>${escapeHtml(f.message)}</td>`,
        `<td>${escapeHtml(f.whyItMatters)}</td>`,
        `<td>${actionsCell(f.suggestedActions)}</td>`,
        `<td><code class="meta-json">${jsonCell(f.metadata)}</code></td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");

  const projectRows = report.projects
    .map((p) => {
      return [
        "<tr>",
        `<td><code>${escapeHtml(p.name)}</code></td>`,
        `<td>${p.components.length}</td>`,
        `<td>${p.directives.length}</td>`,
        `<td>${p.pipes.length}</td>`,
        `<td>${p.services.length}</td>`,
        `<td>${p.routes.length}</td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");

  const cyclesList =
    cycles.length > 0
      ? `<ul>${cycles
          .map((c) => `<li><code>${escapeHtml(c.metadata.nodes.join(" -> "))}</code></li>`)
          .join("\n")}</ul>`
      : "<p class=\"meta\">No cycles detected.</p>";

  const topHotspots = report.hotspotScores.slice(0, 10);
  const hotspotRows = topHotspots
    .map((h) => {
      return [
        "<tr>",
        `<td><code>${escapeHtml(h.filePath)}</code></td>`,
        `<td>${h.score}</td>`,
        `<td>${h.factors.complexity}</td>`,
        `<td>${h.factors.duplication}</td>`,
        `<td>${h.factors.missingSpec}</td>`,
        `<td>${h.factors.importFanIn}</td>`,
        `<td>${h.factors.importFanOut}</td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");

  const duplicateGroups = report.duplicateGroups.slice(0, 10);
  const duplicateRows = duplicateGroups
    .map((g) => {
      const sample = g.occurrences
        .slice(0, 5)
        .map((o) => `${o.filePath}:${o.startLine}-${o.endLine}`)
        .join(", ");
      return [
        "<tr>",
        `<td><code>${escapeHtml(g.kind)}</code></td>`,
        `<td>${g.occurrences.length}</td>`,
        `<td>${g.lineCount}</td>`,
        `<td>${g.tokenCount}</td>`,
        `<td><code>${escapeHtml(sample)}</code></td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "  <title>ng-inspector report</title>",
    "  <style>",
    "    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #0b1020; color: #eef2ff; }",
    "    .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 20px 60px; }",
    "    h1, h2 { margin: 0 0 16px; }",
    "    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 20px 0 28px; }",
    "    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 16px; }",
    "    .metric { font-size: 28px; font-weight: 700; margin-top: 6px; }",
    "    table { width: 100%; border-collapse: collapse; margin-top: 16px; }",
    "    th, td { text-align: left; vertical-align: top; padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }",
    "    th { color: #c7d2fe; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }",
    "    code { color: #c4b5fd; }",
    "    .meta-json { color: #a5b4fc; }",
    "    ul { margin: 0; padding-left: 18px; }",
    "    li { margin: 2px 0; }",
    "    .pill { display: inline-block; padding: 4px 8px; border-radius: 999px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }",
    "    .severity-error { background: rgba(248, 113, 113, 0.15); color: #fca5a5; }",
    "    .severity-warning { background: rgba(251, 191, 36, 0.15); color: #fcd34d; }",
    "    .severity-info { background: rgba(96, 165, 250, 0.15); color: #93c5fd; }",
    "    .section { margin-top: 34px; }",
    "    p.meta { color: #cbd5e1; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <div class=\"wrap\">",
    "    <h1>ng-inspector report</h1>",
    `    <p class="meta">Workspace: <code>${escapeHtml(report.workspaceRoot)}</code><br/>Generated: ${escapeHtml(
      report.generatedAt,
    )}</p>`,
    "",
    "    <div class=\"grid\">",
    `      <div class="card"><div>Total findings</div><div class="metric">${totalFindings}</div></div>`,
    `      <div class="card"><div>Errors</div><div class="metric">${severityCounts.error}</div></div>`,
    `      <div class="card"><div>Warnings</div><div class="metric">${severityCounts.warning}</div></div>`,
    `      <div class="card"><div>Info</div><div class="metric">${severityCounts.info}</div></div>`,
    `      <div class="card"><div>Projects</div><div class="metric">${report.projects.length}</div></div>`,
    `      <div class="card"><div>Components</div><div class="metric">${totalComponents}</div></div>`,
    `      <div class="card"><div>Directives</div><div class="metric">${totalDirectives}</div></div>`,
    `      <div class="card"><div>Pipes</div><div class="metric">${totalPipes}</div></div>`,
    `      <div class="card"><div>Services</div><div class="metric">${totalServices}</div></div>`,
    `      <div class="card"><div>Routes</div><div class="metric">${totalRoutes}</div></div>`,
    `      <div class="card"><div>Import nodes</div><div class="metric">${report.importGraph.nodes}</div></div>`,
    `      <div class="card"><div>Import cycles</div><div class="metric">${report.importGraph.cycles}</div></div>`,
    "    </div>",
    "",
    "    <section class=\"section\">",
    "      <h2>Top Hotspots</h2>",
    "      <table>",
    "        <thead>",
    "          <tr>",
    "            <th>File</th>",
    "            <th>Score</th>",
    "            <th>Complexity</th>",
    "            <th>Duplication</th>",
    "            <th>Missing Spec</th>",
    "            <th>Fan-In</th>",
    "            <th>Fan-Out</th>",
    "          </tr>",
    "        </thead>",
    "        <tbody>",
    hotspotRows || "<tr><td colspan=\"7\"><p class=\"meta\">No hotspot scores.</p></td></tr>",
    "        </tbody>",
    "      </table>",
    "    </section>",
    "",
    "    <section class=\"section\">",
    "      <h2>Duplicate Groups</h2>",
    "      <table>",
    "        <thead>",
    "          <tr>",
    "            <th>Kind</th>",
    "            <th>Occurrences</th>",
    "            <th>Lines</th>",
    "            <th>Tokens</th>",
    "            <th>Sample</th>",
    "          </tr>",
    "        </thead>",
    "        <tbody>",
    duplicateRows || "<tr><td colspan=\"5\"><p class=\"meta\">No duplicates detected.</p></td></tr>",
    "        </tbody>",
    "      </table>",
    "    </section>",
    "",
    "    <section class=\"section\">",
    "      <h2>Findings By Category</h2>",
    "      <table>",
    "        <thead>",
    "          <tr>",
    "            <th>Category</th>",
    "            <th>Total</th>",
    "            <th>Errors</th>",
    "            <th>Warnings</th>",
    "            <th>Info</th>",
    "          </tr>",
    "        </thead>",
    "        <tbody>",
    categoryRows || "<tr><td colspan=\"5\"><p class=\"meta\">No findings.</p></td></tr>",
    "        </tbody>",
    "      </table>",
    "    </section>",
    "",
    "    <section class=\"section\">",
    "      <h2>Findings</h2>",
    "      <table>",
    "        <thead>",
    "          <tr>",
    "            <th>Severity</th>",
    "            <th>Category</th>",
    "            <th>Code</th>",
    "            <th>File</th>",
    "            <th>Message</th>",
    "            <th>Why It Matters</th>",
    "            <th>Suggested Actions</th>",
    "            <th>Metadata</th>",
    "          </tr>",
    "        </thead>",
    "        <tbody>",
    findingsRows || "<tr><td colspan=\"8\"><p class=\"meta\">No findings.</p></td></tr>",
    "        </tbody>",
    "      </table>",
    "    </section>",
    "",
    "    <section class=\"section\">",
    "      <h2>Projects</h2>",
    "      <table>",
    "        <thead>",
    "          <tr>",
    "            <th>Name</th>",
    "            <th>Components</th>",
    "            <th>Directives</th>",
    "            <th>Pipes</th>",
    "            <th>Services</th>",
    "            <th>Routes</th>",
    "          </tr>",
    "        </thead>",
    "        <tbody>",
    projectRows || "<tr><td colspan=\"6\"><p class=\"meta\">No projects.</p></td></tr>",
    "        </tbody>",
    "      </table>",
    "    </section>",
    "",
    "    <section class=\"section\">",
    "      <h2>Import Graph</h2>",
    `      <p class="meta">Nodes: <code>${report.importGraph.nodes}</code> &middot; Edges: <code>${report.importGraph.edges}</code> &middot; Cycles: <code>${report.importGraph.cycles}</code></p>`,
    "    </section>",
    "",
    "    <section class=\"section\">",
    "      <h2>Cycles</h2>",
    cyclesList,
    "    </section>",
    "  </div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
