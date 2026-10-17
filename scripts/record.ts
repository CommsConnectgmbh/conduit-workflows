// Read-only browser recording from a plan file.
// Usage: node scripts/record.ts --plan <plan.json> --out <dir> [--probe]
//   --probe: same walk without video, writes one screenshot per mark into <dir>/probe/ for data review.
// Existing material is never replaced: the run refuses to start when its own artifacts already exist in <dir>.
// Safety: every request other than GET/HEAD to an allowed host is aborted, WebSockets and service workers are blocked,
// only links (<a href>) can be followed, masking runs before the first paint, a session close to expiry aborts the run.
// Geometry: frames are captured at viewport x deviceScaleFactor device pixels; any other frame size fails the run.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { checkFrames, expectedFrameSize, startCapture, type Frame } from "./lib/capture.ts";
import { BUILTIN_PATTERNS, installMask, maskConfig } from "./lib/mask.ts";
import { assertFresh, assertOutsideRepo, parseArgs } from "./lib/paths.ts";
import { hostAllowed, loadPlan, type Step } from "./lib/plan.ts";
import { sessionMinutesLeft } from "./lib/session.ts";
import { contactSheet } from "./lib/sheet.ts";
import { extractFrames, framesToMp4 } from "./lib/transcode.ts";

const a = parseArgs(process.argv.slice(2), { plan: "string", out: "string", probe: "flag" });
if (typeof a.plan !== "string" || typeof a.out !== "string") {
  console.error("usage: node scripts/record.ts --plan <plan.json> --out <dir> [--probe]");
  process.exit(2);
}
let plan: ReturnType<typeof loadPlan>;
const out = path.resolve(a.out);
try {
  plan = loadPlan(a.plan);
  assertOutsideRepo(out, "recording output");
} catch (e) {
  console.error(`[record] ${(e as Error).message}`);
  process.exit(2);
}
const probe = a.probe === true;
const rawDir = path.join(out, "raw");
const probeDir = path.join(out, "probe");
try {
  assertFresh(out, probe ? ["probe"] : ["raw", "recording.mp4", "frames", "recording-sheet.png", "guard.json"], "record");
  fs.mkdirSync(out, { recursive: true });
  // Non-recursive mkdir fails if the directory appeared in the meantime, so only our own directory is ever cleaned up.
  fs.mkdirSync(probe ? probeDir : rawDir);
} catch (e) {
  console.error(`[record] ${(e as Error).message}`);
  process.exit(1);
}
const guardFile = path.join(probe ? probeDir : out, "guard.json");

const blocked: Array<{ method: string; target: string; reason: string }> = [];
const marks: Array<{ name: string; t: number }> = [];
// Start time of every step (s since the walk started), for diagnosing capture gaps and timing captions.
const stepLog: Array<{ step: number; action: string; t: number; ms?: number }> = [];
let frames: Frame[] = [];
let stopTs = 0;
let capture: ReturnType<typeof checkFrames> | null = null;
const expected = expectedFrameSize(plan.viewport, plan.deviceScaleFactor);
const started = Date.now();

const browser = await chromium.launch();
let failure: Error | null = null;
try {
  const ctx = await browser.newContext({
    // Playwright reads the storage state in memory; it is never written back or copied.
    ...(plan.storageState ? { storageState: plan.storageState } : {}),
    viewport: plan.viewport,
    deviceScaleFactor: plan.deviceScaleFactor,
    locale: plan.locale,
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  if (plan.session) {
    const left = await sessionMinutesLeft(ctx, plan.session.cookiePattern);
    console.error(`[record] session valid for ${left.toFixed(0)} more minutes`);
    if (left < plan.session.minValidMinutes) {
      throw new Error(`session expires in ${left.toFixed(1)} min (< ${plan.session.minValidMinutes}); the app would refresh the token. Not recording.`);
    }
  }
  await ctx.route("**/*", (route) => {
    const r = route.request();
    const u = new URL(r.url());
    const target = `${u.protocol}//${u.host}${u.pathname}`;
    if (!["GET", "HEAD"].includes(r.method())) {
      blocked.push({ method: r.method(), target, reason: "method" });
      return route.abort("blockedbyclient");
    }
    if (!hostAllowed(r.url(), plan.allowedHosts)) {
      blocked.push({ method: r.method(), target, reason: "host" });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await ctx.routeWebSocket(/.*/, (ws) => {
    blocked.push({ method: "WS", target: ws.url().split("?")[0], reason: "websocket" });
    ws.close();
  });
  await ctx.addInitScript(installMask, maskConfig(plan.mask.selectors, [...(plan.mask.builtin ? BUILTIN_PATTERNS : []), ...plan.mask.textPatterns]));

  const page = await ctx.newPage();
  // t = 0 is the first captured frame (recording) or the start of the walk (probe); marks and steps use it.
  let t0 = Date.now();
  const cap = probe ? null : startCapture(page, rawDir);
  if (cap) {
    frames = cap.frames;
    await cap.ready;
    t0 = frames[0].ts;
  }
  const forbid = plan.forbidControls.map((p) => new RegExp(p, "i"));

  const guardPage = async (p: Page, label: string) => {
    const open = await p.evaluate(() => (window as unknown as { __cvpUnmasked: () => number }).__cvpUnmasked());
    if (open > 0) throw new Error(`${open} unmasked sensitive text node(s) visible at ${label}`);
    if (forbid.length) {
      const labels = await p.$$eval("button,a,[role=button]", (es) => es.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e as HTMLElement).innerText || ""));
      const bad = labels.filter((l) => forbid.some((re) => re.test(l)));
      if (bad.length) throw new Error(`forbidden control visible at ${label} (${bad.length} match(es))`);
    }
  };

  // Document navigations run with the capture paused (see startCapture); the time counts towards the frame gap.
  const navigating = async (go: () => Promise<unknown>) => {
    await cap?.pause();
    try {
      await go();
    } finally {
      cap?.resume();
    }
  };

  const target = (s: { selector?: string; text?: string }) => (s.selector ? page.locator(s.selector) : page.getByText(s.text!, { exact: false })).first();

  const runStep = async (s: Step, i: number) => {
    const started = Date.now();
    stepLog.push({ step: i, action: s.action, t: (started - t0) / 1000 });
    switch (s.action) {
      case "goto":
        if (!hostAllowed(s.url, plan.allowedHosts)) throw new Error(`steps[${i}]: host not allowed`);
        await navigating(() => page.goto(s.url, { waitUntil: "load" }));
        break;
      case "wait":
        await page.waitForTimeout(s.ms);
        break;
      case "waitFor":
        await target(s).waitFor({ state: "visible", timeout: s.timeoutMs ?? 30_000 });
        break;
      case "scroll": {
        const to = s.selector ? await target(s).evaluate((e) => e.getBoundingClientRect().top + window.scrollY - 80) : (s.y ?? 0);
        await page.evaluate(
          ({ to, ms }) =>
            new Promise<void>((done) => {
              const from = window.scrollY;
              const start = performance.now();
              const tick = (now: number) => {
                const k = Math.min(1, (now - start) / ms);
                const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
                window.scrollTo(0, from + (to - from) * e);
                if (k < 1) requestAnimationFrame(tick);
                else done();
              };
              requestAnimationFrame(tick);
            }),
          { to, ms: s.durationMs },
        );
        break;
      }
      case "followLink": {
        const el = target(s);
        const href = await el.evaluate((e) => {
          const a = e.closest("a");
          return a && a.getAttribute("href") ? (a as HTMLAnchorElement).href : null;
        });
        if (!href) throw new Error(`steps[${i}]: target is not a link; only links may be followed`);
        if (!hostAllowed(href, plan.allowedHosts)) throw new Error(`steps[${i}]: link leaves allowed hosts`);
        await navigating(async () => {
          await el.click();
          await page.waitForURL(href, { timeout: 30_000 });
        });
        break;
      }
      case "mark":
        marks.push({ name: s.name, t: (Date.now() - t0) / 1000 });
        if (probe) await page.screenshot({ path: path.join(probeDir, `${String(marks.length).padStart(2, "0")}-${s.name}.png`) });
        break;
    }
    await guardPage(page, `step ${i} (${s.action})`);
    stepLog[stepLog.length - 1].ms = Date.now() - started;
    cap?.check();
  };

  for (const [i, s] of plan.steps.entries()) await runStep(s, i);
  if (cap) {
    stopTs = await cap.stop();
    capture = checkFrames(frames, expected, stopTs, cap.stats.retries);
  }
  await page.close();
  await ctx.close();
} catch (e) {
  failure = e as Error;
} finally {
  await browser.close();
}

fs.writeFileSync(guardFile, JSON.stringify({ blocked, marks, steps: stepLog, ...(failure ? { error: failure.message } : {}) }, null, 2) + "\n");
if (failure) {
  console.error(`[record] aborted: ${failure.message}`);
  if (!probe) fs.rmSync(rawDir, { recursive: true, force: true });
  process.exit(1);
}
const timings: Record<string, number> = { walk: Date.now() - started };
if (!probe) {
  let t = Date.now();
  const list = frames
    .map((f, i) => `file '${f.file}'\nduration ${(((frames[i + 1]?.ts ?? stopTs) - f.ts) / 1000).toFixed(4)}`)
    .join("\n");
  // The concat demuxer ignores the last duration unless the last file is repeated.
  fs.writeFileSync(path.join(rawDir, "frames.txt"), `ffconcat version 1.0\n${list}\nfile '${frames.at(-1)!.file}'\n`);
  const info = await framesToMp4(path.join(rawDir, "frames.txt"), path.join(out, "recording.mp4"), plan.fps);
  // framesToMp4 only rounds odd sizes down to even ones (yuv420p); anything else means the geometry broke.
  const even = { width: expected.width & ~1, height: expected.height & ~1 };
  if (info.width !== even.width || info.height !== even.height) {
    fs.rmSync(path.join(out, "recording.mp4"));
    console.error(`[record] aborted: recording.mp4 is ${info.width}x${info.height}, expected ${even.width}x${even.height}`);
    process.exit(1);
  }
  timings.transcode = Date.now() - t;
  t = Date.now();
  const sheetFrames = await extractFrames(path.join(out, "recording.mp4"), path.join(out, "frames"), 1);
  await contactSheet(
    sheetFrames.map((f) => ({ image: f.file, label: `t = ${f.t}s`, sublabel: marks.filter((m) => Math.floor(m.t) === f.t).map((m) => m.name).join(", ") })),
    path.join(out, "recording-sheet.png"),
    { columns: 8, thumbWidth: 200, title: `recording ${info.width}x${info.height}, ${info.duration?.toFixed(2)}s` },
  );
  timings.sheet = Date.now() - t;
  console.log(JSON.stringify({ recording: path.join(out, "recording.mp4"), info, capture, marks }, null, 2));
}
fs.writeFileSync(guardFile, JSON.stringify({ blocked, marks, steps: stepLog, ...(capture ? { capture } : {}), timingsMs: timings }, null, 2) + "\n");
console.error(`[record] blocked requests: ${blocked.length} (see guard.json)`);
