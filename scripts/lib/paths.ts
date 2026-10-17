import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const real = (p: string): string => {
  // Resolve symlinks of the longest existing prefix so /tmp and /private/tmp compare equal.
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    rest.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  return path.join(fs.realpathSync(cur), ...rest);
};

export const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(real(parent), real(child));
  // Only the exact parent segment leaves the tree; a child named "..private" is still inside.
  const up = rel === ".." || rel.startsWith(`..${path.sep}`);
  return rel === "" || (!up && !path.isAbsolute(rel));
};

// Private media and render results must never land in the source tree.
export const assertOutsideRepo = (p: string, what: string): void => {
  if (isInside(p, REPO_ROOT)) throw new Error(`${what} must be outside the source tree (${REPO_ROOT}): ${p}`);
};

// Refuses to run when any artifact this run would write already exists, so earlier material is never replaced.
export const assertFresh = (dir: string, names: string[], what: string): void => {
  const existing = names.filter((n) => fs.lstatSync(path.join(dir, n), { throwIfNoEntry: false }) !== undefined);
  if (existing.length) throw new Error(`${what}: ${dir} already contains ${existing.join(", ")}; use a new output directory`);
};

export const parseArgs = (argv: string[], spec: Record<string, "string" | "flag">): Record<string, string | boolean> => {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const type = spec[key];
    if (!type) throw new Error(`unknown option: ${a}`);
    if (type === "flag") out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`option ${a} needs a value`);
      out[key] = v;
    }
  }
  return out;
};
