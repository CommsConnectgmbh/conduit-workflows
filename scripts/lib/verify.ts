import fs from "node:fs";
import { frameToMs } from "../../src/spec/captions.ts";
import type { Cue, ResolvedCut } from "../../src/spec/types.ts";
import { ffprobe } from "./probe.ts";

export type Check = { name: string; ok: boolean; expected: string; actual: string };

const ratio = (r: string | undefined) => {
  if (!r) return NaN;
  const [a, b] = r.split("/").map(Number);
  return b ? a / b : a;
};

// Parses SRT/VTT timestamps back to milliseconds to make sure the written files match the cue model.
export const parseCueTimes = (text: string): Array<[number, number]> => {
  const re = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3}) --> (\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g;
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(re)) {
    const t = (h: string, mi: string, s: string, ms: string) => ((+h * 60 + +mi) * 60 + +s) * 1000 + +ms;
    out.push([t(m[1], m[2], m[3], m[4]), t(m[5], m[6], m[7], m[8])]);
  }
  return out;
};

export const verifyRender = async (file: string, cut: ResolvedCut, cues: Cue[], subtitleFiles: string[]): Promise<Check[]> => {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, expected: unknown, actual: unknown) =>
    checks.push({ name, ok, expected: String(expected), actual: String(actual) });
  const data = await ffprobe(file, true);
  const video = data.streams.filter((s) => s.codec_type === "video");
  add("video stream count", video.length === 1, 1, video.length);
  const v = video[0] ?? {};
  add("codec", v.codec_name === "h264", "h264", v.codec_name);
  add("pixel format", v.pix_fmt === "yuv420p", "yuv420p", v.pix_fmt);
  add("width", v.width === cut.width, cut.width, v.width);
  add("height", v.height === cut.height, cut.height, v.height);
  add("frame rate", ratio(v.r_frame_rate) === cut.fps, cut.fps, v.r_frame_rate);
  const frames = Number(v.nb_read_frames);
  add("frame count", frames === cut.durationInFrames, cut.durationInFrames, frames);
  const dur = Number(data.format.duration);
  const expectedDur = cut.durationInFrames / cut.fps;
  add("duration (s, ±1 frame)", Math.abs(dur - expectedDur) <= 1 / cut.fps, expectedDur.toFixed(3), dur.toFixed(3));
  const endMs = frameToMs(cut.durationInFrames, cut.fps);
  for (const f of subtitleFiles) {
    const times = parseCueTimes(fs.readFileSync(f, "utf8"));
    add(`${f.split("/").pop()} cue count`, times.length === cues.length, cues.length, times.length);
    const contiguous = times.every(([s, e], i) => e > s && (i === 0 ? s === 0 : s === times[i - 1][1]));
    add(`${f.split("/").pop()} cues contiguous from 0`, contiguous, "true", contiguous);
    const last = times.at(-1)?.[1];
    add(`${f.split("/").pop()} last cue end (ms)`, last === endMs, endMs, last);
  }
  return checks;
};
