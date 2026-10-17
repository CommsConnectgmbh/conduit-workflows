// Usage: node scripts/prepare.ts <input> <output.mp4> [fps]   (fps: integer 1..120, default 30)
// Converts a browser recording into constant-rate H.264. Refuses to overwrite an existing output.
import { assertOutsideRepo } from "./lib/paths.ts";
import { transcodeToMp4 } from "./lib/transcode.ts";

const [input, output, fpsArg = "30", ...rest] = process.argv.slice(2);
const fps = Number(fpsArg);
if (!input || !output || rest.length || !Number.isInteger(fps) || fps < 1 || fps > 120) {
  console.error("usage: node scripts/prepare.ts <input> <output.mp4> [fps 1..120]");
  process.exit(2);
}
try {
  assertOutsideRepo(output, "output");
  console.log(JSON.stringify(await transcodeToMp4(input, output, fps)));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
