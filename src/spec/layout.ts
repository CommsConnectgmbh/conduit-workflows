import type { CutName, Layout, Placement, Rect } from "./types.ts";

export type Arrangement = "side" | "stack" | "card";

export type CaptionStyle = { box: Rect; fontSize: number };

// Fixed regions per cut. Portrait sources in the long cut sit beside the caption ("side"),
// landscape sources take the full width with the caption below ("stack").
export const REGIONS: Record<CutName, Record<Arrangement, { media?: Rect; caption: CaptionStyle }>> = {
  long: {
    side: {
      media: { x: 140, y: 60, width: 760, height: 960 },
      caption: { box: { x: 980, y: 140, width: 820, height: 800 }, fontSize: 64 },
    },
    stack: {
      media: { x: 80, y: 40, width: 1760, height: 800 },
      caption: { box: { x: 80, y: 870, width: 1760, height: 180 }, fontSize: 56 },
    },
    card: { caption: { box: { x: 160, y: 240, width: 1600, height: 600 }, fontSize: 96 } },
  },
  short: {
    side: {
      media: { x: 60, y: 140, width: 960, height: 1340 },
      caption: { box: { x: 60, y: 1520, width: 960, height: 300 }, fontSize: 60 },
    },
    stack: {
      media: { x: 60, y: 140, width: 960, height: 1340 },
      caption: { box: { x: 60, y: 1520, width: 960, height: 300 }, fontSize: 60 },
    },
    card: { caption: { box: { x: 80, y: 560, width: 920, height: 800 }, fontSize: 88 } },
  },
};

// Conservative average glyph width for the bold sans-serif caption font, in em. Only a first estimate for
// wrapping; the render pipeline measures every wrapped line with the real font before rendering (scripts/lib/fit.ts).
export const GLYPH_EM = 0.6;
export const LINE_HEIGHT = 1.25;
export const CAPTION_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
export const CAPTION_WEIGHT = 700;
// Accent bar drawn with the caption: above left-aligned side captions, below centered card captions (px, incl. margin).
export const ACCENT = { height: 8, sideGap: 32, cardGap: 36 };
export const captionDecorHeight = (align: "side" | "center", kind: "clip" | "still" | "card"): number =>
  align === "side" ? ACCENT.height + ACCENT.sideGap : kind === "card" ? ACCENT.height + ACCENT.cardGap : 0;

export const captionCapacity = (style: CaptionStyle) => ({
  charsPerLine: Math.floor(style.box.width / (style.fontSize * GLYPH_EM)),
  lines: Math.floor(style.box.height / (style.fontSize * LINE_HEIGHT)),
});

export const arrangementFor = (srcWidth: number, srcHeight: number): Arrangement =>
  srcWidth / srcHeight < 1 ? "side" : "stack";

export type PlacementCheck = { placement: Placement; visibleX: number; visibleY: number; coverage: number };

export const place = (box: Rect, srcW: number, srcH: number, layout: Layout): PlacementCheck => {
  if (layout.mode === "fit") {
    const scale = Math.min(box.width / srcW, box.height / srcH);
    const drawWidth = srcW * scale;
    const drawHeight = srcH * scale;
    return {
      placement: { box, drawWidth, drawHeight, offsetX: (box.width - drawWidth) / 2, offsetY: (box.height - drawHeight) / 2 },
      visibleX: 1,
      visibleY: 1,
      coverage: (drawWidth * drawHeight) / (box.width * box.height),
    };
  }
  const zoom = layout.zoom ?? 1;
  const scale = Math.max(box.width / srcW, box.height / srcH) * zoom;
  const drawWidth = srcW * scale;
  const drawHeight = srcH * scale;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const offsetX = clamp(box.width / 2 - layout.focusX * drawWidth, box.width - drawWidth, 0);
  const offsetY = clamp(box.height / 2 - layout.focusY * drawHeight, box.height - drawHeight, 0);
  return {
    placement: { box, drawWidth, drawHeight, offsetX, offsetY },
    visibleX: box.width / drawWidth,
    visibleY: box.height / drawHeight,
    coverage: 1,
  };
};
