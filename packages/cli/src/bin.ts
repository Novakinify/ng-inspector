#!/usr/bin/env node
/* eslint-disable no-console */

import { parseCliArgs } from "./args";
import { runAuditCommand } from "./commands/audit";
import { printHelp } from "./help";
import { readCliVersion } from "./version";

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    console.error("");
    printHelp();
    process.exitCode = 1;
    return;
  }

  const args = parsed.value;
  if (!args) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (args.kind === "help") {
    printHelp();
    return;
  }

  if (args.kind === "version") {
    console.log(readCliVersion());
    return;
  }

  if (args.kind === "audit") {
    const result = await runAuditCommand({ workspaceRoot: args.workspaceRoot });
    console.log(result.reportPathAbs);
    console.log(result.htmlPathAbs);
    return;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
