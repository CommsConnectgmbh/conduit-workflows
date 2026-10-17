import type { CutName } from "./types.ts";

export const FORMATS: Record<CutName, { width: number; height: number }> = {
  long: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1920 },
};

export const LIMITS = {
  minSceneSeconds: 1,
  maxCutSeconds: { long: 180, short: 60 } as Record<CutName, number>,
  // Subtitle conventions: two lines, max characters per line, max reading speed.
  maxLines: 2,
  maxLineChars: { long: 42, short: 32 } as Record<CutName, number>,
  maxCharsPerSecond: 17,
  // Crop must keep at least this fraction of the source visible in each axis.
  minVisibleFraction: 0.5,
  // A fitted source must cover at least this fraction of its media box area.
  minFitCoverage: 0.3,
  maxZoom: 3,
};

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"];
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];
