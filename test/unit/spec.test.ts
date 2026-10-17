// Structural validation: invalid specs must fail with a path to the problem, never fall back to defaults.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SpecError } from "../../src/spec/errors.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { baseSpec, clone } from "./helpers.ts";

const issuesOf = (raw: unknown): string[] => {
  try {
    validateSpec(raw);
  } catch (e) {
    assert.ok(e instanceof SpecError, String(e));
    return e.issues;
  }
  assert.fail("expected SpecError");
};

const mutate = (fn: (s: any) => void) => {
  const s = clone(baseSpec()) as any;
  fn(s);
  return issuesOf(s);
};

test("valid fixture passes", () => {
  assert.equal(validateSpec(baseSpec()).id, "fixture");
});

test("non-object specs are rejected", () => {
  for (const v of [null, [], "x", 3]) assert.match(issuesOf(v)[0], /must be a JSON object/);
});

test("unknown keys are errors (typos never become defaults)", () => {
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].clipstart = 1)).some((i) => /scenes\[1\]: unknown key "clipstart"/.test(i)));
  assert.ok(mutate((s) => (s.extra = true)).some((i) => /\$: unknown key "extra"/.test(i)));
  assert.ok(mutate((s) => (s.cuts.square = s.cuts.long)).some((i) => /unknown cut "square"/.test(i)));
});

test("clip start/end are checked", () => {
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].end = 1)).some((i) => /end: must be greater than start/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].start = -1)).some((i) => /start: must be >= 0/.test(i)));
  assert.ok(mutate((s) => delete s.cuts.long.scenes[1].end).some((i) => /missing "end"/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].start = "1")).some((i) => /start: must be a finite number/.test(i)));
});

test("captions must be non-empty text", () => {
  assert.ok(mutate((s) => (s.cuts.long.scenes[0].caption = "  ")).some((i) => /caption: must not be empty/.test(i)));
  assert.ok(mutate((s) => delete s.cuts.long.scenes[0].caption).some((i) => /missing "caption"/.test(i)));
});

test("media references and kinds are checked", () => {
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].media = "nope")).some((i) => /unknown media "nope"/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].media = "shot")).some((i) => /clip needs a video/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[2].media = "walk")).some((i) => /still needs an image/.test(i)));
  assert.ok(mutate((s) => (s.media.walk.path = "../outside.mp4")).some((i) => /stay inside the spec directory/.test(i)));
  assert.ok(mutate((s) => (s.media.walk.path = "/abs/walk.mp4")).some((i) => /must be relative/.test(i)));
  assert.ok(mutate((s) => (s.media.walk.path = "walk.gif")).some((i) => /unsupported extension/.test(i)));
});

test("layout, poster, fps, theme and cuts are checked", () => {
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].layout = { mode: "stretch" })).some((i) => /mode: must be "fit" or "crop"/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].layout = { mode: "crop", focusX: 1.5, focusY: 0.5 })).some((i) => /focusX: must be <= 1/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[1].layout = { mode: "crop", focusX: 0.5, focusY: 0.5, zoom: 0.5 })).some((i) => /zoom: must be >= 1/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes[0].layout = { mode: "fit" })).some((i) => /unknown key "layout"/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.posterScene = 3)).some((i) => /posterScene: must be < 3/.test(i)));
  assert.ok(mutate((s) => (s.fps = 29.97)).some((i) => /fps: must be an integer/.test(i)));
  assert.ok(mutate((s) => (s.theme.text = "red")).some((i) => /theme.text: must match/.test(i)));
  assert.ok(mutate((s) => (s.cuts = {})).some((i) => /needs at least one of long, short/.test(i)));
  assert.ok(mutate((s) => (s.cuts.long.scenes = [])).some((i) => /non-empty array/.test(i)));
  assert.ok(mutate((s) => (s.version = 2)).some((i) => /version: must be 1/.test(i)));
});

test("all issues are reported at once", () => {
  const issues = mutate((s) => {
    s.fps = 0;
    s.cuts.long.scenes[1].end = 0.5;
    s.media.shot.path = "shot.bmp";
  });
  assert.ok(issues.length >= 3, issues.join("\n"));
});
