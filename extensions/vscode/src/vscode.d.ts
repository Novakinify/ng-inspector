declare module "vscode" {
  export type Thenable<T> = PromiseLike<T>;

  export interface Disposable {
    dispose(): void;
  }

  export interface ExtensionContext {
    subscriptions: Disposable[];
  }

  export class Uri {
    readonly fsPath: string;
    static file(path: string): Uri;
  }

  export interface WorkspaceFolder {
    uri: Uri;
    name: string;
    index: number;
  }

  export interface FileStat {
    readonly type: number;
    readonly ctime: number;
    readonly mtime: number;
    readonly size: number;
  }

  export namespace workspace {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    namespace fs {
      function stat(uri: Uri): Thenable<FileStat>;
    }
  }

  export namespace env {
    function openExternal(target: Uri): Thenable<boolean>;
  }

  export namespace commands {
    function registerCommand(command: string, callback: (...args: unknown[]) => unknown, thisArg?: unknown): Disposable;
    function executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T>;
  }

  export enum ProgressLocation {
    Notification = 15,
  }

  export interface ProgressOptions {
    location: ProgressLocation;
    title?: string;
    cancellable?: boolean;
  }

  export interface OutputChannel extends Disposable {
    name: string;
    show(preserveFocus?: boolean): void;
    appendLine(value: string): void;
  }

  export namespace window {
    function createOutputChannel(name: string): OutputChannel;
    function showInformationMessage(message: string): Thenable<string | undefined>;
    function showErrorMessage(message: string): Thenable<string | undefined>;
    function withProgress<R>(options: ProgressOptions, task: () => Thenable<R>): Thenable<R>;
    function registerTreeDataProvider<T>(viewId: string, provider: TreeDataProvider<T>): Disposable;
  }

  export interface Event<T> {
    (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]): Disposable;
  }

  export class EventEmitter<T> implements Disposable {
    readonly event: Event<T>;
    fire(data?: T): void;
    dispose(): void;
  }

  export interface Command {
    command: string;
    title: string;
    arguments?: unknown[];
  }

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
  }

  export class ThemeIcon {
    constructor(id: string);
  }

  export interface TreeItemLabel {
    label: string;
    highlights?: [number, number][];
  }

  export type TreeItemIconPath = Uri | { light: Uri; dark: Uri } | ThemeIcon;

  export class TreeItem {
    label: string | TreeItemLabel;
    collapsibleState: TreeItemCollapsibleState;
    description?: string;
    tooltip?: string;
    iconPath?: TreeItemIconPath;
    command?: Command;
    contextValue?: string;
    constructor(label: string | TreeItemLabel, collapsibleState?: TreeItemCollapsibleState);
  }

  export interface TreeDataProvider<T> {
    onDidChangeTreeData?: Event<T | undefined | null | void>;
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): T[] | Thenable<T[]>;
  }
}

