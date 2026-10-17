import fs from "node:fs";
import { MediaError } from "../../src/spec/errors.ts";
import { runOk } from "./proc.ts";
import { probeMedia } from "./probe.ts";

// Browser recordings are variable-frame-rate WebM without duration; convert to constant-rate H.264.
// All ffmpeg calls use -n: an existing output is an error, never overwritten.
export const transcodeToMp4 = async (input: string, output: string, fps: number) => {
  if (!fs.existsSync(input)) throw new MediaError(`input missing: ${input}`);
  if (fs.existsSync(output)) throw new Error(`output already exists: ${output}`);
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-i", input, "-an", "-vf", `fps=${fps},format=yuv420p`, "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-movflags", "+faststart", output]);
  return probeMedia(output);
};

export const extractFrames = async (input: string, dir: string, everySeconds: number) => {
  fs.mkdirSync(dir, { recursive: true });
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-i", input, "-vf", `fps=1/${everySeconds},scale=320:-2`, `${dir}/f-%04d.png`]);
  return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f, i) => ({ file: `${dir}/${f}`, t: i * everySeconds }));
};

// Builds a constant-rate H.264 file from timestamped screencast frames (ffconcat list with durations).
export const framesToMp4 = async (list: string, output: string, fps: number) => {
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-f", "concat", "-safe", "0", "-i", list, "-an", "-vf", `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-movflags", "+faststart", output]);
  return probeMedia(output);
};

// Cuts frames [first, first + count) of a video, counted at `fps` from the first decoded frame (t = 0), into
// <dir>/00001.png ... One sequential decode in ffmpeg, no seeking, so the mapping is deterministic. Lossless PNG
// keeps the source pixels for the single encode in the final render. Fails unless exactly `count` frames come out.
export const extractClipFrames = async (input: string, dir: string, fps: number, first: number, count: number) => {
  if (!Number.isInteger(first) || first < 0 || !Number.isInteger(count) || count < 1) throw new Error(`invalid frame range ${first}+${count}`);
  fs.mkdirSync(dir);
  const last = first + count - 1;
  await runOk("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-n", "-i", input, "-an",
    "-vf", `setpts=PTS-STARTPTS,fps=${fps},select=between(n\\,${first}\\,${last}),setpts=N/FRAME_RATE/TB`,
    "-fps_mode", "passthrough", "-compression_level", "1", `${dir}/%05d.png`,
  ]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  if (files.length !== count) {
    throw new MediaError(`${input}: expected ${count} frames from frame ${first} at ${fps} fps, got ${files.length} (clip end beyond the decodable source?)`);
  }
  return files.length;
};
