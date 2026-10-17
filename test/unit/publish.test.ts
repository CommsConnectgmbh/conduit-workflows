// Output publishing never replaces existing files and rolls back a partial publish.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { outputNames, publish } from "../../scripts/lib/render.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cvp-publish-"));

const staged = (out: string) => {
  const stage = fs.mkdtempSync(path.join(out, ".x.partial-"));
  fs.writeFileSync(path.join(stage, "x-long.mp4"), "new video");
  fs.mkdirSync(path.join(stage, "x-long-stills"));
  fs.writeFileSync(path.join(stage, "x-long-stills", "scene-01.png"), "new still");
  fs.writeFileSync(path.join(stage, "x-report.json"), "{}");
  return stage;
};

test("publish moves staged outputs into an empty directory and removes the stage", () => {
  const out = tmp();
  const stage = staged(out);
  publish(stage, out);
  assert.deepEqual(fs.readdirSync(out).sort(), ["x-long-stills", "x-long.mp4", "x-report.json"]);
  assert.equal(fs.readFileSync(path.join(out, "x-long-stills", "scene-01.png"), "utf8"), "new still");
  assert.equal(fs.existsSync(stage), false);
});

test("publish refuses an existing name, keeps it and rolls back everything it already placed", () => {
  const out = tmp();
  fs.writeFileSync(path.join(out, "x-report.json"), "previous report");
  const stage = staged(out);
  assert.throws(() => publish(stage, out), /nothing was published.*EEXIST/s);
  assert.equal(fs.readFileSync(path.join(out, "x-report.json"), "utf8"), "previous report");
  assert.deepEqual(fs.readdirSync(out).filter((n) => !n.startsWith(".")), ["x-report.json"]);
  // The staged files are still there for inspection.
  assert.equal(fs.readFileSync(path.join(stage, "x-long.mp4"), "utf8"), "new video");
});

test("outputNames lists every file a cut writes plus the report", () => {
  assert.deepEqual(outputNames("demo", ["short"]), [
    "demo-short.mp4", "demo-short.srt", "demo-short.vtt", "demo-short-narration.txt", "demo-short-poster.png", "demo-short-contact.png", "demo-short-stills", "demo-report.json",
  ]);
});
