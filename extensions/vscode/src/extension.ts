import * as vscode from "vscode";

import { resolveNgInspectorCli, runCli } from "./cli";
import { reportHtmlPathAbs } from "./report";
import { FindingsTreeDataProvider } from "./tree";

const VIEW_ID = "ngInspector.findingsView";

function getWorkspaceRootAbs(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0]?.uri.fsPath ?? null;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    return true;
  } catch {
    return false;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("ng-inspector");
  const provider = new FindingsTreeDataProvider(output);

  context.subscriptions.push(output);
  context.subscriptions.push(vscode.window.registerTreeDataProvider(VIEW_ID, provider));

  const refresh = async () => {
    const workspaceRootAbs = getWorkspaceRootAbs();
    if (!workspaceRootAbs) {
      vscode.window.showInformationMessage("ng-inspector: Open a folder/workspace to view findings.");
      return;
    }
    await provider.reload(workspaceRootAbs);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("ngInspector.refreshFindings", async () => {
      await refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ngInspector.runAudit", async () => {
      const workspaceRootAbs = getWorkspaceRootAbs();
      if (!workspaceRootAbs) {
        vscode.window.showErrorMessage("ng-inspector: No workspace folder is open.");
        return;
      }

      const invocation = resolveNgInspectorCli(workspaceRootAbs);
      output.show(true);
      output.appendLine(`[run] ${invocation.command} ${invocation.args.join(" ")}`);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "ng-inspector: Running audit",
          cancellable: false,
        },
        async () => {
          const result = await runCli({
            invocation,
            onStdoutLine: (l) => output.appendLine(l),
            onStderrLine: (l) => output.appendLine(`[stderr] ${l}`),
          });
          if (result.exitCode !== 0) {
            vscode.window.showErrorMessage(
              `ng-inspector audit failed (exit code ${result.exitCode}). See the ng-inspector output for details.`,
            );
          }
        },
      );

      await refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ngInspector.openHtmlReport", async () => {
      const workspaceRootAbs = getWorkspaceRootAbs();
      if (!workspaceRootAbs) {
        vscode.window.showErrorMessage("ng-inspector: No workspace folder is open.");
        return;
      }

      const htmlPath = reportHtmlPathAbs(workspaceRootAbs);
      if (!(await fileExists(htmlPath))) {
        vscode.window.showInformationMessage("ng-inspector: report.html not found. Run an audit first.");
        return;
      }

      const uri = vscode.Uri.file(htmlPath);
      const opened = await vscode.env.openExternal(uri);
      if (!opened) {
        await vscode.commands.executeCommand("vscode.open", uri);
      }
    }),
  );

  // Initial load (best-effort).
  void refresh().catch((err) => {
    output.appendLine(`[init] ${String(err)}`);
  });
}

export function deactivate(): void {
  // no-op
}
