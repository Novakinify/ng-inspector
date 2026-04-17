import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import { detectAngularArtifacts } from "./angular-artifacts";
import { extractRoutePaths } from "./angular-routes";
import { toWorkspaceRelativePosixPath } from "./path";
import { walkFiles } from "./walk";
import type { DiscoveredFile, DiscoveredRoute } from "./types";

export interface DiscoverOptions {
  workspaceRootAbs: string;
  sourceRootAbs: string;
  isExcludedPath?: (workspaceRelPosixPath: string) => boolean;
}

export interface DiscoverResult {
  components: DiscoveredFile[];
  directives: DiscoveredFile[];
  pipes: DiscoveredFile[];
  services: DiscoveredFile[];
  routes: DiscoveredRoute[];
}

function isAnalyzableTsFile(absPath: string): boolean {
  if (!absPath.endsWith(".ts")) return false;
  if (absPath.endsWith(".d.ts")) return false;
  if (absPath.endsWith(".spec.ts")) return false;
  return true;
}

export async function discoverInSourceRoot(options: DiscoverOptions): Promise<DiscoverResult> {
  const components: DiscoveredFile[] = [];
  const directives: DiscoveredFile[] = [];
  const pipes: DiscoveredFile[] = [];
  const services: DiscoveredFile[] = [];
  const routes: DiscoveredRoute[] = [];

  for await (const fileAbs of walkFiles(options.sourceRootAbs)) {
    if (!isAnalyzableTsFile(fileAbs)) continue;

    const baseName = path.basename(fileAbs);
    const fileRel = toWorkspaceRelativePosixPath(options.workspaceRootAbs, fileAbs);
    if (options.isExcludedPath?.(fileRel)) continue;

    const text = await fs.readFile(fileAbs, "utf8");
    const sourceFile = ts.createSourceFile(fileAbs, text, ts.ScriptTarget.Latest, true);

    const artifacts = detectAngularArtifacts(sourceFile);
    if (artifacts.hasComponent) components.push({ filePath: fileRel });
    if (artifacts.hasDirective) directives.push({ filePath: fileRel });
    if (artifacts.hasPipe) pipes.push({ filePath: fileRel });
    if (artifacts.hasInjectable) services.push({ filePath: fileRel });

    const isRoutesFile = baseName.endsWith(".routes.ts") || baseName.endsWith("-routing.module.ts");
    if (isRoutesFile) {
      const paths = extractRoutePaths(sourceFile);
      for (const routePath of paths) routes.push({ filePath: fileRel, path: routePath });
    }
  }

  // Keep output stable.
  components.sort((a, b) => a.filePath.localeCompare(b.filePath));
  directives.sort((a, b) => a.filePath.localeCompare(b.filePath));
  pipes.sort((a, b) => a.filePath.localeCompare(b.filePath));
  services.sort((a, b) => a.filePath.localeCompare(b.filePath));
  routes.sort((a, b) => (a.filePath + a.path).localeCompare(b.filePath + b.path));

  return { components, directives, pipes, services, routes };
}
