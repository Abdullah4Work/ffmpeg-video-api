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
  captions?: Caption[];      // accepts array from server (we normalize server-side too)
  captionText?: string;
}> = ({ audioUrl, imageUrl, captions, captionText }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const secToFrame = (s: number) => Math.round(s * fps);

  const buildAutoCaptions = (text: string, audioSeconds: number) => {
    const segments = text
      .split(/(?<=[.؟!?]|,)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return [];
    const total = segments.length;
    let cursor = 0;
    return segments.map((seg) => {
      const segDuration = audioSeconds / total;
      const start = cursor;
      const end = cursor + segDuration;
      cursor = end;
      return { start, end, text: seg };
    });
  };

  const audioSeconds = durationInFrames / fps;

  // Normalize incoming captions (allow {word,start,end} or {text,start,end})
  let effectiveCaptions: Caption[] = [];
  if (captions && captions.length > 0) {
    effectiveCaptions = captions.map((c) => ({
      start: Number((c as any).start || 0),
      end: Number((c as any).end || ((c as any).start || 0) + 1),
      text: (c as any).text || (c as any).word || (c as any).caption || "",
    }));
  } else if (captionText) {
    effectiveCaptions = buildAutoCaptions(captionText, audioSeconds);
  } else {
    effectiveCaptions = [];
  }

  // Image subtle motion
  const imageScaleDriver = spring({
    fps,
    frame,
    config: { damping: 12, stiffness: 80 },
  });
  const breathing = 1 + Math.sin(frame * 0.02) * 0.015;
  const imageScale = 1 + imageScaleDriver * 0.04;
  const finalScale = imageScale * breathing;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={imageUrl}
          style={{
            width: "120%",
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

      <Audio src={audioUrl} />

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
          {effectiveCaptions.map((c, idx) => {
            const startF = secToFrame(c.start);
            const durF = Math.max(1, secToFrame(c.end - c.start));
            return (
              <Sequence key={idx} from={startF} durationInFrames={durF}>
                <CaptionItem text={c.text} durationF={durF} />
              </Sequence>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const CaptionItem: React.FC<{ text: string; durationF: number }> = ({ text, durationF }) => {
  const frame = useCurrentFrame(); // local frame inside Sequence
  const entry = spring({ frame, fps: 30, config: { damping: 10, stiffness: 120 } });
  const pop = interpolate(entry, [0, 1], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationF)));
  const highlightX = -30 + progress * 160;

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
          <div style={highlightStripeStyle} />
          <div style={glowStyle} />
        </div>
      </div>
    </div>
  );
};
