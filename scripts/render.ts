// Usage: node scripts/render.ts --spec <spec.json> --out <dir> [--media-dir <dir>] [--cuts long,short] [--check]
//   --media-dir: directory the spec's media paths are relative to (default: the spec's directory).
//   --check: validate, probe media and measure captions only; renders and writes nothing.
// Exit codes: 0 ok, 1 verification failed (nothing published), 2 invalid input or any other error.
import path from "node:path";
import { parseArgs } from "./lib/paths.ts";
import { VerificationError, parseCuts, prepare, render } from "./lib/render.ts";

const main = async () => {
  const a = parseArgs(process.argv.slice(2), { spec: "string", out: "string", "media-dir": "string", cuts: "string", check: "flag" });
  if (typeof a.spec !== "string") throw new Error("--spec is required");
  const cuts = typeof a.cuts === "string" ? parseCuts(a.cuts) : undefined;
  const log = (s: string) => console.error(`[render] ${s}`);
  const mediaDir = typeof a["media-dir"] === "string" ? a["media-dir"] : undefined;
  if (a.check) {
    const p = await prepare({ specPath: a.spec, outDir: "", mediaDir, cuts, log });
    for (const n of p.names) {
      const c = p.resolved[n]!.cut;
      console.log(`${n}: ${c.scenes.length} scenes, ${c.durationInFrames} frames (${(c.durationInFrames / c.fps).toFixed(2)}s), ${c.width}x${c.height}`);
    }
    return;
  }
  if (typeof a.out !== "string") throw new Error("--out is required");
  try {
    const { outDir, report } = await render({ specPath: a.spec, outDir: a.out, mediaDir, cuts, log });
    for (const c of report.cuts) {
      console.log(`\n${c.cut}: ${path.join(outDir, c.video)}`);
      for (const ch of c.checks) console.log(`  ok   ${ch.name}: expected ${ch.expected}, got ${ch.actual}`);
    }
    console.log(`\nreport: ${path.join(outDir, `${report.specId}-report.json`)}`);
    console.log(`timings (ms): ${JSON.stringify(report.timingsMs)}`);
  } catch (e) {
    if (e instanceof VerificationError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
