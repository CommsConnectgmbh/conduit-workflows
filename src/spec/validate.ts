// Structural validation of a raw spec. Unknown keys are errors so that typos never fall back to defaults.
import { SpecError } from "./errors.ts";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "./limits.ts";
import type { Cut, CutName, Layout, MediaKind, Scene, Spec } from "./types.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

class Checker {
  issues: string[] = [];
  fail(path: string, msg: string) {
    this.issues.push(`${path}: ${msg}`);
  }
  keys(v: Obj, path: string, required: string[], optional: string[] = []) {
    for (const k of required) if (!(k in v)) this.fail(path, `missing "${k}"`);
    for (const k of Object.keys(v)) {
      if (!required.includes(k) && !optional.includes(k)) this.fail(path, `unknown key "${k}"`);
    }
  }
  str(v: unknown, path: string, opts: { pattern?: RegExp; nonEmpty?: boolean } = {}): v is string {
    if (typeof v !== "string") return this.fail(path, "must be a string"), false;
    if (opts.nonEmpty !== false && v.trim() === "") return this.fail(path, "must not be empty"), false;
    if (opts.pattern && !opts.pattern.test(v)) return this.fail(path, `must match ${opts.pattern}`), false;
    return true;
  }
  num(v: unknown, path: string, opts: { min?: number; max?: number; gt?: number; int?: boolean } = {}): v is number {
    if (typeof v !== "number" || !Number.isFinite(v)) return this.fail(path, "must be a finite number"), false;
    if (opts.int && !Number.isInteger(v)) return this.fail(path, "must be an integer"), false;
    if (opts.min !== undefined && v < opts.min) return this.fail(path, `must be >= ${opts.min}`), false;
    if (opts.gt !== undefined && v <= opts.gt) return this.fail(path, `must be > ${opts.gt}`), false;
    if (opts.max !== undefined && v > opts.max) return this.fail(path, `must be <= ${opts.max}`), false;
    return true;
  }
}

export const mediaKindForPath = (p: string): MediaKind | null => {
  const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  return null;
};

const checkLayout = (c: Checker, v: unknown, path: string) => {
  if (!isObj(v)) return c.fail(path, "must be an object");
  if (v.mode === "fit") return c.keys(v, path, ["mode"]);
  if (v.mode === "crop") {
    c.keys(v, path, ["mode", "focusX", "focusY"], ["zoom"]);
    c.num(v.focusX, `${path}.focusX`, { min: 0, max: 1 });
    c.num(v.focusY, `${path}.focusY`, { min: 0, max: 1 });
    if ("zoom" in v) c.num(v.zoom, `${path}.zoom`, { min: 1 });
    return;
  }
  c.fail(`${path}.mode`, `must be "fit" or "crop"`);
};

const checkScene = (c: Checker, v: unknown, path: string, media: Obj) => {
  if (!isObj(v)) return c.fail(path, "must be an object");
  const common = ["caption"];
  const opt = ["narration"];
  if (v.kind === "clip") {
    c.keys(v, path, ["kind", "media", "start", "end", ...common], [...opt, "layout"]);
    const okStart = c.num(v.start, `${path}.start`, { min: 0 });
    const okEnd = c.num(v.end, `${path}.end`, { gt: 0 });
    if (okStart && okEnd && (v.end as number) <= (v.start as number)) c.fail(`${path}.end`, "must be greater than start");
  } else if (v.kind === "still") {
    c.keys(v, path, ["kind", "media", "duration", ...common], [...opt, "layout"]);
    c.num(v.duration, `${path}.duration`, { gt: 0 });
  } else if (v.kind === "card") {
    c.keys(v, path, ["kind", "duration", ...common], opt);
    c.num(v.duration, `${path}.duration`, { gt: 0 });
  } else {
    return c.fail(`${path}.kind`, `must be "clip", "still" or "card"`);
  }
  c.str(v.caption, `${path}.caption`);
  if ("narration" in v) c.str(v.narration, `${path}.narration`);
  if ("layout" in v) checkLayout(c, v.layout, `${path}.layout`);
  if (v.kind !== "card" && c.str(v.media, `${path}.media`)) {
    const entry = media[v.media as string];
    if (!entry) c.fail(`${path}.media`, `references unknown media "${v.media}"`);
    else if (isObj(entry) && typeof entry.path === "string") {
      const kind = mediaKindForPath(entry.path);
      if (v.kind === "clip" && kind !== "video") c.fail(`${path}.media`, `clip needs a video, "${v.media}" is ${kind ?? "unknown"}`);
      if (v.kind === "still" && kind !== "image") c.fail(`${path}.media`, `still needs an image, "${v.media}" is ${kind ?? "unknown"}`);
    }
  }
};

const checkCut = (c: Checker, v: unknown, path: string, media: Obj) => {
  if (!isObj(v)) return c.fail(path, "must be an object");
  c.keys(v, path, ["title", "posterScene", "scenes"]);
  c.str(v.title, `${path}.title`);
  if (!Array.isArray(v.scenes) || v.scenes.length === 0) return c.fail(`${path}.scenes`, "must be a non-empty array");
  v.scenes.forEach((s, i) => checkScene(c, s, `${path}.scenes[${i}]`, media));
  if (c.num(v.posterScene, `${path}.posterScene`, { int: true, min: 0 }) && (v.posterScene as number) >= v.scenes.length) {
    c.fail(`${path}.posterScene`, `must be < ${v.scenes.length}`);
  }
};

export const validateSpec = (raw: unknown): Spec => {
  const c = new Checker();
  if (!isObj(raw)) throw new SpecError(["$: spec must be a JSON object"]);
  c.keys(raw, "$", ["version", "id", "fps", "lang", "theme", "media", "cuts"]);
  if (raw.version !== 1) c.fail("$.version", "must be 1");
  c.str(raw.id, "$.id", { pattern: ID });
  c.num(raw.fps, "$.fps", { int: true, min: 1, max: 60 });
  c.str(raw.lang, "$.lang", { pattern: /^[a-z]{2}(-[A-Z]{2})?$/ });
  if (isObj(raw.theme)) {
    c.keys(raw.theme, "$.theme", ["background", "panel", "text", "accent"]);
    for (const k of ["background", "panel", "text", "accent"]) c.str(raw.theme[k], `$.theme.${k}`, { pattern: HEX });
  } else c.fail("$.theme", "must be an object");
  const media = isObj(raw.media) ? raw.media : {};
  if (!isObj(raw.media)) c.fail("$.media", "must be an object");
  for (const [name, entry] of Object.entries(media)) {
    const path = `$.media.${name}`;
    if (!ID.test(name)) c.fail(path, `name must match ${ID}`);
    if (!isObj(entry)) {
      c.fail(path, "must be an object");
      continue;
    }
    c.keys(entry, path, ["path"]);
    if (c.str(entry.path, `${path}.path`)) {
      const p = entry.path as string;
      if (p.startsWith("/") || p.split(/[\\/]/).includes("..")) c.fail(`${path}.path`, "must be relative and stay inside the spec directory");
      if (!mediaKindForPath(p)) c.fail(`${path}.path`, "unsupported extension");
    }
  }
  if (isObj(raw.cuts)) {
    const names = Object.keys(raw.cuts);
    if (names.length === 0) c.fail("$.cuts", "needs at least one of long, short");
    for (const n of names) {
      if (n !== "long" && n !== "short") c.fail("$.cuts", `unknown cut "${n}"`);
      else checkCut(c, raw.cuts[n], `$.cuts.${n}`, media);
    }
  } else c.fail("$.cuts", "must be an object");
  if (c.issues.length) throw new SpecError(c.issues);
  return raw as unknown as Spec;
};

export const cutNames = (spec: Spec): CutName[] => (["long", "short"] as CutName[]).filter((n) => spec.cuts[n]);
export type { Cut, Layout, Scene };
