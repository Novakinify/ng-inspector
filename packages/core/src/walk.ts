import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".angular",
  ".git",
  "coverage",
  ".ng-inspector",
  "out-tsc",
]);

export async function* walkFiles(rootDirAbs: string): AsyncGenerator<string> {
  const stack: string[] = [rootDirAbs];

  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Ignore unreadable directories.
      continue;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (entry.isFile()) yield abs;
    }
  }
}
