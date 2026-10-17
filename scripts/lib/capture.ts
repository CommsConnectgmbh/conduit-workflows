// Device-pixel frame capture. Chromium's screencast (page.screencast / CDP Page.startScreencast) and recordVideo
// deliver CSS-pixel frames regardless of deviceScaleFactor, so a 390x844 @2x viewport would come out as 390x844.
// page.screenshot() on the page's own session honours deviceScaleFactor, so frames are captured in a loop and
// timestamped; framesToMp4 turns them into a constant-rate video. Every frame's size is checked against the plan.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

export type Frame = { file: string; ts: number; width: number; height: number };

// A longer pause between two frames would freeze the video for that time; the run fails instead.
export const MAX_FRAME_GAP_MS = 1000;
// The first screenshot of a cold browser can take longer; the walk only starts once it exists.
export const FIRST_FRAME_TIMEOUT_MS = 10_000;

// Reads width/height from the SOF marker of a baseline or progressive JPEG.
export const jpegSize = (b: Buffer): { width: number; height: number } => {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) throw new Error("JPEG marker expected");
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("JPEG without frame header");
};

export const expectedFrameSize = (viewport: { width: number; height: number }, deviceScaleFactor: number) => ({
  width: Math.round(viewport.width * deviceScaleFactor),
  height: Math.round(viewport.height * deviceScaleFactor),
});

export const startCapture = (page: Page, dir: string) => {
  const frames: Frame[] = [];
  const stats = { retries: 0 };
  let stopping = false;
  let error: Error | null = null;
  let firstFrame: () => void = () => {};
  const ready = new Promise<void>((r) => (firstFrame = r));
  // Pausing: no screenshot may be in flight while a navigation swaps the document; Chromium cannot deliver a frame
  // across the swap and the pending call hangs until its timeout. The pause is not exempt from the gap rule.
  let paused: Promise<void> | null = null;
  let resumeLoop: () => void = () => {};
  let idle: () => void = () => {};
  const loop = (async () => {
    let lastOk = Date.now();
    while (!stopping) {
      if (paused) {
        idle();
        await paused;
        continue;
      }
      const limit = frames.length ? MAX_FRAME_GAP_MS : FIRST_FRAME_TIMEOUT_MS;
      try {
        const a = Date.now();
        const data = await page.screenshot({ type: "jpeg", quality: 92, scale: "device", caret: "initial", animations: "allow", timeout: limit });
        // The screenshot shows the page somewhere between request and reply; the midpoint halves the timing error.
        const ts = (a + Date.now()) / 2;
        const file = path.join(dir, `f-${String(frames.length + 1).padStart(6, "0")}.jpg`);
        fs.writeFileSync(file, data, { flag: "wx" });
        frames.push({ file, ts, ...jpegSize(data) });
        lastOk = Date.now();
        if (frames.length === 1) firstFrame();
      } catch (e) {
        // Chromium cannot capture while a navigation swaps the document. Retrying is fine only within the gap limit;
        // a longer outage fails the run (and checkFrames rejects any gap above the limit anyway).
        if (!stopping && Date.now() - lastOk <= limit) {
          stats.retries++;
          await new Promise((r) => setTimeout(r, 10));
          continue;
        }
        if (stopping) return;
        error = new Error(`frame capture failed for more than ${limit} ms after ${frames.length} frame(s): ${(e as Error).message.split("\n")[0]}`);
        firstFrame();
        return;
      }
    }
  })();
  return {
    frames,
    stats,
    // Resolves with the first frame (or rejects with the capture error), so the walk starts on a running capture.
    ready: ready.then(() => {
      if (error) throw error;
    }),
    // Resolves once no screenshot is in flight; frames stop until resume().
    pause: async (): Promise<void> => {
      if (error || paused) return;
      const isIdle = new Promise<void>((r) => (idle = r));
      paused = new Promise<void>((r) => (resumeLoop = r));
      await Promise.race([isIdle, loop]);
    },
    resume: () => {
      paused = null;
      resumeLoop();
    },
    // Throws as soon as the capture loop has failed, so a broken capture aborts the walk early.
    check: () => {
      if (error) throw error;
    },
    stop: async (): Promise<number> => {
      stopping = true;
      if (paused) {
        paused = null;
        resumeLoop();
      }
      await loop;
      if (error) throw error;
      return Date.now();
    },
  };
};

// Fails unless every frame has exactly the planned device-pixel size and no gap exceeds MAX_FRAME_GAP_MS.
export const checkFrames = (frames: Frame[], expected: { width: number; height: number }, stopTs: number, retries: number) => {
  if (frames.length === 0) throw new Error("capture delivered no frames");
  const wrong = frames.filter((f) => f.width !== expected.width || f.height !== expected.height);
  if (wrong.length) {
    const f = wrong[0];
    throw new Error(`capture geometry: ${wrong.length}/${frames.length} frame(s) are not ${expected.width}x${expected.height} (first: ${path.basename(f.file)} is ${f.width}x${f.height})`);
  }
  const gaps = frames.map((f, i) => (frames[i + 1]?.ts ?? stopTs) - f.ts);
  const maxGapMs = Math.max(...gaps);
  if (maxGapMs > MAX_FRAME_GAP_MS) {
    const at = gaps.indexOf(maxGapMs);
    throw new Error(
      `capture stalled: ${Math.round(maxGapMs)} ms without a frame after frame ${at + 1} ` +
        `(t = ${((frames[at].ts - frames[0].ts) / 1000).toFixed(2)} s, limit ${MAX_FRAME_GAP_MS} ms)`,
    );
  }
  const span = (stopTs - frames[0].ts) / 1000;
  return { frames: frames.length, width: expected.width, height: expected.height, captureFps: Number((frames.length / span).toFixed(1)), maxGapMs: Math.round(maxGapMs), retries };
};
