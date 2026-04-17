import fs from "node:fs";
import path from "node:path";

function tryReadJson(fileAbs: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(fileAbs, "utf8"));
  } catch {
    return null;
  }
}

export function readCliVersion(): string {
  const pkgAbs = path.join(__dirname, "..", "package.json");
  const parsed = tryReadJson(pkgAbs);
  if (!parsed || typeof parsed !== "object") return "0.0.0";
  const version = (parsed as { version?: unknown }).version;
  return typeof version === "string" ? version : "0.0.0";
}

