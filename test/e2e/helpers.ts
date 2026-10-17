// E2E helpers: real CLI processes, real Chromium, real ffmpeg. All files live in mkdtemp directories.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/paths.ts";
import { ffprobe } from "../../scripts/lib/probe.ts";
import { runOk } from "../../scripts/lib/proc.ts";

export const tmp = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `cvp-e2e-${label}-`));

export type Cli = { code: number; stdout: string; stderr: string };

export const cli = (script: string, args: string[]): Promise<Cli> =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(REPO_ROOT, "scripts", script), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

export const writeJson = (file: string, v: unknown) => fs.writeFileSync(file, JSON.stringify(v, null, 2));

export type Rgb = [number, number, number];
export type Image = { width: number; height: number; at: (x: number, y: number) => Rgb };

// Decodes exactly one frame (0-based index) of a video to RGB.
export const frameAt = async (video: string, index: number): Promise<Image> => {
  const v = (await ffprobe(video)).streams.find((s) => s.codec_type === "video")!;
  const width = v.width!;
  const height = v.height!;
  const dir = tmp("frame");
  const raw = path.join(dir, "f.rgb");
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-vf", `select=eq(n\\,${index})`, "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const data = fs.readFileSync(raw);
  fs.rmSync(dir, { recursive: true, force: true });
  if (data.length !== width * height * 3) throw new Error(`frame ${index} of ${video}: got ${data.length} bytes, expected ${width * height * 3}`);
  return {
    width,
    height,
    at: (x, y) => {
      const i = (Math.round(y) * width + Math.round(x)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
};

export const near = (a: Rgb, b: Rgb, tol = 40) => a.every((c, i) => Math.abs(c - b[i]) <= tol);
export const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

// One pixel of every frame, decoded in a single sequential ffmpeg pass (x, y even to stay on chroma sample positions).
export const pixelTrack = async (video: string, x: number, y: number): Promise<Rgb[]> => {
  const dir = tmp("track");
  const raw = path.join(dir, "t.rgb");
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-vf", `crop=2:2:${x}:${y},scale=1:1:flags=neighbor`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const d = fs.readFileSync(raw);
  fs.rmSync(dir, { recursive: true, force: true });
  const out: Rgb[] = [];
  for (let i = 0; i + 2 < d.length; i += 3) out.push([d[i], d[i + 1], d[i + 2]]);
  return out;
};
