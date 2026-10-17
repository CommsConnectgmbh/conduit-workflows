import React from "react";
import { Composition } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import type { ResolvedCut } from "./spec/types.ts";
import { Walkthrough } from "./video/Walkthrough.tsx";

// Studio preview only; real renders always pass a resolved cut as input props.
const placeholder = (cut: "long" | "short"): ResolvedCut => {
  const long = cut === "long";
  return {
    specId: "placeholder",
    cut,
    title: "Placeholder",
    fps: 30,
    width: long ? 1920 : 1080,
    height: long ? 1080 : 1920,
    durationInFrames: 60,
    posterScene: 0,
    theme: { background: "#f4f5f7", panel: "#ffffff", text: "#111827", accent: "#2563eb" },
    scenes: [
      {
        index: 0,
        kind: "card",
        from: 0,
        durationInFrames: 60,
        caption: "Placeholder",
        captionLines: ["Placeholder"],
        narration: "Placeholder",
        captionBox: long ? { x: 160, y: 240, width: 1600, height: 600 } : { x: 80, y: 560, width: 920, height: 800 },
        captionFontSize: long ? 96 : 88,
        captionAlign: "center",
      },
    ],
  };
};

const metadata: CalculateMetadataFunction<ResolvedCut> = ({ props }) => ({
  durationInFrames: props.durationInFrames,
  fps: props.fps,
  width: props.width,
  height: props.height,
});

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="long"
      component={Walkthrough}
      defaultProps={placeholder("long")}
      calculateMetadata={metadata}
      durationInFrames={60}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="short"
      component={Walkthrough}
      defaultProps={placeholder("short")}
      calculateMetadata={metadata}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
