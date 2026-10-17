import type { Cue, ResolvedCut } from "./types.ts";

// Greedy word wrap. Returns null if a single word is longer than maxChars.
export const wrapText = (text: string, maxChars: number): string[] | null => {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (w.length > maxChars) return null;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
};

// Balanced wrap for subtitles: prefer two lines of similar length over one long and one short line.
export const wrapBalanced = (text: string, maxChars: number, maxLines: number): string[] | null => {
  const greedy = wrapText(text, maxChars);
  if (!greedy || greedy.length > maxLines) return null;
  if (greedy.length !== 2) return greedy;
  const words = text.trim().split(/\s+/);
  let best = greedy;
  let bestDiff = Math.abs(greedy[0].length - greedy[1].length);
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > maxChars || b.length > maxChars) continue;
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      best = [a, b];
      bestDiff = diff;
    }
  }
  return best;
};

export const buildCues = (cut: ResolvedCut, subtitleLines: string[][]): Cue[] =>
  cut.scenes.map((s, i) => ({
    index: i + 1,
    startFrame: s.from,
    endFrame: s.from + s.durationInFrames,
    lines: subtitleLines[i],
  }));

// Frame-exact timestamp: integer milliseconds derived from the frame number, never from accumulated floats.
export const frameToMs = (frame: number, fps: number): number => Math.round((frame * 1000) / fps);

const stamp = (ms: number, sep: "," | "."): string => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
};

export const toSrt = (cues: Cue[], fps: number): string =>
  cues
    .map((c) => `${c.index}\n${stamp(frameToMs(c.startFrame, fps), ",")} --> ${stamp(frameToMs(c.endFrame, fps), ",")}\n${c.lines.join("\n")}\n`)
    .join("\n");

export const toVtt = (cues: Cue[], fps: number): string =>
  "WEBVTT\n\n" +
  cues
    .map((c) => `${c.index}\n${stamp(frameToMs(c.startFrame, fps), ".")} --> ${stamp(frameToMs(c.endFrame, fps), ".")}\n${c.lines.join("\n")}\n`)
    .join("\n");

export const formatTimecode = (frame: number, fps: number): string => stamp(frameToMs(frame, fps), ".");
