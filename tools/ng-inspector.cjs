#!/usr/bin/env node
/* eslint-disable no-console */

const path = require("path");

function readVersion() {
  try {
    // tools/ -> project root
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, "..", "package.json")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp() {
  console.log(
    [
      "ng-inspector (bootstrap)",
      "",
      "Usage:",
      "  ng-inspector --workspace <path> --out <file>",
      "",
      "Options:",
      "  -w, --workspace   Path to Angular workspace folder (contains angular.json)",
      "  -o, --out         Output report file path (HTML)",
      "  --version         Print version",
      "  --help            Show help",
      "",
      "Examples:",
      "  ng-inspector --workspace C:\\\\src\\\\my-app --out report.html",
      "  ng-inspector -w . -o .\\\\ng-inspector-report.html",
    ].join("\n"),
  );
}

function die(message) {
  console.error(`Error: ${message}`);
  console.error("");
  printHelp();
  process.exitCode = 1;
}

function parseArgs(argv) {
  const out = {
    workspace: undefined,
    reportOut: undefined,
    help: false,
    version: false,
  };

  const args = [...argv];
  while (args.length) {
    const token = args.shift();
    if (!token) break;

    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (token === "--version" || token === "-v") {
      out.version = true;
      continue;
    }

    const assignIdx = token.indexOf("=");
    const flag = assignIdx >= 0 ? token.slice(0, assignIdx) : token;
    const assigned = assignIdx >= 0 ? token.slice(assignIdx + 1) : undefined;

    if (flag === "--workspace" || flag === "-w") {
      const value = assigned ?? args.shift();
      if (!value) return { error: "Missing value for --workspace" };
      out.workspace = value;
      continue;
    }

    if (flag === "--out" || flag === "-o") {
      const value = assigned ?? args.shift();
      if (!value) return { error: "Missing value for --out" };
      out.reportOut = value;
      continue;
    }

    return { error: `Unknown argument: ${token}` };
  }

  return { value: out };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) return die(parsed.error);

  const args = parsed.value;
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(readVersion());
    return;
  }

  if (!args.workspace) return die("Required: --workspace <path>");
  if (!args.reportOut) return die("Required: --out <file>");

  console.log(
    [
      "ng-inspector bootstrap OK.",
      `workspace: ${args.workspace}`,
      `out: ${args.reportOut}`,
      "",
      "Next: implement analyzers + HTML rendering.",
    ].join("\n"),
  );
}

main();

