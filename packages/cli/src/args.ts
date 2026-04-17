export interface AuditArgs {
  kind: "audit";
  workspaceRoot: string;
}

export interface HelpArgs {
  kind: "help";
}

export interface VersionArgs {
  kind: "version";
}

export type ParsedArgs = AuditArgs | HelpArgs | VersionArgs;

export interface ParseResult {
  value?: ParsedArgs;
  error?: string;
}

function takeValue(token: string, args: string[]): string | undefined {
  const idx = token.indexOf("=");
  if (idx >= 0) return token.slice(idx + 1);
  return args.shift();
}

export function parseCliArgs(argv: string[]): ParseResult {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) return { value: { kind: "help" } };
  if (args.includes("--version") || args.includes("-v")) return { value: { kind: "version" } };

  const command = args.shift();
  if (!command) return { error: "Missing command. Expected: audit" };
  if (command !== "audit") return { error: `Unknown command: ${command}` };

  let workspaceRoot = process.cwd();

  while (args.length) {
    const token = args.shift();
    if (!token) break;

    if (token === "--workspace" || token === "-w" || token.startsWith("--workspace=")) {
      const value = takeValue(token, args);
      if (!value) return { error: "Missing value for --workspace" };
      workspaceRoot = value;
      continue;
    }

    return { error: `Unknown argument: ${token}` };
  }

  return { value: { kind: "audit", workspaceRoot } };
}

