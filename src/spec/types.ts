// Spec format v1. All times in seconds, all positions as fractions (0..1).

export type CutName = "long" | "short";

export type Layout =
  | { mode: "fit" }
  | { mode: "crop"; focusX: number; focusY: number; zoom?: number };

export type ClipScene = {
  kind: "clip";
  media: string;
  start: number;
  end: number;
  caption: string;
  narration?: string;
  layout?: Layout;
};

export type StillScene = {
  kind: "still";
  media: string;
  duration: number;
  caption: string;
  narration?: string;
  layout?: Layout;
};

export type CardScene = {
  kind: "card";
  duration: number;
  caption: string;
  narration?: string;
};

export type Scene = ClipScene | StillScene | CardScene;

export type Cut = {
  title: string;
  posterScene: number;
  scenes: Scene[];
};

export type Theme = { background: string; panel: string; text: string; accent: string };

export type MediaEntry = { path: string };

export type Spec = {
  version: 1;
  id: string;
  fps: number;
  lang: string;
  theme: Theme;
  media: Record<string, MediaEntry>;
  cuts: Partial<Record<CutName, Cut>>;
};

export type MediaKind = "video" | "image";

// Result of probing a media file (ffprobe for video, ffprobe for image dimensions).
export type MediaInfo = {
  kind: MediaKind;
  width: number;
  height: number;
  // Seconds; only for video. Must be known, otherwise probing fails.
  duration?: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

// Placement of the source inside its media box, in output pixels.
export type Placement = {
  box: Rect;
  // Size and offset of the scaled source relative to the box (may exceed box for crop).
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
};

export type ResolvedScene = {
  index: number;
  kind: Scene["kind"];
  from: number;
  durationInFrames: number;
  caption: string;
  captionLines: string[];
  narration: string;
  // Present for clip/still.
  src?: string;
  mediaKind?: MediaKind;
  // Clips: index of the first source frame at the spec fps (source time 0 = first decoded frame).
  trimBefore?: number;
  // Clips at render time: the clip cut frame-exactly into an image sequence (<dir>/00001.png ...), one image per
  // output frame. Set by the render pipeline; the composition refuses to render a clip without it.
  frames?: { dir: string; count: number };
  placement?: Placement;
  captionBox: Rect;
  captionFontSize: number;
  // "side": left-aligned beside a portrait source (long cut); "center": everything else.
  captionAlign: "side" | "center";
};

export type ResolvedCut = {
  specId: string;
  cut: CutName;
  title: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  posterScene: number;
  theme: Theme;
  scenes: ResolvedScene[];
};

export type Cue = { index: number; startFrame: number; endFrame: number; lines: string[] };
