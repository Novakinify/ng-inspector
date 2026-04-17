import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "overview" },
  {
    path: "scans",
    loadComponent: () => import("./pages/scans.page").then((m) => m.ScansPageComponent),
    title: "Scans | ng-inspector"
  },
  {
    path: "overview",
    loadComponent: () => import("./pages/overview.page").then((m) => m.OverviewPageComponent),
    title: "Overview | ng-inspector"
  },
  {
    path: "findings",
    loadComponent: () => import("./pages/findings.page").then((m) => m.FindingsPageComponent),
    title: "Findings | ng-inspector"
  },
  {
    path: "lifecycle",
    loadComponent: () => import("./pages/lifecycle.page").then((m) => m.LifecyclePageComponent),
    title: "Lifecycle Risks | ng-inspector"
  },
  {
    path: "project-tree",
    loadComponent: () =>
      import("./pages/project-tree.page").then((m) => m.ProjectTreePageComponent),
    title: "Project Tree | ng-inspector"
  },
  {
    path: "hotspots",
    loadComponent: () => import("./pages/hotspots.page").then((m) => m.HotspotsPageComponent),
    title: "Hotspots | ng-inspector"
  },
  {
    path: "duplicates",
    loadComponent: () =>
      import("./pages/duplicates.page").then((m) => m.DuplicatesPageComponent),
    title: "Duplicates | ng-inspector"
  },
  {
    path: "import-graph",
    loadComponent: () =>
      import("./pages/import-graph.page").then((m) => m.ImportGraphPageComponent),
    title: "Import Graph | ng-inspector"
  },
  { path: "**", redirectTo: "overview" }
];
