import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ACCENT, CAPTION_FONT, CAPTION_WEIGHT, LINE_HEIGHT } from "../spec/layout.ts";
import type { ResolvedCut, ResolvedScene, Theme } from "../spec/types.ts";

// Clips are not decoded in the browser: seeking a video to t = n / fps lands exactly on the boundary between two
// source frames, and which one the decoder returns there is not deterministic. The render pipeline cuts every clip
// into one image per output frame with ffmpeg, so output frame k of the scene shows image k by construction.
const ClipFrame: React.FC<{ scene: ResolvedScene; style: React.CSSProperties }> = ({ scene, style }) => {
  const frame = useCurrentFrame();
  const f = scene.frames;
  if (!f) throw new Error(`clip scene ${scene.index} has no cut frame sequence`);
  // Negative frames only occur while the sequence is premounted (invisible).
  const i = Math.max(0, frame);
  if (i >= f.count) throw new Error(`clip scene ${scene.index}: frame ${i} beyond its ${f.count} cut frames`);
  return <Img src={staticFile(`${f.dir}/${String(i + 1).padStart(5, "0")}.png`)} style={style} />;
};

const Media: React.FC<{ scene: ResolvedScene; theme: Theme }> = ({ scene }) => {
  const p = scene.placement!;
  // Clip the visible part of the drawn source to the media box.
  const visX = Math.max(0, p.offsetX);
  const visY = Math.max(0, p.offsetY);
  const visW = Math.min(p.box.width, p.offsetX + p.drawWidth) - visX;
  const visH = Math.min(p.box.height, p.offsetY + p.drawHeight) - visY;
  const inner: React.CSSProperties = {
    position: "absolute",
    left: p.offsetX - visX,
    top: p.offsetY - visY,
    width: p.drawWidth,
    height: p.drawHeight,
  };
  return (
    <div
      style={{
        position: "absolute",
        left: p.box.x + visX,
        top: p.box.y + visY,
        width: visW,
        height: visH,
        overflow: "hidden",
        borderRadius: 28,
        boxShadow: "0 18px 50px rgba(0,0,0,0.18)",
        background: "#000",
      }}
    >
      {scene.kind === "clip" ? <ClipFrame scene={scene} style={inner} /> : <Img src={staticFile(scene.src!)} style={inner} />}
    </div>
  );
};

const Caption: React.FC<{ scene: ResolvedScene; theme: Theme }> = ({ scene, theme }) => {
  const centered = scene.captionAlign === "center";
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shift = interpolate(frame, [0, 8], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const b = scene.captionBox;
  return (
    <div
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.width,
        height: b.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        textAlign: centered ? "center" : "left",
        opacity,
        transform: `translateY(${shift}px)`,
      }}
    >
      {!centered && <div style={{ width: 72, height: ACCENT.height, borderRadius: 4, background: theme.accent, marginBottom: ACCENT.sideGap }} />}
      {scene.captionLines.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: CAPTION_FONT,
            fontWeight: CAPTION_WEIGHT,
            fontSize: scene.captionFontSize,
            lineHeight: LINE_HEIGHT,
            color: theme.text,
            whiteSpace: "nowrap",
          }}
        >
          {line}
        </div>
      ))}
      {centered && scene.kind === "card" && (
        <div style={{ width: 96, height: ACCENT.height, borderRadius: 4, background: theme.accent, marginTop: ACCENT.cardGap }} />
      )}
    </div>
  );
};

const SceneView: React.FC<{ scene: ResolvedScene; cut: ResolvedCut }> = ({ scene, cut }) => {
  return (
    <AbsoluteFill>
      {scene.kind !== "card" && <Media scene={scene} theme={cut.theme} />}
      <Caption scene={scene} theme={cut.theme} />
    </AbsoluteFill>
  );
};

export const Walkthrough: React.FC<ResolvedCut> = (cut) => (
  <AbsoluteFill style={{ background: cut.theme.background }}>
    {cut.scenes.map((s) => (
      <Sequence key={s.index} from={s.from} durationInFrames={s.durationInFrames} premountFor={cut.fps}>
        <SceneView scene={s} cut={cut} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
