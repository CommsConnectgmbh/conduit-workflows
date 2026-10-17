// Semantic checks that need probed media facts, plus frame/cue boundaries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { frameToMs, toSrt, toVtt, wrapBalanced, wrapText } from "../../src/spec/captions.ts";
import { SpecError } from "../../src/spec/errors.ts";
import { place } from "../../src/spec/layout.ts";
import { resolveCut } from "../../src/spec/resolve.ts";
import type { MediaInfo, Spec } from "../../src/spec/types.ts";
import { parseCueTimes } from "../../scripts/lib/verify.ts";
import { baseSpec, clone, phoneMedia } from "./helpers.ts";

const src = (m: string) => `m-${m}`;
const issues = (spec: Spec, cut: "long" | "short", media: Record<string, MediaInfo> = phoneMedia()) => {
  try {
    resolveCut(spec, cut, media, src);
  } catch (e) {
    assert.ok(e instanceof SpecError, String(e));
    return e.issues;
  }
  return [];
};

test("scenes are contiguous and frame-exact", () => {
  const { cut, cues } = resolveCut(baseSpec(), "long", phoneMedia(), src);
  assert.deepEqual(cut.scenes.map((s) => [s.from, s.durationInFrames]), [[0, 60], [60, 90], [150, 75]]);
  assert.equal(cut.durationInFrames, 225);
  assert.equal(cut.scenes[1].trimBefore, 30);
  assert.deepEqual(cues.map((c) => [c.startFrame, c.endFrame]), [[0, 60], [60, 150], [150, 225]]);
  assert.equal(cut.width, 1920);
  assert.equal(cut.height, 1080);
});

test("clip frames come from rounded start and end, so neighbours never overlap or gap", () => {
  const s = clone(baseSpec());
  s.cuts.long!.scenes = [
    { kind: "clip", media: "walk", start: 0.017, end: 1.349, caption: "A." },
    { kind: "clip", media: "walk", start: 1.349, end: 2.683, caption: "B." },
  ];
  s.cuts.long!.posterScene = 0;
  const { cut, cues } = resolveCut(s, "long", phoneMedia(), src);
  // round(0.017*30)=1, round(1.349*30)=40, round(2.683*30)=80
  assert.deepEqual(cut.scenes.map((x) => [x.trimBefore, x.from, x.durationInFrames]), [[1, 0, 39], [40, 39, 40]]);
  assert.equal(cues[0].endFrame, cues[1].startFrame);
  assert.equal(cues[1].endFrame, cut.durationInFrames);
});

test("SRT and VTT timestamps are derived from frames and round-trip", () => {
  const { cut, cues } = resolveCut(baseSpec(), "long", phoneMedia(), src);
  const srt = toSrt(cues, cut.fps);
  const vtt = toVtt(cues, cut.fps);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\nFixture title\n/);
  assert.ok(vtt.startsWith("WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n"));
  for (const text of [srt, vtt]) {
    assert.deepEqual(parseCueTimes(text), [[0, 2000], [2000, 5000], [5000, 7500]]);
  }
  // 1/30 s frames: frame 1 = 33 ms, frame 2 = 67 ms, frame 3 = 100 ms (no float drift).
  assert.deepEqual([1, 2, 3, 1799, 108000].map((f) => frameToMs(f, 30)), [33, 67, 100, 59967, 3600000]);
  assert.match(toSrt([{ index: 1, startFrame: 0, endFrame: 108000 + 45, lines: ["x"] }], 30), /01:00:01,500/);
});

test("clip end beyond media duration is rejected, within half a frame is accepted", () => {
  const s = clone(baseSpec());
  (s.cuts.long!.scenes[1] as { end: number }).end = 10.5;
  assert.ok(issues(s, "long").some((i) => /end: 10.5s exceeds media duration 10.000s/.test(i)));
  (s.cuts.long!.scenes[1] as { end: number }).end = 10.01;
  assert.deepEqual(issues(s, "long"), []);
});

test("media without known duration or with the wrong kind is rejected", () => {
  const m = phoneMedia();
  delete m.walk.duration;
  assert.ok(issues(baseSpec(), "long", m).some((i) => /duration of "walk" unknown/.test(i)));
  const m2 = phoneMedia();
  m2.shot = { kind: "video", width: 10, height: 10, duration: 5 };
  assert.ok(issues(baseSpec(), "long", m2).some((i) => /"shot" is not an image/.test(i)));
  const m3 = phoneMedia();
  delete (m3 as Record<string, MediaInfo>).walk;
  assert.ok(issues(baseSpec(), "long", m3).some((i) => /no probe result for "walk"/.test(i)));
});

test("scenes shorter than one second are rejected", () => {
  const s = clone(baseSpec());
  (s.cuts.long!.scenes[1] as { end: number }).end = 1.9;
  assert.ok(issues(s, "long").some((i) => /27 frames is shorter than 1s/.test(i)));
});

test("reading speed and caption size are enforced", () => {
  const s = clone(baseSpec());
  s.cuts.short!.scenes[1] = { kind: "card", duration: 1.5, caption: "This sentence is far too long to read in time." };
  assert.ok(issues(s, "short").some((i) => /chars\/s is faster than 17/.test(i)));
  const s2 = clone(baseSpec());
  s2.cuts.short!.scenes[1] = { kind: "card", duration: 30, caption: "word ".repeat(40).trim() };
  const out = issues(s2, "short");
  assert.ok(out.some((i) => /exceeds 2 subtitle lines of 32 chars/.test(i)));
  const s3 = clone(baseSpec());
  s3.cuts.long!.scenes[0] = { kind: "card", duration: 5, caption: "Supercalifragilisticexpialidociouslylongword" };
  assert.ok(issues(s3, "long").some((i) => /does not fit on screen/.test(i)));
});

test("blunt portrait crop of a landscape recording is rejected, fit and moderate crop are allowed", () => {
  const desktop: Record<string, MediaInfo> = { walk: { kind: "video", width: 1920, height: 1080, duration: 10 }, shot: { kind: "image", width: 1920, height: 1080 } };
  const s = clone(baseSpec());
  const clip = s.cuts.short!.scenes[0] as { layout?: unknown };
  clip.layout = { mode: "crop", focusX: 0.5, focusY: 0.5 };
  assert.ok(issues(s, "short", desktop).some((i) => /crop shows only 40% x 100% of the source/.test(i)));
  clip.layout = { mode: "fit" };
  assert.deepEqual(issues(s, "short", desktop), []);
  // A phone recording in the short cut can be cropped moderately.
  clip.layout = { mode: "crop", focusX: 0.5, focusY: 0.2, zoom: 1.2 };
  assert.deepEqual(issues(s, "short", phoneMedia()), []);
  clip.layout = { mode: "crop", focusX: 0.5, focusY: 0.2, zoom: 2.5 };
  assert.ok(issues(s, "short", phoneMedia()).some((i) => /crop shows only/.test(i)));
});

test("a tiny fitted source is rejected as unreadable", () => {
  const panorama: Record<string, MediaInfo> = { walk: { kind: "video", width: 4000, height: 400, duration: 10 }, shot: { kind: "image", width: 780, height: 1688 } };
  assert.ok(issues(baseSpec(), "short", panorama).some((i) => /covers only \d+% of its area/.test(i)));
});

test("crop placement keeps the focus inside the box and never shows empty space", () => {
  const box = { x: 0, y: 0, width: 960, height: 1340 };
  for (const fx of [0, 0.3, 1]) {
    const { placement: p } = place(box, 780, 1688, { mode: "crop", focusX: fx, focusY: 1, zoom: 1.4 });
    assert.ok(p.offsetX <= 0 && p.offsetX + p.drawWidth >= box.width - 1e-9, `x ${fx}`);
    assert.ok(p.offsetY <= 0 && p.offsetY + p.drawHeight >= box.height - 1e-9, `y ${fx}`);
  }
  const fit = place(box, 780, 1688, { mode: "fit" });
  assert.equal(Math.round(fit.placement.drawHeight), 1340);
  assert.ok(fit.placement.offsetX > 0);
});

test("portrait sources go beside the caption in the long cut, landscape sources above it", () => {
  const phone = resolveCut(baseSpec(), "long", phoneMedia(), src).cut.scenes[1];
  assert.ok(phone.captionBox.x > phone.placement!.box.x + phone.placement!.box.width);
  const desk = resolveCut(baseSpec(), "long", { walk: { kind: "video", width: 1920, height: 1080, duration: 10 }, shot: { kind: "image", width: 1920, height: 1080 } }, src).cut.scenes[1];
  assert.ok(desk.captionBox.y >= desk.placement!.box.y + desk.placement!.box.height);
});

test("wrapping: greedy for screen, balanced for subtitles, null for overlong words", () => {
  assert.deepEqual(wrapText("aa bb cc dd", 5), ["aa bb", "cc dd"]);
  assert.equal(wrapText("abcdefg", 5), null);
  assert.deepEqual(wrapBalanced("one two three four five six seven", 30, 2), ["one two three four", "five six seven"]);
  assert.equal(wrapBalanced("a ".repeat(50), 10, 2), null);
});

test("narration defaults to the caption and can be set separately", () => {
  const s = clone(baseSpec());
  (s.cuts.long!.scenes[1] as { narration?: string }).narration = "Spoken variant.";
  const { cut } = resolveCut(s, "long", phoneMedia(), src);
  assert.equal(cut.scenes[0].narration, "Fixture title");
  assert.equal(cut.scenes[1].narration, "Spoken variant.");
});
