// Turns a validated spec plus probed media facts into frame-exact render props and subtitle cues.
import { buildCues, wrapBalanced, wrapText } from "./captions.ts";
import { SpecError } from "./errors.ts";
import { REGIONS, arrangementFor, captionCapacity, place } from "./layout.ts";
import { FORMATS, LIMITS } from "./limits.ts";
import type { Cue, CutName, MediaInfo, ResolvedCut, ResolvedScene, Spec } from "./types.ts";

export type Resolved = { cut: ResolvedCut; cues: Cue[] };

export const resolveCut = (
  spec: Spec,
  name: CutName,
  media: Record<string, MediaInfo>,
  srcFor: (mediaName: string) => string,
): Resolved => {
  const cut = spec.cuts[name];
  if (!cut) throw new SpecError([`$.cuts.${name}: not defined`]);
  const { fps } = spec;
  const { width, height } = FORMATS[name];
  const issues: string[] = [];
  const scenes: ResolvedScene[] = [];
  const subtitleLines: string[][] = [];
  let from = 0;

  cut.scenes.forEach((s, index) => {
    const path = `$.cuts.${name}.scenes[${index}]`;
    let durationInFrames: number;
    let trimBefore: number | undefined;
    if (s.kind === "clip") {
      trimBefore = Math.round(s.start * fps);
      durationInFrames = Math.round(s.end * fps) - trimBefore;
    } else {
      durationInFrames = Math.round(s.duration * fps);
    }
    if (durationInFrames < LIMITS.minSceneSeconds * fps) {
      issues.push(`${path}: ${durationInFrames} frames is shorter than ${LIMITS.minSceneSeconds}s`);
    }

    let placement: ResolvedScene["placement"];
    let mediaKind: ResolvedScene["mediaKind"];
    let arrangement: "side" | "stack" | "card" = "card";
    if (s.kind !== "card") {
      const info = media[s.media];
      if (!info) {
        issues.push(`${path}.media: no probe result for "${s.media}"`);
      } else {
        mediaKind = info.kind;
        if (s.kind === "clip" && info.kind !== "video") issues.push(`${path}.media: "${s.media}" is not a video`);
        if (s.kind === "still" && info.kind !== "image") issues.push(`${path}.media: "${s.media}" is not an image`);
        if (s.kind === "clip") {
          if (info.duration === undefined) issues.push(`${path}.media: duration of "${s.media}" unknown`);
          else if (s.end > info.duration + 0.5 / fps) {
            issues.push(`${path}.end: ${s.end}s exceeds media duration ${info.duration.toFixed(3)}s of "${s.media}"`);
          }
        }
        arrangement = arrangementFor(info.width, info.height);
        const box = REGIONS[name][arrangement].media!;
        const layout = s.layout ?? { mode: "fit" as const };
        if (layout.mode === "crop" && (layout.zoom ?? 1) > LIMITS.maxZoom) issues.push(`${path}.layout.zoom: must be <= ${LIMITS.maxZoom}`);
        const chk = place(box, info.width, info.height, layout);
        if (layout.mode === "crop" && Math.min(chk.visibleX, chk.visibleY) < LIMITS.minVisibleFraction) {
          issues.push(
            `${path}.layout: crop shows only ${Math.round(chk.visibleX * 100)}% x ${Math.round(chk.visibleY * 100)}% of the source ` +
              `(minimum ${LIMITS.minVisibleFraction * 100}% per axis); use fit, a lower zoom or a source with a closer aspect ratio`,
          );
        }
        if (layout.mode === "fit" && chk.coverage < LIMITS.minFitCoverage) {
          issues.push(`${path}.layout: fitted source covers only ${Math.round(chk.coverage * 100)}% of its area and would be unreadable`);
        }
        placement = chk.placement;
      }
    }

    const style = REGIONS[name][arrangement].caption;
    const cap = captionCapacity(style);
    const captionLines = wrapText(s.caption, cap.charsPerLine);
    if (!captionLines || captionLines.length > cap.lines) {
      issues.push(`${path}.caption: does not fit on screen (${cap.lines} lines x ${cap.charsPerLine} chars)`);
    }
    const subs = wrapBalanced(s.caption, LIMITS.maxLineChars[name], LIMITS.maxLines);
    if (!subs) issues.push(`${path}.caption: exceeds ${LIMITS.maxLines} subtitle lines of ${LIMITS.maxLineChars[name]} chars`);
    const cps = s.caption.length / (durationInFrames / fps);
    if (durationInFrames > 0 && cps > LIMITS.maxCharsPerSecond) {
      issues.push(`${path}.caption: ${cps.toFixed(1)} chars/s is faster than ${LIMITS.maxCharsPerSecond} chars/s; lengthen the scene or shorten the text`);
    }

    scenes.push({
      index,
      kind: s.kind,
      from,
      durationInFrames,
      caption: s.caption,
      captionLines: captionLines ?? [s.caption],
      narration: s.narration ?? s.caption,
      ...(s.kind !== "card" ? { src: srcFor(s.media), mediaKind, placement } : {}),
      ...(trimBefore !== undefined ? { trimBefore } : {}),
      captionBox: style.box,
      captionFontSize: style.fontSize,
      captionAlign: name === "long" && arrangement === "side" ? "side" : "center",
    } as ResolvedScene);
    subtitleLines.push(subs ?? [s.caption]);
    from += Math.max(durationInFrames, 0);
  });

  if (from > LIMITS.maxCutSeconds[name] * fps) {
    issues.push(`$.cuts.${name}: ${(from / fps).toFixed(2)}s exceeds the maximum of ${LIMITS.maxCutSeconds[name]}s`);
  }
  if (issues.length) throw new SpecError(issues);

  const resolved: ResolvedCut = {
    specId: spec.id,
    cut: name,
    title: cut.title,
    fps,
    width,
    height,
    durationInFrames: from,
    posterScene: cut.posterScene,
    theme: spec.theme,
    scenes,
  };
  return { cut: resolved, cues: buildCues(resolved, subtitleLines) };
};
