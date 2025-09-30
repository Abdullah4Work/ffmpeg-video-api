import { AbsoluteFill, Audio, Sequence, Img, useVideoConfig } from "remotion";

export const MyVideo: React.FC<{
  audioUrl: string;
  imageUrl: string;
  caption: string;
}> = ({ audioUrl, imageUrl, caption }) => {
  const { durationInFrames, fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Img src={imageUrl} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      <Audio src={audioUrl} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <h1 style={{ color: "white", fontSize: 60, textAlign: "center" }}>{caption}</h1>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
