// src/index.tsx
import React from "react";
import { registerRoot, Composition, RemotionRoot } from "remotion";
import { MyVideo } from "./Video";

const Root = () => {
  return (
    <RemotionRoot>
      {/* عدّل width/height/fps/durationInFrames حسب حاجتك الافتراضية */}
      <Composition
        id="MyVideo"
        component={MyVideo}
        durationInFrames={30 * 60} // افتراضي: 60 ثانية (30fps * 60s). CLI مع --frames يطغى على هذا.
        fps={30}
        width={1080}
        height={1920}
      />
    </RemotionRoot>
  );
};

registerRoot(Root);
