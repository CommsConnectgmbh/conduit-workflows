// Frame checks after capture: exact device-pixel geometry and no stall between frames. Startup time before the
// first frame is not a gap (the walk only starts after the first frame, FIRST_FRAME_TIMEOUT_MS bounds it).
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_FRAME_TIMEOUT_MS, MAX_FRAME_GAP_MS, checkFrames, expectedFrameSize, jpegSize, type Frame } from "../../scripts/lib/capture.ts";

const size = { width: 780, height: 1688 };
const frames = (ts: number[], s = size): Frame[] => ts.map((t, i) => ({ file: `f-${i + 1}.jpg`, ts: t, ...s }));

test("expected frame size is viewport x deviceScaleFactor in device pixels", () => {
  assert.deepEqual(expectedFrameSize({ width: 390, height: 844 }, 2), size);
  assert.deepEqual(expectedFrameSize({ width: 401, height: 301 }, 1.5), { width: 602, height: 452 });
});

test("frames at the CSS-pixel size fail the geometry check", () => {
  assert.throws(() => checkFrames(frames([0, 33, 66], { width: 390, height: 844 }), size, 100, 0), /3\/3 frame\(s\) are not 780x1688 \(first: f-1\.jpg is 390x844\)/);
  const mixed = frames([0, 33, 66]);
  mixed[2] = { ...mixed[2], width: 390 };
  assert.throws(() => checkFrames(mixed, size, 100, 0), /1\/3 frame\(s\)/);
});

test("a gap above the limit fails, startup before the first frame does not count", () => {
  const ok = checkFrames(frames([5000, 5033, 5066 + MAX_FRAME_GAP_MS - 100]), size, 5066 + MAX_FRAME_GAP_MS, 2);
  assert.equal(ok.frames, 3);
  assert.equal(ok.retries, 2);
  assert.ok(ok.maxGapMs <= MAX_FRAME_GAP_MS);
  assert.throws(() => checkFrames(frames([0, 33, 33 + MAX_FRAME_GAP_MS + 1]), size, 33 + MAX_FRAME_GAP_MS + 40, 0), /capture stalled: \d+ ms without a frame/);
  // The time after the last frame up to stop counts as a gap too.
  assert.throws(() => checkFrames(frames([0, 33]), size, 33 + MAX_FRAME_GAP_MS + 1, 0), /capture stalled/);
  assert.throws(() => checkFrames([], size, 0, 0), /no frames/);
  assert.ok(FIRST_FRAME_TIMEOUT_MS > MAX_FRAME_GAP_MS);
});

test("jpegSize reads the frame header and rejects non-JPEG data", () => {
  // SOI, APP0 (length 4), SOF0 with height 1688 and width 780.
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x98, 0x03, 0x0c, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(jpegSize(b), size);
  assert.throws(() => jpegSize(Buffer.from("not a jpeg")), /not a JPEG/);
});
