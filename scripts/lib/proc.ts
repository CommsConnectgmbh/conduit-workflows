import { spawn } from "node:child_process";

export type ProcResult = { code: number; stdout: string; stderr: string };

export const run = (cmd: string, args: string[]): Promise<ProcResult> =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => reject(new Error(`${cmd} could not be started: ${e.message}`)));
    p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

export const runOk = async (cmd: string, args: string[]): Promise<string> => {
  const r = await run(cmd, args);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}): ${r.stderr.trim().slice(-800)}`);
  return r.stdout;
};
