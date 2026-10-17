import type { MediaInfo, Spec } from "../../src/spec/types.ts";

export const baseSpec = (): Spec => ({
  version: 1,
  id: "fixture",
  fps: 30,
  lang: "en",
  theme: { background: "#eeeeee", panel: "#ffffff", text: "#111111", accent: "#2255ee" },
  media: { walk: { path: "walk.mp4" }, shot: { path: "shot.png" } },
  cuts: {
    long: {
      title: "Fixture",
      posterScene: 1,
      scenes: [
        { kind: "card", duration: 2, caption: "Fixture title" },
        { kind: "clip", media: "walk", start: 1, end: 4, caption: "Open the item." },
        { kind: "still", media: "shot", duration: 2.5, caption: "Check the fields." },
      ],
    },
    short: {
      title: "Fixture short",
      posterScene: 0,
      scenes: [
        { kind: "clip", media: "walk", start: 0.5, end: 2.5, caption: "Open it." },
        { kind: "card", duration: 1.5, caption: "example.com" },
      ],
    },
  },
});

export const phoneMedia = (): Record<string, MediaInfo> => ({
  walk: { kind: "video", width: 780, height: 1688, duration: 10 },
  shot: { kind: "image", width: 780, height: 1688 },
});

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
