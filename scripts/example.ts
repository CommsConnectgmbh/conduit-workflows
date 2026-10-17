// Records the neutral example pages and renders both cuts.
// Usage: node scripts/example.ts --out <dir>
// Writes <dir>/plan.json, <dir>/recording/ (record.ts) and <dir>/render/ (render.ts); refuses if any of them exists.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, assertFresh, assertOutsideRepo, parseArgs } from "./lib/paths.ts";
import { runOk } from "./lib/proc.ts";
import { VerificationError, render } from "./lib/render.ts";

const a = parseArgs(process.argv.slice(2), { out: "string" });
if (typeof a.out !== "string") {
  console.error("usage: node scripts/example.ts --out <dir>");
  process.exit(2);
}
const out = path.resolve(a.out);
assertOutsideRepo(out, "example output");
if (fs.existsSync(out)) assertFresh(out, ["plan.json", "recording", "render"], "example");
const ex = path.join(REPO_ROOT, "examples/neutral");
fs.mkdirSync(out, { recursive: true });
const list = pathToFileURL(path.join(ex, "list.html")).href;
const plan = {
  version: 1,
  allowedHosts: [],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "en-US",
  fps: 30,
  mask: { selectors: [], textPatterns: [], builtin: true },
  forbidControls: [],
  steps: [
    { action: "goto", url: list },
    { action: "wait", ms: 1500 },
    { action: "mark", name: "list" },
    { action: "followLink", text: "Item 1042" },
    { action: "wait", ms: 3000 },
    { action: "mark", name: "detail" },
    { action: "scroll", selector: "dl", durationMs: 1200 },
    { action: "wait", ms: 1500 },
    { action: "scroll", selector: "button", durationMs: 1200 },
    { action: "wait", ms: 2500 },
    { action: "mark", name: "end" },
  ],
};
const planFile = path.join(out, "plan.json");
fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
const recDir = path.join(out, "recording");
const t0 = Date.now();
await runOk(process.execPath, [path.join(REPO_ROOT, "scripts/record.ts"), "--plan", planFile, "--out", recDir]);
console.error(`[example] recorded in ${Date.now() - t0} ms`);
try {
  const { report } = await render({ specPath: path.join(ex, "spec.json"), mediaDir: recDir, outDir: path.join(out, "render"), log: (s) => console.error(`[render] ${s}`) });
  console.log(JSON.stringify({ out, ok: report.ok, timingsMs: report.timingsMs }, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(e instanceof VerificationError ? 1 : 2);
}
