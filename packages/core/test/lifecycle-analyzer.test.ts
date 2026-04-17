import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeLifecycleLeakRisks } from "../src/analyzers/lifecycle-analyzer";

async function writeFile(fileAbs: string, content: string) {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, content, "utf8");
}

test("lifecycle analyzer detects conservative cleanup risks and ignores safe patterns", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ng-inspector-lifecycle-"));

  const fileRel = "src/app/leaks.ts";
  const fileAbs = path.join(workspaceRoot, "src", "app", "leaks.ts");

  await writeFile(
    fileAbs,
    [
      "import { fromEvent, interval, Subject, Subscription, takeUntil } from 'rxjs';",
      "import { effect } from '@angular/core';",
      "import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';",
      "",
      "export class BadFromEvent {",
      "  ngOnInit() {",
      "    fromEvent(window, 'resize').subscribe(() => {});",
      "  }",
      "}",
      "",
      "export class GoodFromEventTakeUntilDestroyed {",
      "  constructor(private destroyRef: any) {",
      "    fromEvent(window, 'resize').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {});",
      "  }",
      "}",
      "",
      "export class GoodFromEventTake1 {",
      "  ngOnInit() {",
      "    fromEvent(window, 'resize').pipe(take(1)).subscribe(() => {});",
      "  }",
      "}",
      "",
      "export class BadDestroySubject {",
      "  private destroy$ = new Subject<void>();",
      "  ngOnInit() {",
      "    interval(1000).pipe(takeUntil(this.destroy$)).subscribe(() => {});",
      "  }",
      "  ngOnDestroy() {",
      "    // broken: complete without next",
      "    this.destroy$.complete();",
      "  }",
      "}",
      "",
      "export class BadIntervalSubscribe {",
      "  ngOnInit() {",
      "    interval(1000).subscribe(() => {});",
      "  }",
      "}",
      "",
      "export class BadSubscriptionField {",
      "  private sub!: any;",
      "  ngOnInit() {",
      "    this.sub = fromEvent(window, 'scroll').subscribe(() => {});",
      "  }",
      "}",
      "",
      "export class GoodSubscriptionField {",
      "  private sub!: any;",
      "  ngOnInit() {",
      "    this.sub = fromEvent(window, 'scroll').subscribe(() => {});",
      "  }",
      "  ngOnDestroy() {",
      "    this.sub.unsubscribe();",
      "  }",
      "}",
      "",
      "export class BadListener {",
      "  ngOnInit() {",
      "    window.addEventListener('resize', this.onResize);",
      "  }",
      "  onResize() {}",
      "}",
      "",
      "export class GoodListener {",
      "  onResize = () => {};",
      "  ngOnInit() {",
      "    window.addEventListener('resize', this.onResize);",
      "  }",
      "  ngOnDestroy() {",
      "    window.removeEventListener('resize', this.onResize);",
      "  }",
      "}",
      "",
      "export class BadIntervalId {",
      "  private id: any;",
      "  ngOnInit() {",
      "    this.id = setInterval(() => {}, 1000);",
      "  }",
      "}",
      "",
      "export class GoodIntervalId {",
      "  private id: any;",
      "  ngOnInit() {",
      "    this.id = setInterval(() => {}, 1000);",
      "  }",
      "  ngOnDestroy() {",
      "    clearInterval(this.id);",
      "  }",
      "}",
      "",
      "export class BadRaf {",
      "  private rid: any;",
      "  start() {",
      "    this.rid = requestAnimationFrame(() => {});",
      "  }",
      "}",
      "",
      "export class GoodRaf {",
      "  private rid: any;",
      "  start() {",
      "    this.rid = requestAnimationFrame(() => {});",
      "  }",
      "  ngOnDestroy() {",
      "    cancelAnimationFrame(this.rid);",
      "  }",
      "}",
      "",
      "export class BadEffect {",
      "  constructor() {",
      "    effect(() => {",
      "      setInterval(() => {}, 1000);",
      "    });",
      "  }",
      "}",
      "",
      "export class GoodEffect {",
      "  constructor() {",
      "    effect((onCleanup) => {",
      "      const id = setInterval(() => {}, 1000);",
      "      onCleanup(() => clearInterval(id));",
      "    });",
      "  }",
      "}",
      "",
      "export class ToSignalManual {",
      "  s = toSignal(interval(1000), { manualCleanup: true });",
      "}",
      "",
      "export class ToSignalAuto {",
      "  s = toSignal(interval(1000));",
      "}",
      "",
      "export class HttpOneShot {",
      "  constructor(private http: any) {}",
      "  ngOnInit() {",
      "    this.http.get('/api').subscribe(() => {});",
      "  }",
      "}",
      "",
      "export class CompositeSubBad {",
      "  private subs = new Subscription();",
      "  ngOnInit() {",
      "    this.subs.add(fromEvent(window, 'mousemove').subscribe(() => {}));",
      "  }",
      "}",
      "",
      "export class CompositeSubGood {",
      "  private subs = new Subscription();",
      "  ngOnInit() {",
      "    this.subs.add(fromEvent(window, 'mousemove').subscribe(() => {}));",
      "  }",
      "  ngOnDestroy() {",
      "    this.subs.unsubscribe();",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  const findings = await analyzeLifecycleLeakRisks({
    workspaceRootAbs: workspaceRoot,
    filePaths: [fileRel],
  });

  const codes = findings.map((f) => f.code);
  const codeSet = new Set(codes);

  assert.ok(codeSet.has("lifecycle-fromEvent-subscribe-no-cleanup"));
  assert.ok(codeSet.has("lifecycle-broken-destroy-subject"));
  assert.ok(codeSet.has("lifecycle-unmanaged-subscribe"));
  assert.ok(codeSet.has("lifecycle-subscription-field-not-unsubscribed"));
  assert.ok(codeSet.has("lifecycle-addEventListener-no-remove"));
  assert.ok(codeSet.has("lifecycle-setInterval-no-clearInterval"));
  assert.ok(codeSet.has("lifecycle-requestAnimationFrame-no-cancelAnimationFrame"));
  assert.ok(codeSet.has("lifecycle-effect-missing-onCleanup"));
  assert.ok(codeSet.has("lifecycle-toSignal-manualCleanup"));

  const fromEventFindings = findings.filter((f) => f.code === "lifecycle-fromEvent-subscribe-no-cleanup");
  assert.equal(fromEventFindings.length, 1);
  assert.equal(fromEventFindings[0]?.metadata["className"], "BadFromEvent");

  const effectFindings = findings.filter((f) => f.code === "lifecycle-effect-missing-onCleanup");
  assert.equal(effectFindings.length, 1);
  assert.equal(effectFindings[0]?.metadata["className"], "BadEffect");

  // Ensure safe patterns do not get flagged:
  assert.ok(
    !findings.some(
      (f) =>
        f.code === "lifecycle-fromEvent-subscribe-no-cleanup" &&
        f.metadata["className"] === "GoodFromEventTakeUntilDestroyed",
    ),
  );
  assert.ok(
    !findings.some(
      (f) => f.code === "lifecycle-addEventListener-no-remove" && f.metadata["className"] === "GoodListener",
    ),
  );
  assert.ok(
    !findings.some(
      (f) => f.code === "lifecycle-setInterval-no-clearInterval" && f.metadata["className"] === "GoodIntervalId",
    ),
  );
  assert.ok(
    !findings.some(
      (f) =>
        f.code === "lifecycle-requestAnimationFrame-no-cancelAnimationFrame" &&
        f.metadata["className"] === "GoodRaf",
    ),
  );
  assert.ok(
    !findings.some(
      (f) => f.code === "lifecycle-effect-missing-onCleanup" && f.metadata["className"] === "GoodEffect",
    ),
  );
  assert.ok(
    !findings.some(
      (f) => f.code === "lifecycle-toSignal-manualCleanup" && f.metadata["className"] === "ToSignalAuto",
    ),
  );
});
