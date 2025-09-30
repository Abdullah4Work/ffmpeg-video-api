import express from "express";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

const app = express();
app.use(express.json());

// تأكد أن مجلد out موجود
const OUTPUT_DIR = path.join('.', 'out');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

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

  const output = path.join(OUTPUT_DIR, `output_${Date.now()}.mp4`);
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
  const { audioUrl, imageUrl, caption } = req.body;

  if (!audioUrl || !imageUrl) {
    return res.status(400).json({ error: "audioUrl + imageUrl required" });
  }

  const output = `remotion_output_${Date.now()}.mp4`;

  // نستخدم Remotion CLI بدل الاستيراد المباشر
  const cmd = `npx remotion render src/Video.tsx MyVideo ${path.join(OUTPUT_DIR, output)} --props '{"audioUrl":"${audioUrl}","imageUrl":"${imageUrl}","caption":"${caption || ""}"}'`;

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).json({ error: "Remotion render error", details: stderr });
    }

    res.download(path.resolve(path.join(OUTPUT_DIR, output)), () => {
      fs.unlinkSync(path.join(OUTPUT_DIR, output));
    });
  });
});

// Health check
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
