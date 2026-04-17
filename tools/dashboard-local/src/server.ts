import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import ts from "typescript";

type JsonObject = Record<string, unknown>;

const DEFAULT_PORT = 4177;

function clampInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function toWorkspaceRelativePath(input: string): string {
  // Keep report-style paths stable: forward slashes, no leading slash, no "./".
  let out = input.trim().replace(/\\/g, "/");
  out = out.replace(/^\/+/, "");
  out = out.replace(/^\.\//, "");
  return out;
}

function isWithinRoot(rootAbs: string, fileAbs: string): boolean {
  const rel = path.relative(rootAbs, fileAbs);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function findDeepestNodeAtPos(sourceFile: ts.SourceFile, pos: number): ts.Node {
  let best: ts.Node = sourceFile;

  const visit = (node: ts.Node) => {
    if (pos < node.getFullStart() || pos >= node.getEnd()) return;
    best = node;
    node.forEachChild(visit);
  };

  sourceFile.forEachChild(visit);
  return best;
}

function getRepoRootAbs(): string {
  // tools/dashboard-local/dist/server.js -> repo root is 3 levels up.
  return path.resolve(__dirname, "..", "..", "..");
}

function withCors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: http.ServerResponse, status: number, body: JsonObject): void {
  withCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, text: string, contentType = "text/plain; charset=utf-8"): void {
  withCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.end(text);
}

async function readRequestJson(req: http.IncomingMessage): Promise<JsonObject | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as JsonObject;
  } catch {
    return null;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function getContentType(fileName: string): string {
  if (fileName.endsWith(".html")) return "text/html; charset=utf-8";
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (fileName.endsWith(".json")) return "application/json; charset=utf-8";
  if (fileName.endsWith(".ico")) return "image/x-icon";
  if (fileName.endsWith(".svg")) return "image/svg+xml";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, distDirAbs: string): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requestedPath = decodeURIComponent(url.pathname);
  const rel = requestedPath.replace(/^\//, "");
  const candidate = path.resolve(distDirAbs, rel || "index.html");
  if (!candidate.startsWith(distDirAbs)) {
    sendText(res, 400, "Bad request.");
    return true;
  }

  if (await fileExists(candidate)) {
    const data = await fs.readFile(candidate);
    withCors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(candidate));
    res.end(data);
    return true;
  }

  // SPA fallback: return index.html for non-file routes.
  if (!path.extname(candidate)) {
    const indexAbs = path.join(distDirAbs, "index.html");
    if (await fileExists(indexAbs)) {
      const data = await fs.readFile(indexAbs);
      withCors(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(data);
      return true;
    }
  }

  return false;
}

async function runAudit(repoRootAbs: string, workspaceRoot: string): Promise<
  | { ok: true; reportPathAbs: string; htmlPathAbs: string; reportJsonText: string }
  | { ok: false; error: string }
> {
  const workspaceRootAbs = path.resolve(workspaceRoot);
  const angularJsonAbs = path.join(workspaceRootAbs, "angular.json");
  if (!(await fileExists(angularJsonAbs))) {
    return { ok: false, error: `No angular.json found at: ${angularJsonAbs}` };
  }

  const cliBinAbs = path.join(repoRootAbs, "packages", "cli", "dist", "bin.js");
  if (!(await fileExists(cliBinAbs))) {
    return { ok: false, error: `CLI not built. Expected: ${cliBinAbs}. Run: npm run ng-inspector:build` };
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const child = spawn(process.execPath, [cliBinAbs, "audit", "--workspace", workspaceRootAbs], {
    cwd: repoRootAbs,
    windowsHide: true
  });

  child.stdout.on("data", (d: Buffer) => stdoutChunks.push(d));
  child.stderr.on("data", (d: Buffer) => stderrChunks.push(d));

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

  if (exitCode !== 0) {
    const msg = stderr || stdout || `ng-inspector audit failed (exit ${exitCode}).`;
    return { ok: false, error: msg };
  }

  // CLI prints reportPathAbs on first line and htmlPathAbs on second line.
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const reportPathAbs = lines[0] ?? "";
  const htmlPathAbs = lines[1] ?? "";
  if (!reportPathAbs) return { ok: false, error: "Audit finished but no report path was returned by the CLI." };

  let reportJsonText: string;
  try {
    reportJsonText = await fs.readFile(reportPathAbs, "utf8");
  } catch {
    return { ok: false, error: `Failed to read report.json at: ${reportPathAbs}` };
  }

  return { ok: true, reportPathAbs, htmlPathAbs, reportJsonText };
}

async function main(): Promise<void> {
  const repoRootAbs = getRepoRootAbs();
  const distDirAbs = path.join(repoRootAbs, "dist", "dashboard", "browser");
  const port = Number(process.env["NGI_DASHBOARD_PORT"] ?? String(DEFAULT_PORT));

  const server = http.createServer(async (req, res) => {
    try {
      withCors(res);

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/api/health" && req.method === "GET") {
        sendJson(res, 200, { ok: true, repoRoot: repoRootAbs, time: new Date().toISOString() });
        return;
      }

      if (url.pathname === "/api/audit" && req.method === "POST") {
        const body = await readRequestJson(req);
        if (!body) {
          sendJson(res, 400, { ok: false, error: "Invalid JSON body." });
          return;
        }
        const workspaceRoot = typeof body["workspaceRoot"] === "string" ? body["workspaceRoot"] : "";
        if (!workspaceRoot) {
          sendJson(res, 400, { ok: false, error: "workspaceRoot must be a non-empty string." });
          return;
        }

        const result = await runAudit(repoRootAbs, workspaceRoot);
        if (!result.ok) {
          sendJson(res, 500, { ok: false, error: result.error });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          reportPathAbs: result.reportPathAbs,
          htmlPathAbs: result.htmlPathAbs,
          reportJsonText: result.reportJsonText
        });
        return;
      }

      if (url.pathname === "/api/source" && req.method === "POST") {
        const body = await readRequestJson(req);
        if (!body) {
          sendJson(res, 400, { ok: false, error: "Invalid JSON body." });
          return;
        }

        const workspaceRoot = typeof body["workspaceRoot"] === "string" ? body["workspaceRoot"] : "";
        const filePathRaw = typeof body["filePath"] === "string" ? body["filePath"] : "";
        const line = clampInt(body["line"], 0);
        const column = clampInt(body["column"], 1);
        const contextLines = Math.max(0, Math.min(20, clampInt(body["contextLines"], 6)));

        if (!workspaceRoot) {
          sendJson(res, 400, { ok: false, error: "workspaceRoot must be a non-empty string." });
          return;
        }
        if (!filePathRaw) {
          sendJson(res, 400, { ok: false, error: "filePath must be a non-empty string." });
          return;
        }
        if (line < 1) {
          sendJson(res, 400, { ok: false, error: "line must be a positive integer." });
          return;
        }

        const workspaceRootAbs = path.resolve(workspaceRoot);
        const filePath = toWorkspaceRelativePath(filePathRaw);
        const fileAbs = path.resolve(workspaceRootAbs, filePath);
        if (!isWithinRoot(workspaceRootAbs, fileAbs)) {
          sendJson(res, 400, { ok: false, error: "filePath escapes workspaceRoot." });
          return;
        }
        if (!(await fileExists(fileAbs))) {
          sendJson(res, 404, { ok: false, error: `File not found: ${fileAbs}` });
          return;
        }

        let text: string;
        try {
          text = await fs.readFile(fileAbs, "utf8");
        } catch {
          sendJson(res, 500, { ok: false, error: `Failed to read file: ${fileAbs}` });
          return;
        }

        const allLines = text.split(/\r?\n/);
        const total = Math.max(1, allLines.length);

        const highlightLine = Math.max(1, Math.min(total, line));
        const highlightColumn = Math.max(1, column);

        const startLine = Math.max(1, highlightLine - contextLines);
        const endLine = Math.min(total, highlightLine + contextLines);

        const snippetLines = [];
        for (let ln = startLine; ln <= endLine; ln += 1) {
          snippetLines.push({ line: ln, text: allLines[ln - 1] ?? "" });
        }

        // Extract an "exact span" by returning the closest statement containing the location.
        // This keeps the browser dependency-light (no TS compiler API bundled) while still
        // providing precise, copy-pastable context.
        let spanText = "";
        try {
          const sf = ts.createSourceFile(fileAbs, text, ts.ScriptTarget.Latest, true);
          const line0 = highlightLine - 1;
          const lineText = allLines[highlightLine - 1] ?? "";
          const col0 = Math.max(0, highlightColumn - 1);
          const safeCol0 = Math.min(col0, Math.max(0, lineText.length));
          const pos = sf.getPositionOfLineAndCharacter(line0, safeCol0);

          const deep = findDeepestNodeAtPos(sf, pos);
          let stmt: ts.Node | undefined = deep;
          while (stmt && !ts.isStatement(stmt)) stmt = stmt.parent;
          const chosen = stmt ?? deep;
          spanText = chosen.getText(sf).trim();
        } catch {
          // Fall back to line-context only.
          spanText = "";
        }

        sendJson(res, 200, {
          ok: true,
          filePath,
          spanText,
          startLine,
          endLine,
          highlightLine,
          highlightColumn,
          lines: snippetLines
        });
        return;
      }

      const served = await serveStatic(req, res, distDirAbs);
      if (!served) {
        sendText(
          res,
          404,
          "Not found. Build the dashboard with: npm run dashboard:build (or run ng serve dashboard)."
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`ng-inspector dashboard local server running at http://127.0.0.1:${port}`);
    // eslint-disable-next-line no-console
    console.log(`Static dir: ${distDirAbs}`);
  });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
