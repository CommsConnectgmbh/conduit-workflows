// Recording plan: a read-only browser walk. Only navigation, waiting, scrolling and following links.
import fs from "node:fs";

export type Step =
  | { action: "goto"; url: string }
  | { action: "wait"; ms: number }
  | { action: "waitFor"; selector?: string; text?: string; timeoutMs?: number }
  | { action: "scroll"; selector?: string; y?: number; durationMs: number }
  | { action: "followLink"; selector?: string; text?: string }
  | { action: "mark"; name: string };

export type Plan = {
  version: 1;
  allowedHosts: string[];
  storageState?: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  fps: number;
  session?: { cookiePattern: string; minValidMinutes: number };
  mask: { selectors: string[]; textPatterns: string[]; builtin: boolean };
  forbidControls: string[];
  steps: Step[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const MAX_DIM = 7680;
const isDim = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_DIM;
// Mark names end up in file names, so they are short IDs without separators or dots.
export const MARK_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export const loadPlan = (file: string): Plan => {
  if (!fs.existsSync(file)) throw new Error(`plan not found: ${file}`);
  const p = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const issues: string[] = [];
  const need = (c: boolean, m: string) => (c ? undefined : issues.push(m));
  if (!isObj(p)) throw new Error("plan must be an object");
  const allowedTop = ["version", "allowedHosts", "storageState", "viewport", "deviceScaleFactor", "locale", "fps", "session", "mask", "forbidControls", "steps"];
  for (const k of Object.keys(p)) need(allowedTop.includes(k), `unknown key "${k}"`);
  need(p.version === 1, "version must be 1");
  need(Array.isArray(p.allowedHosts), "allowedHosts must be an array");
  const vp = p.viewport;
  need(isObj(vp) && isDim(vp.width) && isDim(vp.height) && Object.keys(vp).length === 2, `viewport {width, height} must be integers 1..${MAX_DIM}`);
  need(isNum(p.deviceScaleFactor) && p.deviceScaleFactor > 0 && p.deviceScaleFactor <= 4, "deviceScaleFactor must be a number in (0, 4]");
  need(typeof p.locale === "string", "locale required");
  need(Number.isInteger(p.fps) && (p.fps as number) >= 1 && (p.fps as number) <= 120, "fps must be an integer 1..120");
  need(isObj(p.mask) && Array.isArray(p.mask.selectors) && Array.isArray(p.mask.textPatterns) && typeof p.mask.builtin === "boolean", "mask {selectors, textPatterns, builtin} required");
  need(Array.isArray(p.forbidControls), "forbidControls must be an array (may be empty)");
  need(Array.isArray(p.steps) && p.steps.length > 0, "steps must be a non-empty array");
  const actions = ["goto", "wait", "waitFor", "scroll", "followLink", "mark"];
  if (Array.isArray(p.steps)) {
    p.steps.forEach((s, i) => {
      if (!isObj(s) || !actions.includes(s.action as string)) issues.push(`steps[${i}]: action must be one of ${actions.join(", ")}`);
      else if ((s.action === "followLink" || s.action === "waitFor") && !s.selector && !s.text) issues.push(`steps[${i}]: needs selector or text`);
      else if (s.action === "scroll" && !(isNum(s.durationMs) && s.durationMs > 0)) issues.push(`steps[${i}]: durationMs must be a positive number`);
      else if (s.action === "scroll" && s.y !== undefined && !isNum(s.y)) issues.push(`steps[${i}]: y must be a finite number`);
      else if (s.action === "wait" && !(isNum(s.ms) && s.ms >= 0)) issues.push(`steps[${i}]: ms must be a non-negative number`);
      else if (s.action === "waitFor" && s.timeoutMs !== undefined && !(isNum(s.timeoutMs) && s.timeoutMs > 0)) issues.push(`steps[${i}]: timeoutMs must be a positive number`);
      else if (s.action === "mark" && !(typeof s.name === "string" && MARK_NAME.test(s.name))) issues.push(`steps[${i}]: mark name must match ${MARK_NAME}`);
    });
  }
  if (isObj(p.mask)) for (const t of p.mask.textPatterns as string[]) {
    try {
      new RegExp(t);
    } catch {
      issues.push(`mask.textPatterns: invalid regex ${t}`);
    }
  }
  if (issues.length) throw new Error(`plan invalid:\n- ${issues.join("\n- ")}`);
  return p as unknown as Plan;
};

export const hostAllowed = (url: string, allowed: string[]): boolean => {
  const u = new URL(url);
  if (u.protocol === "file:" || u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
  return allowed.some((h) => (h.startsWith("*.") ? u.hostname.endsWith(h.slice(1)) : u.hostname === h));
};
