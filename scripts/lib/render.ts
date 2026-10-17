// Render pipeline: validate -> check media -> probe -> resolve -> measure captions -> cut clips into frames -> bundle
// -> render -> captions -> stills -> verify -> publish.
// Output contract: nothing in --out is ever replaced. The run refuses to start when any of its own output names
// already exist, renders into a staging directory inside --out and only publishes (no-overwrite hard links) after
// every check passed. A failed verification keeps the staged files in "<id>-failed-<timestamp>" for inspection;
// any other error removes the staging directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { formatTimecode, toSrt, toVtt } from "../../src/spec/captions.ts";
import { MediaError } from "../../src/spec/errors.ts";
import { resolveCut, type Resolved } from "../../src/spec/resolve.ts";
import type { CutName, MediaInfo } from "../../src/spec/types.ts";
import { cutNames, validateSpec } from "../../src/spec/validate.ts";
import { assertCaptionsFit } from "./fit.ts";
import { REPO_ROOT, assertFresh, assertOutsideRepo } from "./paths.ts";
import { probeMedia } from "./probe.ts";
import { contactSheet } from "./sheet.ts";
import { extractClipFrames } from "./transcode.ts";
import { verifyRender, type Check } from "./verify.ts";

export type RenderOptions = { specPath: string; outDir: string; mediaDir?: string; cuts?: CutName[]; log?: (s: string) => void };

// File names in the report are relative to the report's directory, so a report stays valid wherever it is kept.
export type CutReport = { cut: CutName; video: string; srt: string; vtt: string; narration: string; poster: string; contactSheet: string; stills: string[]; checks: Check[] };
export type RenderReport = { specId: string; startedAt: string; timingsMs: Record<string, number>; cuts: CutReport[]; ok: boolean };
export type RenderResult = { outDir: string; report: RenderReport };

export class VerificationError extends Error {
  readonly report: RenderReport;
  readonly keptDir: string;
  constructor(report: RenderReport, keptDir: string) {
    const failed = report.cuts.flatMap((c) => c.checks.filter((k) => !k.ok).map((k) => `${c.cut}: ${k.name}: expected ${k.expected}, got ${k.actual}`));
    super(`verification failed, nothing was published; staged files kept in ${keptDir}:\n- ${failed.join("\n- ")}`);
    this.name = "VerificationError";
    this.report = report;
    this.keptDir = keptDir;
  }
}

export const loadSpec = (specPath: string) => {
  if (!fs.existsSync(specPath)) throw new Error(`spec not found: ${specPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(specPath, "utf8"));
  } catch (e) {
    throw new Error(`spec is not valid JSON: ${specPath}: ${(e as Error).message}`);
  }
  return validateSpec(raw);
};

export const parseCuts = (value: string): CutName[] => {
  const names = value.split(",").map((n) => n.trim());
  for (const n of names) if (n !== "long" && n !== "short") throw new Error(`--cuts: unknown cut "${n}" (allowed: long, short)`);
  if (new Set(names).size !== names.length) throw new Error(`--cuts: duplicate cut in "${value}"`);
  return names as CutName[];
};

// Everything that can fail without rendering: used by render() and by --check.
export const prepare = async (opts: RenderOptions) => {
  const spec = loadSpec(opts.specPath);
  const mediaDir = path.resolve(opts.mediaDir ?? path.dirname(opts.specPath));
  const names = opts.cuts ?? cutNames(spec);
  if (names.length === 0) throw new Error("no cuts selected");
  for (const n of names) if (!spec.cuts[n]) throw new Error(`cut "${n}" is not defined in the spec`);
  const used = new Set<string>();
  for (const n of names) for (const s of spec.cuts[n]!.scenes) if (s.kind !== "card") used.add(s.media);
  const files: Record<string, string> = {};
  const missing: string[] = [];
  for (const m of used) {
    files[m] = path.join(mediaDir, spec.media[m].path);
    if (!fs.existsSync(files[m])) missing.push(`${m} -> ${files[m]}`);
  }
  if (missing.length) throw new MediaError(`missing media:\n- ${missing.join("\n- ")}`);
  for (const f of Object.values(files)) assertOutsideRepo(f, "media");
  const info: Record<string, MediaInfo> = {};
  for (const [m, f] of Object.entries(files)) info[m] = await probeMedia(f);
  const staged = (m: string) => `m-${m}${path.extname(files[m]).toLowerCase()}`;
  const resolved: Partial<Record<CutName, Resolved>> = {};
  for (const n of names) resolved[n] = resolveCut(spec, n, info, staged);
  await assertCaptionsFit(names.map((n) => resolved[n]!.cut));
  return { spec, files, info, staged, resolved, names };
};

// Every name a render of these cuts writes into --out.
export const outputNames = (specId: string, cuts: CutName[]): string[] => [
  ...cuts.flatMap((n) => ["", ".srt", ".vtt", "-narration.txt", "-poster.png", "-contact.png", "-stills"].map((x) => `${specId}-${n}${x || ".mp4"}`)),
  `${specId}-report.json`,
];

// Moves the staged top-level entries into outDir without ever replacing anything: hard links fail on existing
// names (EEXIST), directories are created non-recursively. On any error the already published entries are removed again.
export const publish = (stageDir: string, outDir: string) => {
  const created: string[] = [];
  try {
    for (const name of fs.readdirSync(stageDir)) {
      const src = path.join(stageDir, name);
      const dst = path.join(outDir, name);
      if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dst);
        created.push(dst);
        for (const f of fs.readdirSync(src)) fs.linkSync(path.join(src, f), path.join(dst, f));
      } else {
        fs.linkSync(src, dst);
        created.push(dst);
      }
    }
  } catch (e) {
    for (const p of created.reverse()) fs.rmSync(p, { recursive: true, force: true });
    throw new Error(`publishing into ${outDir} failed, nothing was published: ${(e as Error).message}`);
  }
  fs.rmSync(stageDir, { recursive: true, force: true });
};

const write = (file: string, data: string) => fs.writeFileSync(file, data, { encoding: "utf8", flag: "wx" });
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");

export const render = async (opts: RenderOptions): Promise<RenderResult> => {
  const log = opts.log ?? (() => {});
  const t = (label: string, start: number, timings: Record<string, number>) => (timings[label] = Date.now() - start);
  const timings: Record<string, number> = {};
  const startedAt = new Date().toISOString();
  const outDir = path.resolve(opts.outDir);
  assertOutsideRepo(outDir, "output directory");
  // Refuse before any work when this run's outputs already exist.
  const spec = loadSpec(opts.specPath);
  if (fs.existsSync(outDir)) assertFresh(outDir, outputNames(spec.id, opts.cuts ?? cutNames(spec)), "render");
  let t0 = Date.now();
  const prep = await prepare(opts);
  t("validate+probe+fit", t0, timings);
  const id = prep.spec.id;
  fs.mkdirSync(outDir, { recursive: true });

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "cvp-public-"));
  const out = fs.mkdtempSync(path.join(outDir, `.${id}.partial-`));
  let kept = false;
  try {
    // Stills are served as files; clips only as frame-exact image sequences (see ClipFrame in Walkthrough.tsx).
    for (const [m, f] of Object.entries(prep.files)) if (prep.info[m].kind === "image") fs.copyFileSync(f, path.join(stage, prep.staged(m)), fs.constants.COPYFILE_FICLONE);
    t0 = Date.now();
    for (const name of prep.names) {
      const cut = prep.resolved[name]!.cut;
      for (const s of cut.scenes) {
        if (s.kind !== "clip") continue;
        const media = Object.keys(prep.files).find((m) => prep.staged(m) === s.src)!;
        const dir = `clip-${name}-${String(s.index + 1).padStart(2, "0")}`;
        await extractClipFrames(prep.files[media], path.join(stage, dir), cut.fps, s.trimBefore!, s.durationInFrames);
        s.frames = { dir, count: s.durationInFrames };
      }
    }
    t("cut clips", t0, timings);
    t0 = Date.now();
    log("bundling");
    const serveUrl = await bundle({ entryPoint: path.join(REPO_ROOT, "src/index.ts"), publicDir: stage });
    t("bundle", t0, timings);

    const reports: CutReport[] = [];
    for (const name of prep.names) {
      const { cut, cues } = prep.resolved[name]!;
      const rel = `${id}-${name}`;
      const base = path.join(out, rel);
      const inputProps = cut as unknown as Record<string, unknown>;
      const composition = await selectComposition({ serveUrl, id: name, inputProps });
      t0 = Date.now();
      log(`rendering ${name} (${cut.durationInFrames} frames)`);
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        crf: 18,
        pixelFormat: "yuv420p",
        muted: true,
        outputLocation: `${base}.mp4`,
        overwrite: false,
        inputProps,
      });
      t(`render ${name}`, t0, timings);

      write(`${base}.srt`, toSrt(cues, cut.fps));
      write(`${base}.vtt`, toVtt(cues, cut.fps));
      write(
        `${base}-narration.txt`,
        `${cut.title}\n\n` +
          cut.scenes.map((s) => `[${formatTimecode(s.from, cut.fps)} - ${formatTimecode(s.from + s.durationInFrames, cut.fps)}] ${s.narration}`).join("\n") +
          "\n",
      );

      t0 = Date.now();
      fs.mkdirSync(`${base}-stills`);
      const stills: string[] = [];
      for (const s of cut.scenes) {
        const frame = s.from + Math.floor(s.durationInFrames / 2);
        const file = `${rel}-stills/scene-${String(s.index + 1).padStart(2, "0")}.png`;
        await renderStill({ composition, serveUrl, frame, output: path.join(out, file), overwrite: false, inputProps, imageFormat: "png" });
        stills.push(file);
      }
      fs.copyFileSync(path.join(out, stills[cut.posterScene]), `${base}-poster.png`, fs.constants.COPYFILE_EXCL);
      await contactSheet(
        cut.scenes.map((s, i) => ({
          image: path.join(out, stills[i]),
          label: `${i + 1}. ${formatTimecode(s.from, cut.fps)} - ${formatTimecode(s.from + s.durationInFrames, cut.fps)}`,
          sublabel: s.caption,
        })),
        `${base}-contact.png`,
        { columns: name === "long" ? 3 : 4, thumbWidth: name === "long" ? 480 : 270, title: `${id} / ${name} / ${cut.title}` },
      );
      t(`stills ${name}`, t0, timings);

      t0 = Date.now();
      const checks = await verifyRender(`${base}.mp4`, cut, cues, [`${base}.srt`, `${base}.vtt`]);
      t(`verify ${name}`, t0, timings);
      reports.push({
        cut: name,
        video: `${rel}.mp4`,
        srt: `${rel}.srt`,
        vtt: `${rel}.vtt`,
        narration: `${rel}-narration.txt`,
        poster: `${rel}-poster.png`,
        contactSheet: `${rel}-contact.png`,
        stills,
        checks,
      });
    }
    const report: RenderReport = { specId: id, startedAt, timingsMs: timings, cuts: reports, ok: reports.every((r) => r.checks.every((c) => c.ok)) };
    write(path.join(out, `${id}-report.json`), JSON.stringify(report, null, 2) + "\n");
    if (!report.ok) {
      const failedDir = path.join(outDir, `${id}-failed-${stamp()}`);
      fs.renameSync(out, failedDir);
      kept = true;
      throw new VerificationError(report, failedDir);
    }
    publish(out, outDir);
    return { outDir, report };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (!kept) fs.rmSync(out, { recursive: true, force: true });
  }
};
