import path from "node:path";

import * as vscode from "vscode";

import { groupFindings } from "./model";
import { readAuditReport } from "./report";
import type { AnalyzerFinding, FindingSeverity } from "./types";

export type TreeNode = EmptyNode | SeverityNode | CodeNode | FindingNode;

interface EmptyNode {
  kind: "empty";
  label: string;
  description?: string;
}

interface SeverityNode {
  kind: "severity";
  severity: FindingSeverity;
  total: number;
}

interface CodeNode {
  kind: "code";
  severity: FindingSeverity;
  code: string;
  total: number;
}

interface FindingNode {
  kind: "finding";
  finding: AnalyzerFinding;
}

function severityLabel(sev: FindingSeverity): string {
  if (sev === "error") return "Errors";
  if (sev === "warning") return "Warnings";
  return "Info";
}

function severityIcon(sev: FindingSeverity): vscode.ThemeIcon {
  if (sev === "error") return new vscode.ThemeIcon("error");
  if (sev === "warning") return new vscode.ThemeIcon("warning");
  return new vscode.ThemeIcon("info");
}

export class FindingsTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private report: { findings: AnalyzerFinding[] } | null = null;
  private lastWorkspaceRootAbs: string | null = null;

  constructor(private readonly output: vscode.OutputChannel) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async reload(workspaceRootAbs: string): Promise<void> {
    this.lastWorkspaceRootAbs = workspaceRootAbs;
    this.report = await readAuditReport(workspaceRootAbs);
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === "empty") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.contextValue = "ngInspector.empty";
      return item;
    }

    if (element.kind === "severity") {
      const item = new vscode.TreeItem(`${severityLabel(element.severity)} (${element.total})`, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = severityIcon(element.severity);
      item.contextValue = "ngInspector.severity";
      return item;
    }

    if (element.kind === "code") {
      const item = new vscode.TreeItem(`${element.code} (${element.total})`, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "ngInspector.code";
      return item;
    }

    const f = element.finding;
    const label = f.message.length > 120 ? `${f.message.slice(0, 117)}...` : f.message;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = f.filePath;
    item.tooltip = `${f.code} (${f.severity})\n${f.filePath}`;
    item.iconPath = severityIcon(f.severity);
    item.contextValue = "ngInspector.finding";

    if (this.lastWorkspaceRootAbs) {
      const abs = path.resolve(this.lastWorkspaceRootAbs, f.filePath.replace(/\//g, path.sep));
      const rel = path.relative(this.lastWorkspaceRootAbs, abs);
      const staysInWorkspace = rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
      if (staysInWorkspace) {
        const uri = vscode.Uri.file(abs);
        item.command = {
          command: "vscode.open",
          title: "Open File",
          arguments: [uri],
        };
      }
    }

    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const findings = this.report?.findings ?? null;

    if (!findings) {
      return [
        {
          kind: "empty",
          label: "No ng-inspector report found.",
          description: "Run: ng-inspector: Run Audit",
        },
      ];
    }

    const grouped = groupFindings(findings);

    if (!element) {
      if (grouped.length === 0) return [{ kind: "empty", label: "No findings." }];
      return grouped.map((g) => ({ kind: "severity", severity: g.severity, total: g.total }));
    }

    if (element.kind === "severity") {
      const g = grouped.find((x) => x.severity === element.severity);
      if (!g) return [];
      return g.byCode.map((c) => ({ kind: "code", severity: g.severity, code: c.code, total: c.total }));
    }

    if (element.kind === "code") {
      const g = grouped.find((x) => x.severity === element.severity);
      const c = g?.byCode.find((x) => x.code === element.code);
      if (!c) return [];
      return c.findings.map((finding) => ({ kind: "finding", finding }));
    }

    return [];
  }

  logReportError(message: string): void {
    this.output.appendLine(`[report] ${message}`);
  }
}
