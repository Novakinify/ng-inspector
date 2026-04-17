import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { EmptyStateComponent } from "../ui/empty-state.component";
import { ReportStoreService } from "../state/report-store.service";
import type {
  AuditReport,
  ClassSymbol,
  DuplicateGroup,
  HotspotScore,
  MethodReference,
  MethodSymbol,
  ProjectTreeFile,
  ProjectTreeFolder,
  ProjectTreeProject,
  ProjectTreeSourceRoot
} from "../lib/report-schema";

type DrilldownRow =
  | {
      id: string;
      kind: "project";
      depth: number;
      label: string;
      hasChildren: boolean;
      meta?: string;
      projectName: string;
    }
  | {
      id: string;
      kind: "sourceRoot";
      depth: number;
      label: string;
      hasChildren: boolean;
      meta?: string;
      projectName: string;
      sourceRoot: string;
    }
  | {
      id: string;
      kind: "folder";
      depth: number;
      label: string;
      hasChildren: boolean;
      meta?: string;
      projectName: string;
      sourceRoot: string;
      folderPath: string;
    }
  | {
      id: string;
      kind: "file";
      depth: number;
      label: string;
      hasChildren: boolean;
      meta?: string;
      filePath: string;
    }
  | {
      id: string;
      kind: "class";
      depth: number;
      label: string;
      hasChildren: boolean;
      meta?: string;
      classId: string;
    }
  | {
      id: string;
      kind: "method";
      depth: number;
      label: string;
      hasChildren: false;
      meta?: string;
      methodId: string;
    };

type DrilldownSelection =
  | { id: string; kind: "project"; projectName: string }
  | { id: string; kind: "sourceRoot"; projectName: string; sourceRoot: string }
  | { id: string; kind: "folder"; projectName: string; sourceRoot: string; folderPath: string }
  | { id: string; kind: "file"; filePath: string }
  | { id: string; kind: "class"; classId: string }
  | { id: string; kind: "method"; methodId: string };

type DetailPanelModel =
  | { kind: "empty" }
  | { kind: "missing"; title: string; message: string }
  | { kind: "project"; project: ProjectTreeProject }
  | { kind: "sourceRoot"; project: ProjectTreeProject; sourceRoot: ProjectTreeSourceRoot }
  | { kind: "folder"; folder: ProjectTreeFolder; counts: FolderCounts }
  | { kind: "file"; file: ProjectTreeFile; classes: ClassSymbol[]; methods: MethodSymbol[]; hotspot: HotspotScore | null }
  | { kind: "class"; classSymbol: ClassSymbol; methods: MethodSymbol[] }
  | { kind: "method"; method: MethodSymbol; duplicates: DuplicateGroup[]; references: MethodReference[] };

interface FolderCounts {
  folders: number;
  files: number;
  classes: number;
  methods: number;
}

interface DrilldownIndex {
  projectsByName: Map<string, ProjectTreeProject>;
  sourceRootsByKey: Map<string, ProjectTreeSourceRoot>;
  foldersByKey: Map<string, ProjectTreeFolder>;
  filesByPath: Map<string, ProjectTreeFile>;
  classById: Map<string, ClassSymbol>;
  methodById: Map<string, MethodSymbol>;
  methodsByClassId: Map<string, MethodSymbol[]>;
  refsByMethodId: Map<string, MethodReference[]>;
  dupGroupsByMethodId: Map<string, DuplicateGroup[]>;
  hotspotByFilePath: Map<string, HotspotScore>;
}

function idProject(projectName: string): string {
  return `proj:${projectName}`;
}

function idSourceRoot(projectName: string, sourceRoot: string): string {
  return `sr:${projectName}:${sourceRoot}`;
}

function idFolder(projectName: string, sourceRoot: string, folderPath: string): string {
  return `folder:${projectName}:${sourceRoot}:${folderPath}`;
}

function idFile(filePath: string): string {
  return `file:${filePath}`;
}

function sourceRootKey(projectName: string, sourceRoot: string): string {
  return `${projectName}::${sourceRoot}`;
}

function folderKey(projectName: string, sourceRoot: string, folderPath: string): string {
  return `${projectName}::${sourceRoot}::${folderPath}`;
}

function baseName(p: string): string {
  const posix = p.replace(/\\/g, "/");
  const parts = posix.split("/").filter((x) => x.length > 0);
  return parts.length ? (parts[parts.length - 1] as string) : p;
}

function formatMethodMeta(m: MethodSymbol | null): string | undefined {
  if (!m) return undefined;
  const { lineCount, branchCount, parameterCount } = m.metrics;
  return `${lineCount}L ${branchCount}Br ${parameterCount}P`;
}

function countFileMethods(file: ProjectTreeFile): number {
  let sum = 0;
  for (const c of file.classes) sum += c.methodIds.length;
  return sum;
}

function indexFolderTree(
  projectName: string,
  sourceRoot: string,
  folder: ProjectTreeFolder,
  foldersByKey: Map<string, ProjectTreeFolder>,
  filesByPath: Map<string, ProjectTreeFile>
): void {
  foldersByKey.set(folderKey(projectName, sourceRoot, folder.path), folder);
  for (const f of folder.files) {
    if (!filesByPath.has(f.filePath)) filesByPath.set(f.filePath, f);
  }
  for (const child of folder.folders) indexFolderTree(projectName, sourceRoot, child, foldersByKey, filesByPath);
}

function buildIndex(report: AuditReport | null): DrilldownIndex {
  const projectsByName = new Map<string, ProjectTreeProject>();
  const sourceRootsByKey = new Map<string, ProjectTreeSourceRoot>();
  const foldersByKey = new Map<string, ProjectTreeFolder>();
  const filesByPath = new Map<string, ProjectTreeFile>();
  const classById = new Map<string, ClassSymbol>();
  const methodById = new Map<string, MethodSymbol>();
  const methodsByClassId = new Map<string, MethodSymbol[]>();
  const refsByMethodId = new Map<string, MethodReference[]>();
  const dupGroupsByMethodId = new Map<string, DuplicateGroup[]>();
  const hotspotByFilePath = new Map<string, HotspotScore>();

  if (!report) {
    return {
      projectsByName,
      sourceRootsByKey,
      foldersByKey,
      filesByPath,
      classById,
      methodById,
      methodsByClassId,
      refsByMethodId,
      dupGroupsByMethodId,
      hotspotByFilePath
    };
  }

  for (const p of report.projectTree.projects) projectsByName.set(p.name, p);

  for (const p of report.projectTree.projects) {
    for (const sr of p.sourceRoots) {
      sourceRootsByKey.set(sourceRootKey(p.name, sr.sourceRoot), sr);
      indexFolderTree(p.name, sr.sourceRoot, sr.rootFolder, foldersByKey, filesByPath);
    }
  }

  for (const c of report.symbols.classes) classById.set(c.id, c);

  for (const m of report.symbols.methods) {
    methodById.set(m.id, m);
    const arr = methodsByClassId.get(m.classId) ?? [];
    if (!methodsByClassId.has(m.classId)) methodsByClassId.set(m.classId, arr);
    arr.push(m);
  }
  for (const [classId, methods] of methodsByClassId) {
    methods.sort((a, b) => (a.name + a.id).localeCompare(b.name + b.id));
    methodsByClassId.set(classId, methods);
  }

  for (const ref of report.methodReferences) {
    const arr = refsByMethodId.get(ref.methodId) ?? [];
    if (!refsByMethodId.has(ref.methodId)) refsByMethodId.set(ref.methodId, arr);
    arr.push(ref);
  }
  for (const [methodId, refs] of refsByMethodId) {
    refs.sort((a, b) => (a.filePath + a.line).localeCompare(b.filePath + b.line));
    refsByMethodId.set(methodId, refs);
  }

  for (const g of report.duplicateGroups) {
    for (const occ of g.occurrences) {
      if (!occ.methodId) continue;
      const arr = dupGroupsByMethodId.get(occ.methodId) ?? [];
      if (!dupGroupsByMethodId.has(occ.methodId)) dupGroupsByMethodId.set(occ.methodId, arr);
      arr.push(g);
    }
  }
  for (const [methodId, groups] of dupGroupsByMethodId) {
    const unique = new Map<string, DuplicateGroup>();
    for (const g of groups) unique.set(g.id, g);
    dupGroupsByMethodId.set(
      methodId,
      Array.from(unique.values()).sort((a, b) => (b.lineCount - a.lineCount) || a.id.localeCompare(b.id))
    );
  }

  for (const h of report.hotspotScores) hotspotByFilePath.set(h.filePath, h);

  return {
    projectsByName,
    sourceRootsByKey,
    foldersByKey,
    filesByPath,
    classById,
    methodById,
    methodsByClassId,
    refsByMethodId,
    dupGroupsByMethodId,
    hotspotByFilePath
  };
}

function buildRows(report: AuditReport, expanded: Set<string>, idx: DrilldownIndex): DrilldownRow[] {
  const rows: DrilldownRow[] = [];

  for (const p of report.projectTree.projects) {
    const pid = idProject(p.name);
    rows.push({
      id: pid,
      kind: "project",
      depth: 0,
      label: p.name,
      hasChildren: p.sourceRoots.length > 0,
      meta: `${p.sourceRoots.length} src`,
      projectName: p.name
    });

    if (!expanded.has(pid)) continue;

    for (const sr of p.sourceRoots) {
      const srid = idSourceRoot(p.name, sr.sourceRoot);
      const rootFolder = sr.rootFolder;
      const rootChildCount = rootFolder.folders.length + rootFolder.files.length;

      rows.push({
        id: srid,
        kind: "sourceRoot",
        depth: 1,
        label: sr.sourceRoot,
        hasChildren: rootChildCount > 0,
        meta: `${rootChildCount} items`,
        projectName: p.name,
        sourceRoot: sr.sourceRoot
      });

      if (!expanded.has(srid)) continue;

      // Show children of the root folder under the sourceRoot row (avoid duplicating the root folder itself).
      appendFolderChildren(p.name, sr.sourceRoot, rootFolder, 2, rows, expanded, idx);
    }
  }

  return rows;
}

function appendFolderChildren(
  projectName: string,
  sourceRoot: string,
  folder: ProjectTreeFolder,
  depth: number,
  out: DrilldownRow[],
  expanded: Set<string>,
  idx: DrilldownIndex
): void {
  for (const child of folder.folders) {
    const fid = idFolder(projectName, sourceRoot, child.path);
    const childCount = child.folders.length + child.files.length;

    out.push({
      id: fid,
      kind: "folder",
      depth,
      label: baseName(child.path),
      hasChildren: childCount > 0,
      meta: `${childCount} items`,
      projectName,
      sourceRoot,
      folderPath: child.path
    });

    if (expanded.has(fid)) appendFolderChildren(projectName, sourceRoot, child, depth + 1, out, expanded, idx);
  }

  for (const file of folder.files) {
    const fileId = idFile(file.filePath);
    const classCount = file.classes.length;
    const methodCount = countFileMethods(file);

    out.push({
      id: fileId,
      kind: "file",
      depth,
      label: baseName(file.filePath),
      hasChildren: classCount > 0,
      meta: `${classCount}C ${methodCount}M`,
      filePath: file.filePath
    });

    if (!expanded.has(fileId)) continue;

    for (const c of file.classes) {
      const cs = idx.classById.get(c.classId) ?? null;
      const methodCount2 = c.methodIds.length;

      out.push({
        id: c.classId,
        kind: "class",
        depth: depth + 1,
        label: cs?.name ?? c.classId,
        hasChildren: methodCount2 > 0,
        meta: `${methodCount2}M`,
        classId: c.classId
      });

      if (!expanded.has(c.classId)) continue;

      for (const methodId of c.methodIds) {
        const ms = idx.methodById.get(methodId) ?? null;
        out.push({
          id: methodId,
          kind: "method",
          depth: depth + 2,
          label: ms?.name ?? methodId,
          hasChildren: false,
          meta: formatMethodMeta(ms),
          methodId
        });
      }
    }
  }
}

function countFolder(folder: ProjectTreeFolder): FolderCounts {
  const counts: FolderCounts = { folders: 0, files: 0, classes: 0, methods: 0 };

  function walk(f: ProjectTreeFolder): void {
    counts.folders += f.folders.length;
    counts.files += f.files.length;
    for (const file of f.files) {
      counts.classes += file.classes.length;
      for (const c of file.classes) counts.methods += c.methodIds.length;
    }
    for (const child of f.folders) walk(child);
  }

  walk(folder);
  return counts;
}

@Component({
  selector: "ngi-project-tree-page",
  standalone: true,
  imports: [EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./project-tree.page.html",
  styleUrl: "./project-tree.page.css"
})
export class ProjectTreePageComponent {
  private readonly store = inject(ReportStoreService);
  private readonly route = inject(ActivatedRoute);

  readonly report = this.store.report;

  readonly expanded = signal<Set<string>>(new Set<string>());
  readonly selected = signal<DrilldownSelection | null>(null);

  private readonly idx = computed(() => buildIndex(this.report()));

  readonly rows = computed<DrilldownRow[]>(() => {
    const r = this.report();
    if (!r) return [];
    return buildRows(r, this.expanded(), this.idx());
  });

  readonly detail = computed<DetailPanelModel>(() => {
    const r = this.report();
    const sel = this.selected();
    if (!r) return { kind: "empty" };
    if (!sel) return { kind: "empty" };

    const idx = this.idx();

    if (sel.kind === "project") {
      const project = idx.projectsByName.get(sel.projectName) ?? null;
      if (!project) return { kind: "missing", title: "Project not found", message: sel.projectName };
      return { kind: "project", project };
    }

    if (sel.kind === "sourceRoot") {
      const project = idx.projectsByName.get(sel.projectName) ?? null;
      const sr = idx.sourceRootsByKey.get(sourceRootKey(sel.projectName, sel.sourceRoot)) ?? null;
      if (!project || !sr) {
        return { kind: "missing", title: "Source root not found", message: `${sel.projectName} :: ${sel.sourceRoot}` };
      }
      return { kind: "sourceRoot", project, sourceRoot: sr };
    }

    if (sel.kind === "folder") {
      const folder = idx.foldersByKey.get(folderKey(sel.projectName, sel.sourceRoot, sel.folderPath)) ?? null;
      if (!folder) return { kind: "missing", title: "Folder not found", message: sel.folderPath };
      return { kind: "folder", folder, counts: countFolder(folder) };
    }

    if (sel.kind === "file") {
      const file = idx.filesByPath.get(sel.filePath) ?? null;
      if (!file) return { kind: "missing", title: "File not found", message: sel.filePath };

      const classes: ClassSymbol[] = [];
      const methods: MethodSymbol[] = [];
      for (const fc of file.classes) {
        const cs = idx.classById.get(fc.classId);
        if (cs) classes.push(cs);
        for (const mid of fc.methodIds) {
          const ms = idx.methodById.get(mid);
          if (ms) methods.push(ms);
        }
      }
      classes.sort((a, b) => (a.name + a.id).localeCompare(b.name + b.id));
      methods.sort((a, b) => (a.name + a.id).localeCompare(b.name + b.id));

      return {
        kind: "file",
        file,
        classes,
        methods,
        hotspot: idx.hotspotByFilePath.get(sel.filePath) ?? null
      };
    }

    if (sel.kind === "class") {
      const cs = idx.classById.get(sel.classId) ?? null;
      if (!cs) return { kind: "missing", title: "Class not found", message: sel.classId };
      return { kind: "class", classSymbol: cs, methods: idx.methodsByClassId.get(sel.classId) ?? [] };
    }

    const method = idx.methodById.get(sel.methodId) ?? null;
    if (!method) return { kind: "missing", title: "Method not found", message: sel.methodId };
    return {
      kind: "method",
      method,
      duplicates: idx.dupGroupsByMethodId.get(sel.methodId) ?? [],
      references: idx.refsByMethodId.get(sel.methodId) ?? []
    };
  });

  constructor() {
    effect(() => {
      const r = this.report();
      if (!r) {
        this.expanded.set(new Set());
        this.selected.set(null);
        return;
      }

      const next = new Set<string>();
      for (const p of r.projectTree.projects) {
        next.add(idProject(p.name));
        for (const sr of p.sourceRoots) next.add(idSourceRoot(p.name, sr.sourceRoot));
      }
      this.expanded.set(next);

      const methodId = this.route.snapshot.queryParamMap.get("method");
      if (methodId) this.selected.set({ id: methodId, kind: "method", methodId });
    });
  }

  onToggle(id: string, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
  }

  onRowClick(row: DrilldownRow): void {
    switch (row.kind) {
      case "project":
        this.selected.set({ id: row.id, kind: "project", projectName: row.projectName });
        return;
      case "sourceRoot":
        this.selected.set({ id: row.id, kind: "sourceRoot", projectName: row.projectName, sourceRoot: row.sourceRoot });
        return;
      case "folder":
        this.selected.set({
          id: row.id,
          kind: "folder",
          projectName: row.projectName,
          sourceRoot: row.sourceRoot,
          folderPath: row.folderPath
        });
        return;
      case "file":
        this.selected.set({ id: row.id, kind: "file", filePath: row.filePath });
        return;
      case "class":
        this.selected.set({ id: row.id, kind: "class", classId: row.classId });
        return;
      case "method":
        this.selected.set({ id: row.id, kind: "method", methodId: row.methodId });
        return;
    }
  }

  selectClass(classId: string): void {
    this.selected.set({ id: classId, kind: "class", classId });
  }

  selectMethod(methodId: string): void {
    this.selected.set({ id: methodId, kind: "method", methodId });
  }

  rowTitle(row: DrilldownRow): string {
    if (row.kind === "file") return row.filePath;
    if (row.kind === "folder") return row.folderPath;
    if (row.kind === "method") return row.methodId;
    if (row.kind === "class") return row.classId;
    return row.label;
  }
}
