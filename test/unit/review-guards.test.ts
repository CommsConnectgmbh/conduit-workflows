// Regression tests for the review findings: path boundary, no overwrite of existing recordings,
// opaque masking instead of blur, and strict plan validation before any browser starts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installMask, maskConfig, maskCss } from "../../scripts/lib/mask.ts";
import { assertFresh, assertOutsideRepo, isInside, REPO_ROOT } from "../../scripts/lib/paths.ts";
import { loadPlan } from "../../scripts/lib/plan.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cvp-guards-"));

const basePlan = () => ({
  version: 1,
  allowedHosts: ["example.test"],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "de-DE",
  fps: 30,
  mask: { selectors: [], textPatterns: [], builtin: true },
  forbidControls: [],
  steps: [
    { action: "goto", url: "https://example.test/" },
    { action: "scroll", y: 400, durationMs: 1200 },
    { action: "mark", name: "intro-1" },
  ],
});

const writePlan = (dir: string, plan: unknown) => {
  const file = path.join(dir, `plan-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, typeof plan === "string" ? plan : JSON.stringify(plan));
  return file;
};

test("paths: a child named '..private' is inside, the real parent is outside", () => {
  const child = path.join(REPO_ROOT, "..private");
  assert.equal(isInside(child, REPO_ROOT), true);
  assert.throws(() => assertOutsideRepo(child, "probe"), /outside the source tree/);
  assert.equal(isInside(path.join(REPO_ROOT, "..", "elsewhere"), REPO_ROOT), false);
  assert.equal(isInside(path.dirname(REPO_ROOT), REPO_ROOT), false);
  assert.doesNotThrow(() => assertOutsideRepo(path.join(path.dirname(REPO_ROOT), "cvp-out"), "probe"));
  assert.equal(isInside(path.join(REPO_ROOT, "...", "x"), REPO_ROOT), true);
});

test("assertFresh refuses existing artifacts and leaves them untouched", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "raw"));
  fs.writeFileSync(path.join(dir, "raw", "marker.txt"), "keep");
  assert.throws(() => assertFresh(dir, ["raw", "recording.mp4"], "record"), /already contains raw/);
  assert.equal(fs.readFileSync(path.join(dir, "raw", "marker.txt"), "utf8"), "keep");
  assert.doesNotThrow(() => assertFresh(dir, ["recording.mp4"], "record"));
  // A dangling symlink still counts as existing material.
  fs.symlinkSync(path.join(dir, "missing"), path.join(dir, "guard.json"));
  assert.throws(() => assertFresh(dir, ["guard.json"], "record"), /guard\.json/);
});

const runRecord = (args: string[]) =>
  spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/record.ts"), ...args], { encoding: "utf8", timeout: 30_000 });

test("record.ts refuses an output with an existing recording and keeps the markers", () => {
  const dir = tmp();
  const out = path.join(dir, "out");
  fs.mkdirSync(path.join(out, "raw"), { recursive: true });
  fs.writeFileSync(path.join(out, "raw", "raw.webm"), "previous raw");
  fs.writeFileSync(path.join(out, "recording.mp4"), "previous recording");
  const r = runRecord(["--plan", writePlan(dir, basePlan()), "--out", out]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /already contains raw, recording\.mp4/);
  assert.equal(fs.readFileSync(path.join(out, "raw", "raw.webm"), "utf8"), "previous raw");
  assert.equal(fs.readFileSync(path.join(out, "recording.mp4"), "utf8"), "previous recording");
  assert.equal(fs.existsSync(path.join(out, "guard.json")), false);
});

test("record.ts refuses when only recording.mp4 exists (no raw dir)", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "recording.mp4"), "previous recording");
  const r = runRecord(["--plan", writePlan(dir, basePlan()), "--out", dir]);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, "raw")), false);
  assert.equal(fs.readFileSync(path.join(dir, "recording.mp4"), "utf8"), "previous recording");
});

test("record.ts --probe refuses an existing probe directory and keeps its files", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "probe"));
  fs.writeFileSync(path.join(dir, "probe", "01-intro.png"), "previous probe");
  const r = runRecord(["--plan", writePlan(dir, basePlan()), "--out", dir, "--probe"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /already contains probe/);
  assert.equal(fs.readFileSync(path.join(dir, "probe", "01-intro.png"), "utf8"), "previous probe");
  assert.deepEqual(fs.readdirSync(path.join(dir, "probe")), ["01-intro.png"]);
});

test("plan: valid base plan loads", () => {
  const p = loadPlan(writePlan(tmp(), basePlan()));
  assert.equal(p.steps.length, 3);
});

test("plan: malformed mark names are rejected", () => {
  const dir = tmp();
  for (const name of ["../escape", "a/b", "a\\b", ".hidden", "", "with space", "x".repeat(41), "ok.png", 7, null]) {
    const plan = basePlan();
    plan.steps[2] = { action: "mark", name } as never;
    assert.throws(() => loadPlan(writePlan(dir, plan)), /mark name must match/, `name ${JSON.stringify(name)}`);
  }
});

test("plan: scroll, viewport, deviceScaleFactor and fps must be sane numbers", () => {
  const dir = tmp();
  const cases: Array<[string, (p: Record<string, unknown>) => void, RegExp]> = [
    ["scroll 0", (p) => ((p.steps as unknown[])[1] = { action: "scroll", durationMs: 0 }), /durationMs/],
    ["scroll negative", (p) => ((p.steps as unknown[])[1] = { action: "scroll", durationMs: -5 }), /durationMs/],
    ["scroll string", (p) => ((p.steps as unknown[])[1] = { action: "scroll", durationMs: "500" }), /durationMs/],
    ["scroll y string", (p) => ((p.steps as unknown[])[1] = { action: "scroll", y: "1", durationMs: 500 }), /y must be/],
    ["wait negative", (p) => ((p.steps as unknown[])[1] = { action: "wait", ms: -1 }), /ms must be/],
    ["viewport zero", (p) => (p.viewport = { width: 0, height: 800 }), /viewport/],
    ["viewport fraction", (p) => (p.viewport = { width: 1280.5, height: 800 }), /viewport/],
    ["viewport missing height", (p) => (p.viewport = { width: 1280 }), /viewport/],
    ["viewport huge", (p) => (p.viewport = { width: 100000, height: 800 }), /viewport/],
    ["dsf zero", (p) => (p.deviceScaleFactor = 0), /deviceScaleFactor/],
    ["dsf too large", (p) => (p.deviceScaleFactor = 9), /deviceScaleFactor/],
    ["fps zero", (p) => (p.fps = 0), /fps/],
    ["fps fraction", (p) => (p.fps = 29.97), /fps/],
    ["fps huge", (p) => (p.fps = 1000), /fps/],
  ];
  for (const [label, mutate, re] of cases) {
    const plan = basePlan() as unknown as Record<string, unknown>;
    mutate(plan);
    assert.throws(() => loadPlan(writePlan(dir, plan)), re, label);
  }
  // JSON numbers that overflow parse to Infinity and must not pass as a duration.
  const inf = JSON.stringify(basePlan()).replace('"durationMs":1200', '"durationMs":1e400');
  assert.throws(() => loadPlan(writePlan(dir, inf)), /durationMs/);
});

test("mask: opaque visibility redaction, no blur, selectors kept intact", () => {
  const css = maskCss(["[data-secret]", ".a, .b"]);
  assert.doesNotMatch(css, /blur|filter/);
  assert.match(css, /visibility:hidden!important/);
  assert.match(css, /:is\(\.a, \.b\)/);
  // Descendants, pseudo-elements and placeholders of masked elements are hidden too.
  for (const part of [" *{", "::before{", "::after{", "::placeholder{"]) assert.ok(css.includes(part), part);
  // The overlay is an opaque box, not a transparent one.
  assert.match(css, /#cvp-mask-overlay>div\{[^}]*background:#[0-9a-f]{6}/);
  assert.deepEqual(maskConfig(["x"], ["p"]).css, maskCss(["x"]));
});

test("mask: installMask without a built css fails closed", () => {
  assert.throws(() => installMask({ selectors: [], patterns: [] } as never), /css missing/);
});
