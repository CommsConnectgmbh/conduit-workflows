// Read-only check of the local prerequisites: Node in the range pinned by package.json "engines", ffmpeg (with libx264),
// ffprobe, the Chromium binary the installed Playwright resolves via chromium.executablePath(), and one headless
// chromium.launch() as the pipeline does it (closed immediately, no page opened).
// Usage: node scripts/doctor.ts   (npm run doctor)
// Installs nothing, falls back to nothing, makes no network calls. Exit 1 if any prerequisite is missing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

const exec = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    return { ok: false, out: "", why: code === "ENOENT" ? "not found on PATH" : `could not be started (${code ?? r.error.message})` };
  }
  if (r.status !== 0) return { ok: false, out: r.stdout, why: `exited with ${r.status ?? r.signal}: ${r.stderr.trim().split("\n").pop() ?? ""}` };
  return { ok: true, out: r.stdout, why: "" };
};

// Minimal semver range check: plain comparators joined by spaces (AND) and "||" (OR); "^", "~" and "x" ranges are rejected.
const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  return 0;
};
const satisfies = (version: string, range: string): boolean =>
  range.split("||").some((set) =>
    set.trim().split(/\s+/).filter(Boolean).every((c) => {
      const m = /^(>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})$/.exec(c);
      if (!m) throw new Error(`unsupported comparator "${c}"`);
      const d = cmp(parse(version), parse(m[2]));
      switch (m[1]) {
        case ">=": return d >= 0;
        case "<=": return d <= 0;
        case ">": return d > 0;
        case "<": return d < 0;
        default: return d === 0;
      }
    }),
  );

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Node
try {
  const range = (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
  const v = process.versions.node;
  if (!range) add("node", false, `${v}; package.json has no engines.node range`);
  else if (satisfies(v, range)) add("node", true, `${v} (pinned ${range})`);
  else add("node", false, `${v} is outside the pinned range ${range}`);
} catch (e) {
  add("node", false, `cannot evaluate engines.node: ${(e as Error).message}`);
}

// ffmpeg / ffprobe
for (const tool of ["ffmpeg", "ffprobe"]) {
  const r = exec(tool, ["-hide_banner", "-version"]);
  if (!r.ok) {
    add(tool, false, r.why);
    continue;
  }
  const version = /version\s+(\S+)/.exec(r.out)?.[1] ?? "unknown version";
  if (tool === "ffmpeg") {
    const enc = exec("ffmpeg", ["-hide_banner", "-encoders"]);
    if (!enc.ok) add(tool, false, `${version}; listing encoders failed: ${enc.why}`);
    else if (!/^\s*V\S*\s+libx264\s/m.test(enc.out)) add(tool, false, `${version}; encoder libx264 missing (required for MP4 output)`);
    else add(tool, true, `${version} (libx264)`);
  } else add(tool, true, version);
}

// Playwright Chromium
try {
  const { chromium } = await import("playwright");
  const bin = chromium.executablePath();
  if (!fs.existsSync(bin)) add("chromium", false, `Playwright expects ${bin}, file is missing (run: npx playwright install chromium)`);
  else {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      const r = exec(bin, ["--version"]);
      add("chromium", r.ok, r.ok ? r.out.trim() : `${bin}: ${r.why}`);
    } catch {
      add("chromium", false, `${bin} is not executable`);
    }
  }
  // The pipeline calls chromium.launch() (headless), which may start chrome-headless-shell instead of executablePath().
  // Exactly one local launch: no page, no navigation, closed immediately.
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    add("launch", true, `headless launch ok (${browser.version()})`);
  } catch (e) {
    const msg = (e as Error).message;
    const missing = /Executable doesn't exist at (\S+)/.exec(msg)?.[1];
    add("launch", false, missing
      ? `headless binary missing at ${missing} (run: npx playwright install chromium)`
      : `headless launch failed: ${msg.split("\n")[0]}`);
  } finally {
    await browser?.close().catch(() => {});
  }
} catch (e) {
  add("chromium", false, `playwright cannot be loaded (run: npm ci): ${(e as Error).message.split("\n")[0]}`);
}

for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(8)} ${c.detail}`);
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`[doctor] missing or unusable: ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
