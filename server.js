import express from "express";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { renderMedia } from "@remotion/cli";
import { MyVideo } from "./src/Video"; // تأكد أن عندك ملف Video.tsx في src

const app = express();
app.use(express.json());

// المسار الرئيسي (homepage)
app.get("/", (req, res) => {
  res.send("✅ FFmpeg Video API is running...");
});

// FFmpeg: دمج صور متعددة مع صوت
app.post("/generate", async (req, res) => {
  const { audioUrl, images, duration } = req.body;

  if (!audioUrl || !images || images.length === 0) {
    return res.status(400).json({ error: "audioUrl + images required" });
  }

  const output = `output_${Date.now()}.mp4`;

  const imageInputs = images.map(img => `-loop 1 -t ${duration} -i ${img}`).join(" ");
  const cmd = `ffmpeg ${imageInputs} -i ${audioUrl} -filter_complex "[0:v][1:v]concat=n=${images.length}:v=1:a=0,format=yuv420p" -shortest ${output}`;

  exec(cmd, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "FFmpeg error" });
    }
    res.download(path.resolve(output), () => {
      fs.unlinkSync(output);
    });
  });
});

// Remotion: دمج صورة واحدة مع صوت + كابشن
app.post("/render-video", async (req, res) => {
  const { audioUrl, imageUrl, caption, outputName } = req.body;

  if (!audioUrl || !imageUrl) {
    return res.status(400).json({ error: "audioUrl + imageUrl required" });
  }

  const output = outputName || `remotion_output_${Date.now()}.mp4`;

  try {
    await renderMedia({
      composition: MyVideo,
      serveUrl: ".",
      codec: "h264",
      outputLocation: output,
      inputProps: {
        audioUrl,
        imageUrl,
        caption: caption || ""
      },
    });

    res.download(output, () => {
      fs.unlinkSync(output);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Remotion render error" });
  }
});

// Health check
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
