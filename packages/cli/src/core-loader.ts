import fs from "node:fs";
import path from "node:path";

import type * as Core from "@ng-inspector/core";

function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadCoreModule(): typeof Core {
  // Prefer the real dependency when installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@ng-inspector/core") as typeof Core;
  } catch {
    // Local dev fallback: monorepo sibling path.
    const cliRoot = findPackageRoot(__dirname);
    if (!cliRoot) throw new Error("Could not locate CLI package root for core module fallback.");

    const coreEntry = path.resolve(cliRoot, "..", "core", "dist", "index.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(coreEntry) as typeof Core;
  }
}

