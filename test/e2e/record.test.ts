// Real recordings through scripts/record.ts: capture geometry in device pixels, opaque masking that keeps the
// layout, and a masking leak that must abort the run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ffprobe } from "../../scripts/lib/probe.ts";
import { cli, frameAt, hex, near, tmp, writeJson, type Image } from "./helpers.ts";

const VIEWPORT = { width: 400, height: 300 };
const DSF = 2;
const QUADRANTS = { tl: "#ff0000", tr: "#00ff00", bl: "#0000ff", br: "#ffff00" };
const OVERLAY = hex("#1f2937");
const TAIL = hex("#ff00ff");

// Four fixed quadrants fill the viewport exactly, so any padding, scaling or partial capture shows up at the edges.
// Rows A and B are layout-identical (same monospace length); only A's text matches the built-in e-mail pattern.
// The magenta tail after each text must stay at the same x: masking may hide pixels but never change layout.
const page = (extraCss = "", extraBody = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden}
.q{position:fixed;width:50vw;height:50vh}
#tl{left:0;top:0;background:${QUADRANTS.tl}}#tr{right:0;top:0;background:${QUADRANTS.tr}}
#bl{left:0;bottom:0;background:${QUADRANTS.bl}}#br{right:0;bottom:0;background:${QUADRANTS.br}}
.row{position:fixed;left:40px;height:40px;font:22px/40px Menlo,Courier,monospace;background:#fff;color:#000;white-space:nowrap}
#a{top:20px}#b{top:80px}
.tail{display:inline-block;width:24px;height:40px;background:#ff00ff;vertical-align:top}
${extraCss}</style></head><body>
<div class="q" id="tl"></div><div class="q" id="tr"></div><div class="q" id="bl"></div><div class="q" id="br"></div>
<div class="row" id="a"><span>someone@example.com</span><span class="tail"></span></div>
<div class="row" id="b"><span>someone-example-com</span><span class="tail"></span></div>
${extraBody}</body></html>`;

const plan = (url: string) => ({
  version: 1,
  allowedHosts: [],
  viewport: VIEWPORT,
  deviceScaleFactor: DSF,
  locale: "en-US",
  fps: 30,
  mask: { selectors: [], textPatterns: [], builtin: true },
  forbidControls: [],
  steps: [
    { action: "goto", url },
    { action: "wait", ms: 1500 },
    { action: "mark", name: "end" },
  ],
});

const setup = (label: string, html: string) => {
  const dir = tmp(label);
  fs.writeFileSync(path.join(dir, "page.html"), html);
  writeJson(path.join(dir, "plan.json"), plan(pathToFileURL(path.join(dir, "page.html")).href));
  return { dir, planFile: path.join(dir, "plan.json"), out: path.join(dir, "out") };
};

// x of the first tail pixel in a row (device pixels), scanning left to right.
const tailX = (img: Image, y: number) => {
  for (let x = 0; x < img.width; x++) if (near(img.at(x, y), TAIL, 50)) return x;
  return -1;
};

test("recording fills the full device-pixel frame and masks opaquely without moving layout", async () => {
  const { planFile, out } = setup("geometry", page());
  const r = await cli("record.ts", ["--plan", planFile, "--out", out]);
  assert.equal(r.code, 0, r.stderr);

  const video = path.join(out, "recording.mp4");
  const v = (await ffprobe(video)).streams.find((s) => s.codec_type === "video")!;
  assert.deepEqual([v.width, v.height], [VIEWPORT.width * DSF, VIEWPORT.height * DSF]);
  const guard = JSON.parse(fs.readFileSync(path.join(out, "guard.json"), "utf8"));
  assert.equal(guard.capture.width, VIEWPORT.width * DSF);
  assert.equal(guard.capture.height, VIEWPORT.height * DSF);
  assert.ok(guard.capture.frames > 10, `frames ${guard.capture.frames}`);
  assert.ok(guard.capture.maxGapMs <= 1000);
  assert.deepEqual(guard.blocked, []);

  const n = Number((await ffprobe(video, true)).streams[0].nb_read_frames);
  const img = await frameAt(video, n - 5);
  const W = img.width;
  const H = img.height;
  // Content reaches every edge: corners and the pixels right next to the centre lines carry the quadrant colours.
  const probes: Array<[number, number, string]> = [
    [4, 4, QUADRANTS.tl], [W - 5, 4, QUADRANTS.tr], [4, H - 5, QUADRANTS.bl], [W - 5, H - 5, QUADRANTS.br],
    [W / 2 - 6, H / 2 - 6, QUADRANTS.tl], [W / 2 + 6, H / 2 - 6, QUADRANTS.tr], [W / 2 - 6, H / 2 + 6, QUADRANTS.bl], [W / 2 + 6, H / 2 + 6, QUADRANTS.br],
  ];
  for (const [x, y, c] of probes) assert.ok(near(img.at(x, y), hex(c)), `pixel ${x},${y} is ${img.at(x, y)}, expected ${c}`);

  // Row centres in device pixels.
  const yA = (20 + 20) * DSF;
  const yB = (80 + 20) * DSF;
  const xA = tailX(img, yA);
  const xB = tailX(img, yB);
  assert.ok(xB > 40 * DSF, `tail of the reference row not found (${xB})`);
  assert.ok(Math.abs(xA - xB) <= 2, `masked row tail at ${xA}, reference row tail at ${xB}: layout changed`);

  // The masked text span is an opaque box; the reference span shows dark text on white.
  const from = 40 * DSF + 6;
  const to = xB - 6;
  let overlay = 0;
  let dark = 0;
  let light = 0;
  const total = to - from;
  for (let x = from; x < to; x++) {
    for (const dy of [-10, 0, 10]) if (near(img.at(x, yA + dy), OVERLAY, 30)) overlay++;
    const p = img.at(x, yB);
    if (p.every((c) => c < 90)) dark++;
    if (p.every((c) => c > 200)) light++;
  }
  assert.ok(overlay / (total * 3) > 0.97, `only ${((overlay / (total * 3)) * 100).toFixed(1)}% of the masked span is opaque`);
  assert.ok(dark > 10 && light > 10, `reference row should show text (dark ${dark}, light ${light})`);
});

test("sensitive text forced visible by app CSS aborts the recording and leaves no video", async () => {
  // An id selector outranks the mask rule, like an app stylesheet that forces visibility back on.
  const { planFile, out } = setup("leak", page("#leak{visibility:visible!important}", `<p id="leak" style="position:fixed;top:220px;left:40px;margin:0">someone@example.com</p>`));
  const r = await cli("record.ts", ["--plan", planFile, "--out", out]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /unmasked sensitive text node\(s\) visible at step 0 \(goto\)/);
  assert.deepEqual(fs.readdirSync(out), ["guard.json"]);
});

test("recording refuses an invalid plan before starting a browser", async () => {
  const { dir, out } = setup("badplan", page());
  const p = plan("file:///x.html");
  p.steps.push({ action: "mark", name: "../escape" } as never);
  writeJson(path.join(dir, "bad.json"), p);
  const r = await cli("record.ts", ["--plan", path.join(dir, "bad.json"), "--out", out]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /mark name must match/);
  assert.equal(fs.existsSync(out), false);
});

test("document navigations do not stall the capture; frames show the new page right after the link", async () => {
  // A capture call that is in flight while a navigation swaps the document hangs until its timeout; the recorder
  // pauses the capture around navigations instead, so the gap is only the navigation itself.
  const dir = tmp("nav");
  const doc = (bg: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${bg}}a{display:block;padding:40px;font:24px sans-serif;color:#fff}</style></head><body>${body}</body></html>`;
  fs.writeFileSync(path.join(dir, "one.html"), doc("#0000ff", `<a href="two.html">Next</a>`));
  fs.writeFileSync(path.join(dir, "two.html"), doc("#00ff00", `<a href="one.html">Back</a>`));
  const p = plan(pathToFileURL(path.join(dir, "one.html")).href);
  p.steps = [
    { action: "goto", url: pathToFileURL(path.join(dir, "one.html")).href },
    { action: "wait", ms: 600 },
    { action: "followLink", text: "Next" },
    { action: "wait", ms: 600 },
    { action: "followLink", text: "Back" },
    { action: "wait", ms: 600 },
    { action: "mark", name: "end" },
  ] as never;
  writeJson(path.join(dir, "plan.json"), p);
  const out = path.join(dir, "out");
  const r = await cli("record.ts", ["--plan", path.join(dir, "plan.json"), "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  const guard = JSON.parse(fs.readFileSync(path.join(out, "guard.json"), "utf8"));
  assert.ok(guard.capture.maxGapMs < 500, `max gap ${guard.capture.maxGapMs} ms`);
  const nav = guard.steps.filter((s: { action: string }) => s.action === "followLink");
  assert.equal(nav.length, 2);
  // Shortly after each navigation finished, the frame shows the target page.
  const video = path.join(out, "recording.mp4");
  for (const [s, colour] of [[nav[0], "#00ff00"], [nav[1], "#0000ff"]] as const) {
    const n = Math.round((s.t + s.ms / 1000 + 0.3) * 30);
    const img = await frameAt(video, n);
    assert.ok(near(img.at(img.width - 20, img.height - 20), hex(colour)), `frame ${n} after ${s.action}@${s.t}s is ${img.at(img.width - 20, img.height - 20)}`);
  }
});
