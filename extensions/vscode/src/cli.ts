import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface CliInvocation {
  command: string;
  args: string[];
  cwd: string;
  shell?: boolean;
}

function fileExists(absPath: string): boolean {
  try {
    return fs.existsSync(absPath);
  } catch {
    return false;
  }
}

export function resolveNgInspectorCli(workspaceRootAbs: string): CliInvocation {
  const commonArgs = ["audit", "--workspace", workspaceRootAbs];

  // 1) Prefer a workspace-installed CLI dependency.
  const nodeModulesCliAbs = path.join(workspaceRootAbs, "node_modules", "ng-inspector", "dist", "bin.js");
  if (fileExists(nodeModulesCliAbs)) {
    return { command: process.execPath, args: [nodeModulesCliAbs, ...commonArgs], cwd: workspaceRootAbs };
  }

  // 2) Monorepo dev fallback (this repo).
  const monorepoCliAbs = path.join(workspaceRootAbs, "packages", "cli", "dist", "bin.js");
  if (fileExists(monorepoCliAbs)) {
    return { command: process.execPath, args: [monorepoCliAbs, ...commonArgs], cwd: workspaceRootAbs };
  }

  // 3) As a last resort, try PATH (may require global install).
  return { command: "ng-inspector", args: commonArgs, cwd: workspaceRootAbs, shell: true };
}

export interface RunCliOptions {
  invocation: CliInvocation;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

function splitIntoLines(chunk: Buffer | string): string[] {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
}

export async function runCli(options: RunCliOptions): Promise<{ exitCode: number }> {
  const child = spawn(options.invocation.command, options.invocation.args, {
    cwd: options.invocation.cwd,
    shell: options.invocation.shell ?? false,
    windowsHide: true,
  });

  child.stdout?.on("data", (d) => {
    for (const line of splitIntoLines(d)) options.onStdoutLine?.(line);
  });
  child.stderr?.on("data", (d) => {
    for (const line of splitIntoLines(d)) options.onStderrLine?.(line);
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });

  return { exitCode };
}

