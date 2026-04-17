import path from "node:path";

export function toWorkspaceRelativePosixPath(workspaceRootAbs: string, fileAbs: string): string {
  const rel = path.relative(workspaceRootAbs, fileAbs);
  return rel.split(path.sep).join("/");
}

