// Real renders through scripts/render.ts: frame-exact scene and subtitle boundaries, fail-closed inputs and an
// output directory that is never overwritten.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runOk } from "../../scripts/lib/proc.ts";
import { parseCueTimes } from "../../scripts/lib/verify.ts";
import { cli, pixelTrack, tmp, writeJson, type Rgb } from "./helpers.ts";

type Colour = "red" | "green" | "blue" | "other";
const colour = ([r, g, b]: Rgb): Colour =>
  r > 190 && g < 70 && b < 70 ? "red" : g > 190 && r < 70 && b < 70 ? "green" : b > 190 && r < 70 && g < 70 ? "blue" : "other";
// Source frame n (30 fps): 0-29 red, 30-59 green, 60-119 blue.
const sourceColour = (n: number): Colour => (n < 30 ? "red" : n < 60 ? "green" : "blue");

// 780x1688 portrait source with colour changes exactly at source frames 30 and 60 (t = 1 s and 2 s), so both the
// first frame of a clip and the frame mapping inside it are visible in every output frame.
const makeMedia = async (dir: string) => {
  const file = path.join(dir, "walk.mp4");
  await runOk("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0xff0000:s=780x1688:r=30:d=1",
    "-f", "lavfi", "-i", "color=c=0x00ff00:s=780x1688:r=30:d=1",
    "-f", "lavfi", "-i", "color=c=0x0000ff:s=780x1688:r=30:d=2",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", file,
  ]);
  return file;
};

const spec = () => ({
  version: 1,
  id: "boundary",
  fps: 30,
  lang: "en",
  theme: { background: "#eef1f5", panel: "#ffffff", text: "#111827", accent: "#2563eb" },
  media: { walk: { path: "walk.mp4" } },
  cuts: {
    long: {
      title: "Boundary long",
      posterScene: 1,
      scenes: [
        { kind: "card", duration: 1.5, caption: "Boundary test" },
        { kind: "clip", media: "walk", start: 1, end: 3, caption: "Green clip." },
        { kind: "card", duration: 1, caption: "End" },
      ],
    },
    short: {
      title: "Boundary short",
      posterScene: 1,
      scenes: [
        { kind: "card", duration: 1, caption: "Start" },
        { kind: "clip", media: "walk", start: 1, end: 2.5, caption: "Green clip." },
        { kind: "card", duration: 1, caption: "End" },
      ],
    },
  },
});

const setup = async (label: string, mutate?: (s: ReturnType<typeof spec>) => void) => {
  const dir = tmp(label);
  await makeMedia(dir);
  const s = spec();
  mutate?.(s);
  writeJson(path.join(dir, "spec.json"), s);
  return { dir, specFile: path.join(dir, "spec.json"), out: path.join(dir, "out") };
};

test("scene and subtitle boundaries are frame-exact in both cuts, outputs are published only after verification", async () => {
  const { specFile, out } = await setup("bounds");
  const r = await cli("render.ts", ["--spec", specFile, "--out", out]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /FAIL/);

  // Every output frame at the centre of the media box: cards show neither source colour, clip frame k shows
  // source frame (first + k). [cut, centre, scenes as [kind, frames, first source frame], cue times]
  const cases = [
    ["long", [520, 540], [["card", 45], ["clip", 60, 30], ["card", 30]], [[0, 1500], [1500, 3500], [3500, 4500]]],
    ["short", [540, 810], [["card", 30], ["clip", 45, 30], ["card", 30]], [[0, 1000], [1000, 2500], [2500, 3500]]],
  ] as const;
  for (const [cut, [x, y], scenes, cues] of cases) {
    const video = path.join(out, `boundary-${cut}.mp4`);
    const track = (await pixelTrack(video, x, y)).map(colour);
    const expected: Colour[] = scenes.flatMap(([kind, n, first]) => Array.from({ length: n }, (_, k) => (kind === "card" ? "other" : sourceColour(first! + k))));
    assert.equal(track.length, expected.length, `${cut}: frame count`);
    const wrong = track.map((c, i) => [i, c, expected[i]] as const).filter(([, c, e]) => c !== e);
    assert.deepEqual(wrong, [], `${cut}: frames that do not show the expected source frame [output frame, got, expected]`);
    for (const ext of ["srt", "vtt"]) {
      assert.deepEqual(parseCueTimes(fs.readFileSync(path.join(out, `boundary-${cut}.${ext}`), "utf8")), cues);
    }
  }

  const report = JSON.parse(fs.readFileSync(path.join(out, "boundary-report.json"), "utf8"));
  assert.equal(report.ok, true);
  // Report paths are relative to the report, never absolute.
  assert.equal(report.cuts[0].video, "boundary-long.mp4");
  assert.deepEqual(
    fs.readdirSync(out).sort(),
    [
      "boundary-long-contact.png", "boundary-long-narration.txt", "boundary-long-poster.png", "boundary-long-stills", "boundary-long.mp4", "boundary-long.srt", "boundary-long.vtt",
      "boundary-report.json",
      "boundary-short-contact.png", "boundary-short-narration.txt", "boundary-short-poster.png", "boundary-short-stills", "boundary-short.mp4", "boundary-short.srt", "boundary-short.vtt",
    ].sort(),
  );

  // A second render into the same directory is refused before any work, and the first export stays untouched.
  const before = fs.statSync(path.join(out, "boundary-long.mp4"));
  const again = await cli("render.ts", ["--spec", specFile, "--out", out, "--cuts", "short"]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already contains boundary-short\.mp4/);
  const afterStat = fs.statSync(path.join(out, "boundary-long.mp4"));
  assert.equal(afterStat.mtimeMs, before.mtimeMs);
  assert.equal(afterStat.size, before.size);
  assert.equal(fs.readdirSync(out).length, 15);
});

// Every case must fail before rendering, with a clear message, without touching the existing output directory.
const failCases: Array<[string, (s: ReturnType<typeof spec>, dir: string) => void, RegExp, string[]?]> = [
  ["missing media file", (s) => (s.media.walk.path = "gone.mp4"), /missing media:\n- walk -> .*gone\.mp4/],
  ["unknown media reference", (s) => ((s.cuts.long.scenes[1] as { media: string }).media = "nope"), /references unknown media "nope"/],
  ["unsupported media type", (s) => (s.media.walk.path = "walk.gif"), /unsupported extension/],
  ["unreadable media", (s, dir) => {
    fs.writeFileSync(path.join(dir, "broken.mp4"), "not a video");
    s.media.walk.path = "broken.mp4";
  }, /media unreadable: .*broken\.mp4/],
  ["clip beyond media end", (s) => ((s.cuts.long.scenes[1] as { end: number }).end = 9), /end: 9s exceeds media duration 4\.000s/],
  ["subtitle too long", (s) => (s.cuts.short.scenes[1].caption = "This caption is far too long for two subtitle lines in the short cut."), /exceeds 2 subtitle lines of 32 chars/],
  ["reading speed", (s) => (s.cuts.long.scenes[2].caption = "Thirty-four characters in a second"), /chars\/s is faster than 17/],
  // Passes the character estimate (27 per line) but is far wider than the box with the real font.
  ["caption overflows with the real font", (s) => (s.cuts.long.scenes[0] = { kind: "card", duration: 2, caption: "WWWWWWWWWWWWWWWWWWWWWWWWWW" }), /line 1 "W+" is \d+px wide, the caption box allows 1600px/],
  ["unknown cut option", () => {}, /--cuts: unknown cut "square"/, ["--cuts", "long,square"]],
  ["duplicate cut option", () => {}, /--cuts: duplicate cut/, ["--cuts", "long,long"]],
];

for (const [label, mutate, re, extra] of failCases) {
  test(`render fails closed: ${label}`, async () => {
    const dir = tmp("fail");
    await makeMedia(dir);
    const s = spec();
    mutate(s, dir);
    writeJson(path.join(dir, "spec.json"), s);
    const out = path.join(dir, "out");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "keep.txt"), "existing export");
    const r = await cli("render.ts", ["--spec", path.join(dir, "spec.json"), "--out", out, ...(extra ?? [])]);
    assert.equal(r.code, 2, r.stderr + r.stdout);
    assert.match(r.stderr, re);
    assert.deepEqual(fs.readdirSync(out), ["keep.txt"]);
    assert.equal(fs.readFileSync(path.join(out, "keep.txt"), "utf8"), "existing export");
  });
}

test("--check validates, probes and measures without writing anything", async () => {
  const { specFile, out } = await setup("check");
  const r = await cli("render.ts", ["--spec", specFile, "--out", out, "--check"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^long: 3 scenes, 135 frames \(4\.50s\), 1920x1080$/m);
  assert.match(r.stdout, /^short: 3 scenes, 105 frames \(3\.50s\), 1080x1920$/m);
  assert.equal(fs.existsSync(out), false);
});
