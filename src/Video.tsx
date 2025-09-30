// src/Video.tsx
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";

type Caption = {
  start: number; // seconds
  end: number;   // seconds
  text: string;
};

export const MyVideo: React.FC<{
  audioUrl: string;
  imageUrl: string;
  // preferred: array of captions with timestamps (seconds)
  captions?: Caption[];
  // fallback: plain text to auto-split proportionally across audio length
  captionText?: string;
}> = ({ audioUrl, imageUrl, captions, captionText }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // convert seconds -> frames
  const secToFrame = (s: number) => Math.round(s * fps);

  // If captions not provided but captionText is, create rough timings:
  const buildAutoCaptions = (text: string, audioSeconds: number) => {
    // split on sentences or commas as a simple heuristic
    const segments = text
      .split(/(?<=[.؟!?]|,)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return [];

    const total = segments.length;
    let cursor = 0;
    return segments.map((seg, i) => {
      const segDuration = audioSeconds / total;
      const start = cursor;
      const end = cursor + segDuration;
      cursor = end;
      return { start, end, text: seg };
    });
  };

  // Try to infer audio duration in seconds from durationInFrames if possible
  // NOTE: For reliable results, set composition duration to match audio duration in frames when rendering.
  const audioSeconds = durationInFrames / fps;

  let effectiveCaptions: Caption[] = [];
  if (captions && captions.length > 0) {
    effectiveCaptions = captions;
  } else if (captionText) {
    effectiveCaptions = buildAutoCaptions(captionText, audioSeconds);
  } else {
    effectiveCaptions = [];
  }

  // Background image animation (gentle scale + parallax)
  const imageScaleDriver = spring({
    fps,
    frame,
    config: { damping: 12, stiffness: 80 },
  });
  // subtle breathing effect using a sin wave based on frame (gives continuous motion)
  const breathing = 1 + Math.sin(frame * 0.02) * 0.015; // ±1.5%
  const imageScale = 1 + imageScaleDriver * 0.04; // entrance scale up to +4%
  const finalScale = imageScale * breathing;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Background image */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={imageUrl}
          style={{
            width: "120%", // allow some zoom
            height: "120%",
            objectFit: "cover",
            transform: `scale(${finalScale})`,
            transition: "transform 200ms linear",
            position: "absolute",
            left: "-10%",
            top: "-10%",
            filter: "contrast(1) saturate(1.05)",
          }}
        />
        {/* subtle overlay for readability */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.6) 100%)",
            pointerEvents: "none",
          }}
        />
      </AbsoluteFill>

      {/* audio track */}
      <Audio src={audioUrl} />

      {/* Captions container (bottom centered) */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 80,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "90%",
            maxWidth: 1024,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "center",
          }}
        >
          {/* Render each caption as a Sequence so it only exists during its window */}
          {effectiveCaptions.map((c, idx) => {
            const startF = secToFrame(c.start);
            const durF = Math.max(1, secToFrame(c.end - c.start));
            return (
              <Sequence key={idx} from={startF} durationInFrames={durF}>
                <CaptionItem text={c.text} progressFrame={useCurrentFrame()} durationF={durF} />
              </Sequence>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * CaptionItem
 * - text: caption text
 * - progressFrame: current frame inside the Sequence (useCurrentFrame())
 * - durationF: duration of the caption in frames
 *
 * This component creates:
 *  - text with soft glow
 *  - moving white highlight (a shining mask) that travels left→right with progress
 *  - subtle pop animation at start using spring
 */
const CaptionItem: React.FC<{ text: string; progressFrame: number; durationF: number }> = ({
  text,
  progressFrame,
  durationF,
}) => {
  const frame = progressFrame;
  // entry animation
  const entry = spring({ frame, fps: 30, config: { damping: 10, stiffness: 120 } });
  const pop = interpolate(entry, [0, 1], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // compute progress 0..1 for highlight movement
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationF)));

  // highlight transform (move from -30% to 130%)
  const highlightX = -30 + progress * 160; // percent

  // text styles
  const baseTextStyle: React.CSSProperties = {
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 700,
    fontSize: 48,
    lineHeight: "1.1",
    color: "#fff",
    textAlign: "center",
    padding: "16px 28px",
    borderRadius: 12,
    position: "relative",
    transform: `scale(${pop})`,
    willChange: "transform",
    textShadow: "0 6px 20px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)",
    background: "linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
    backdropFilter: "blur(6px)",
  };

  // highlight stripe element style
  const highlightStripeStyle: React.CSSProperties = {
    position: "absolute",
    left: `${highlightX}%`,
    top: 0,
    bottom: 0,
    width: "28%",
    transform: "skewX(-18deg)",
    background:
      "linear-gradient(90deg, rgba(255,255,255,0.0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.0) 100%)",
    filter: "blur(10px)",
    mixBlendMode: "screen",
    pointerEvents: "none",
    transition: "left 0.05s linear",
  };

  // optional glow pulse synced with highlight
  const glowOpacity = 0.25 + 0.75 * Math.sin(progress * Math.PI);
  const glowStyle: React.CSSProperties = {
    position: "absolute",
    left: -6,
    right: -6,
    top: -6,
    bottom: -6,
    borderRadius: 14,
    boxShadow: `0 0 40px rgba(255,255,255,${glowOpacity})`,
    opacity: glowOpacity,
    pointerEvents: "none",
    mixBlendMode: "screen",
  };

  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 900 }}>
        <div style={baseTextStyle}>
          <div style={{ position: "relative", zIndex: 2 }}>{text}</div>
          {/* moving white highlight */}
          <div style={highlightStripeStyle} />
          {/* glow overlay */}
          <div style={glowStyle} />
        </div>
      </div>
    </div>
  );
};
