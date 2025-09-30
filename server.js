// server.js
import express from "express";
import { exec, spawnSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import multer from "multer";
import { pipeline } from "stream/promises";
import fetch from "node-fetch"; // node18+ يمكن استخدام global fetch

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(".", "out");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// multer
const upload = multer({ dest: OUTPUT_DIR });

async function downloadToFile(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  const writeStream = fs.createWriteStream(destPath);
  await pipeline(resp.body, writeStream);
  return destPath;
}

app.get("/", (req, res) => res.send("✅ FFmpeg Video API is running..."));

app.post("/convert", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    const body = Object.keys(req.body).length ? req.body : req.query;

    let imageFile = req.files && req.files.image && req.files.image[0];
    let audioFile = req.files && req.files.audio && req.files.audio[0];

    const imageUrl = body.imageUrl || body.image_url || body.image;
    const audioUrl = body.audioUrl || body.audio_url || body.audio;

    let captions = body.captions || body.captionsJson || body.captionsjson || null;
    if (typeof captions === "string") {
      try { captions = JSON.parse(captions); } catch (e) { captions = null; }
    }

    const tempFilesToClean = [];
    if (!imageFile && imageUrl) {
      const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
      const tmpImagePath = path.join(OUTPUT_DIR, `image_${Date.now()}${ext}`);
      await downloadToFile(imageUrl, tmpImagePath);
      imageFile = { path: tmpImagePath, originalname: path.basename(tmpImagePath) };
      tempFilesToClean.push(tmpImagePath);
    }
    if (!audioFile && audioUrl) {
      const audioExt = path.extname(new URL(audioUrl).pathname) || ".mp3";
      const tmpAudioPath = path.join(OUTPUT_DIR, `audio_${Date.now()}${audioExt}`);
      await downloadToFile(audioUrl, tmpAudioPath);
      audioFile = { path: tmpAudioPath, originalname: path.basename(tmpAudioPath) };
      tempFilesToClean.push(tmpAudioPath);
    }

    // If captions exist -> use Remotion render
    if (captions && Array.isArray(captions) && captions.length > 0) {
      const props = {
        audioUrl: audioUrl || (audioFile && `file://${audioFile.path}`) || null,
        imageUrl: imageUrl || (imageFile && `file://${imageFile.path}`) || null,
        captions: captions.map((c) => ({
          start: Number(c.start),
          end: Number(c.end),
          text: c.text || c.word || c.caption || "",
        })),
      };

      if (!props.audioUrl || !props.imageUrl) {
        for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
        return res.status(400).json({ error: "audioUrl + imageUrl required for Remotion render" });
      }

      const outName = `remotion_output_${Date.now()}.mp4`;
      const outPath = path.join(OUTPUT_DIR, outName);

      // ---- حساب طول الصوت (ثواني) عبر ffprobe لنعرف عدد الإطارات الذي نحتاجه ----
      let framesArg = null;
      try {
        // نفحص وجود ffprobe (جزء من ffmpeg) ثم نطلب مدته
        const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${props.audioUrl.startsWith("file://") ? props.audioUrl.replace("file://", "") : props.audioUrl}"`;
        const probeResult = spawnSync("bash", ["-lc", ffprobeCmd], { encoding: "utf8", timeout: 20_000 });
        if (probeResult.status === 0) {
          const durSec = parseFloat((probeResult.stdout || "").trim());
          if (!Number.isNaN(durSec) && durSec > 0) {
            const fps = 30; // يتطابق مع composition في src/index.tsx (تأكّد أن الـ fps نفس القيمة هناك)
            const lastFrame = Math.max(0, Math.ceil(durSec * fps) - 1);
            framesArg = `0-${lastFrame}`;
          }
        }
      } catch (e) {
        // لا نكسر التنفيذ لو فشل probe — نترك Remotion يستخدم duration المركب
        console.warn("ffprobe failed:", e?.message || e);
        framesArg = null;
      }

      // نركّب الأمر: استخدم entry = src/index.tsx (الملف اللي فيه registerRoot)
      const propsStr = JSON.stringify(props);
      const args = [
        "remotion",
        "render",
        "src/index.tsx",
        "MyVideo",
        outPath,
        "--props",
        propsStr,
      ];
      if (framesArg) {
        args.push("--frames", framesArg);
      }

      const proc = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";
      proc.stdout.on("data", (d) => {
        // خيار: نبعت لوجز
        // console.log(d.toString());
      });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
        if (code !== 0) {
          console.error("Remotion render error:", stderr);
          return res.status(500).json({ error: "Remotion render failed", details: stderr });
        }
        res.download(outPath, (err) => {
          try { fs.unlinkSync(outPath); } catch (e) {}
          if (err) console.error("Download error:", err);
        });
      });

      return;
    }

    // ELSE: fallback FFmpeg simple image+audio merge
    if (!imageFile || !audioFile) {
      for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
      return res.status(400).json({ error: "Both image and audio required. Send as files or imageUrl/audioUrl." });
    }

    const outPath = path.join(OUTPUT_DIR, `ffmpeg_output_${Date.now()}.mp4`);
    const cmd = `ffmpeg -y -loop 1 -i "${imageFile.path}" -i "${audioFile.path}" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${outPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
      if (err) {
        console.error("FFmpeg error:", stderr || err);
        return res.status(500).json({ error: "FFmpeg processing failed", details: stderr || err.message });
      }
      res.download(outPath, (downloadErr) => {
        try { fs.unlinkSync(outPath); } catch (e) {}
        if (downloadErr) console.error("Download error:", downloadErr);
      });
    });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error", details: e.message });
  }
});

app.get("/health", (req, res) => res.send("OK"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
