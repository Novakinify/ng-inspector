import path from "node:path";

import type {
  DiscoveredFile,
  DiscoveredRoute,
  ProjectReport,
  ProjectTree,
  ProjectTreeFile,
  ProjectTreeFolder,
  ProjectTreeProject,
  ProjectTreeSourceRoot,
  SymbolIndex,
} from "./types";

function normalizePosixPath(p: string): string {
  let out = p.trim().replace(/\\/g, "/");
  if (out.startsWith("./")) out = out.slice(2);
  if (out.startsWith("/")) out = out.slice(1);
  out = out.replace(/\/+$/g, "");
  return out;
}

function createEmptyFolder(folderPath: string): ProjectTreeFolder {
  return {
    path: folderPath,
    folders: [],
    files: [],
    components: [],
    directives: [],
    pipes: [],
    services: [],
    routes: [],
  };
}

function getOrCreateChildFolder(parent: ProjectTreeFolder, childName: string): ProjectTreeFolder {
  const childPath = normalizePosixPath(path.posix.join(parent.path, childName));
  const existing = parent.folders.find((f) => f.path === childPath);
  if (existing) return existing;

  const created = createEmptyFolder(childPath);
  parent.folders.push(created);
  return created;
}

function stableSortFolder(folder: ProjectTreeFolder): void {
  folder.folders.sort((a, b) => a.path.localeCompare(b.path));
  folder.files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  folder.components.sort((a, b) => a.filePath.localeCompare(b.filePath));
  folder.directives.sort((a, b) => a.filePath.localeCompare(b.filePath));
  folder.pipes.sort((a, b) => a.filePath.localeCompare(b.filePath));
  folder.services.sort((a, b) => a.filePath.localeCompare(b.filePath));
  folder.routes.sort((a, b) => (a.filePath + a.path).localeCompare(b.filePath + b.path));

  for (const child of folder.folders) stableSortFolder(child);
}

function insertIntoFolderTree<T extends DiscoveredFile | DiscoveredRoute>(
  root: ProjectTreeFolder,
  sourceRootPosix: string,
  item: T,
  kind: "components" | "directives" | "pipes" | "services" | "routes",
): void {
  const filePath = normalizePosixPath(item.filePath);
  const sourceRoot = normalizePosixPath(sourceRootPosix);

  const dir = normalizePosixPath(path.posix.dirname(filePath));
  const relDir = normalizePosixPath(path.posix.relative(sourceRoot, dir));

  const segments =
    relDir.length === 0 || relDir === "."
      ? []
      : relDir.startsWith("..")
        ? []
        : relDir.split("/").filter((s) => s.length > 0);

  let current = root;
  for (const seg of segments) current = getOrCreateChildFolder(current, seg);

  if (kind === "routes") current.routes.push(item as DiscoveredRoute);
  else current[kind].push(item as DiscoveredFile);
}

function buildSourceRootTree(sourceRootPosix: string, project: ProjectReport): ProjectTreeSourceRoot {
  const sourceRoot = normalizePosixPath(sourceRootPosix);
  const rootFolder = createEmptyFolder(sourceRoot);

  for (const f of project.components) insertIntoFolderTree(rootFolder, sourceRoot, f, "components");
  for (const f of project.directives) insertIntoFolderTree(rootFolder, sourceRoot, f, "directives");
  for (const f of project.pipes) insertIntoFolderTree(rootFolder, sourceRoot, f, "pipes");
  for (const f of project.services) insertIntoFolderTree(rootFolder, sourceRoot, f, "services");
  for (const r of project.routes) insertIntoFolderTree(rootFolder, sourceRoot, r, "routes");

  stableSortFolder(rootFolder);
  return { sourceRoot, rootFolder };
}

export interface BuildProjectTreeOptions {
  /**
   * Workspace-relative (posix) file paths that should be included in the tree (optional).
   */
  filePaths?: string[];
  /**
   * Optional symbol index. When provided alongside `filePaths`, files will link to classes/methods.
   */
  symbols?: SymbolIndex;
}

function fileIsUnderSourceRoot(filePath: string, sourceRootPosix: string): boolean {
  const file = normalizePosixPath(filePath);
  const root = normalizePosixPath(sourceRootPosix);
  return file === root || file.startsWith(root + "/");
}

function getOrCreateFile(folder: ProjectTreeFolder, file: ProjectTreeFile): void {
  // Avoid duplicates; keep first insert (stable).
  if (folder.files.some((f) => f.filePath === file.filePath)) return;
  folder.files.push(file);
}

function insertFileIntoFolderTree(root: ProjectTreeFolder, sourceRootPosix: string, file: ProjectTreeFile): void {
  const filePath = normalizePosixPath(file.filePath);
  const sourceRoot = normalizePosixPath(sourceRootPosix);

  const dir = normalizePosixPath(path.posix.dirname(filePath));
  const relDir = normalizePosixPath(path.posix.relative(sourceRoot, dir));

  const segments =
    relDir.length === 0 || relDir === "."
      ? []
      : relDir.startsWith("..")
        ? []
        : relDir.split("/").filter((s) => s.length > 0);

  let current = root;
  for (const seg of segments) current = getOrCreateChildFolder(current, seg);

  getOrCreateFile(current, file);
}

function buildFilesForProject(sourceRoot: string, filePaths: string[], symbols: SymbolIndex | undefined): ProjectTreeFile[] {
  if (!symbols) return [];

  const methodIdsByClassId = new Map<string, string[]>();
  for (const m of symbols.methods) {
    const arr = methodIdsByClassId.get(m.classId) ?? [];
    if (!methodIdsByClassId.has(m.classId)) methodIdsByClassId.set(m.classId, arr);
    arr.push(m.id);
  }

  const classesByFile = new Map<string, ProjectTreeFile["classes"]>();
  for (const c of symbols.classes) {
    if (!fileIsUnderSourceRoot(c.filePath, sourceRoot)) continue;
    const methods = (methodIdsByClassId.get(c.id) ?? []).slice().sort((a, b) => a.localeCompare(b));
    const entry = classesByFile.get(c.filePath) ?? [];
    if (!classesByFile.has(c.filePath)) classesByFile.set(c.filePath, entry);
    entry.push({ classId: c.id, methodIds: methods });
  }

  const out: ProjectTreeFile[] = [];
  for (const fp of filePaths) {
    if (!fileIsUnderSourceRoot(fp, sourceRoot)) continue;
    const classes = classesByFile.get(fp);
    if (!classes || classes.length === 0) continue;
    out.push({ filePath: fp, classes: classes.slice().sort((a, b) => a.classId.localeCompare(b.classId)) });
  }

  out.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return out;
}

export function buildProjectTree(projects: ProjectReport[], options?: BuildProjectTreeOptions): ProjectTree {
  const outProjects: ProjectTreeProject[] = [];
  const allFiles = options?.filePaths ?? [];

  for (const p of projects) {
    const sourceRoots: ProjectTreeSourceRoot[] = [];
    if (p.sourceRoot && p.sourceRoot.trim().length) {
      const tree = buildSourceRootTree(p.sourceRoot, p);
      const files = buildFilesForProject(p.sourceRoot, allFiles, options?.symbols);
      for (const f of files) insertFileIntoFolderTree(tree.rootFolder, p.sourceRoot, f);
      stableSortFolder(tree.rootFolder);
      sourceRoots.push(tree);
    }

    outProjects.push({
      name: p.name,
      root: p.root,
      sourceRoot: p.sourceRoot,
      sourceRoots,
    });
  }

  outProjects.sort((a, b) => a.name.localeCompare(b.name));
  return { projects: outProjects };
}
