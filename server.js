// server.js
import express from "express";
import { exec, spawn } from "child_process";
import path from "path";
import fs from "fs";
import multer from "multer";
import { pipeline } from "stream/promises";
import fetch from "node-fetch"; // node18+ يمكن استخدام global fetch

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(".", "out");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// multer يسمح بإستقبال ملفات أو حقول form-data
const upload = multer({ dest: OUTPUT_DIR });

async function downloadToFile(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  const writeStream = fs.createWriteStream(destPath);
  await pipeline(resp.body, writeStream);
  return destPath;
}

// homepage
app.get("/", (req, res) => {
  res.send("✅ FFmpeg Video API is running...");
});

/**
 * /convert:
 *  - يدعم إرسال imageUrl + audioUrl + captionsJson (أو captions كمصفوفة) عبر form-data أو JSON
 *  - إذا وجد captions => نفذ Remotion render باستخدام src/Video.tsx (مرر props.captions)
 *  - وإلا استخدم FFmpeg لدمج الصورة مع الصوت
 */
app.post("/convert", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    // form-data fields or JSON body
    const body = Object.keys(req.body).length ? req.body : req.query;

    // check files (multer)
    let imageFile = req.files && req.files.image && req.files.image[0];
    let audioFile = req.files && req.files.audio && req.files.audio[0];

    // or URLs from fields
    const imageUrl = body.imageUrl || body.image_url || body.image;
    const audioUrl = body.audioUrl || body.audio_url || body.audio;

    // captions may come as JSON-string under captions or captionsJson, or as an actual array
    let captions = body.captions || body.captionsJson || body.captionsjson || null;
    if (typeof captions === "string") {
      try {
        captions = JSON.parse(captions);
      } catch (e) {
        // ignore parse error - will be handled below
        captions = null;
      }
    }

    // If files not uploaded, download from URLs (if provided)
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

    // If captions present -> use Remotion render (to create captioned animated video)
    if (captions && Array.isArray(captions) && captions.length > 0) {
      // Build props to pass to Remotion
      const props = {
        audioUrl: audioUrl || (audioFile && `file://${audioFile.path}`) || null,
        imageUrl: imageUrl || (imageFile && `file://${imageFile.path}`) || null,
        // normalize caption items: support {word,start,end} or {text,start,end}
        captions: captions.map((c) => ({
          start: Number(c.start),
          end: Number(c.end),
          text: c.text || c.word || c.content || "",
        })),
      };

      // validate
      if (!props.audioUrl || !props.imageUrl) {
        // cleanup temporaries
        for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
        return res.status(400).json({ error: "audioUrl + imageUrl required for Remotion render" });
      }

      const outName = `remotion_output_${Date.now()}.mp4`;
      const outPath = path.join(OUTPUT_DIR, outName);

      // spawn npx remotion render ... --props '<json>'
      const propsStr = JSON.stringify(props);
      const args = [
        "remotion",
        "render",
        "src/Video.tsx",
        "MyVideo",
        outPath,
        "--props",
        propsStr,
      ];

      const proc = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";
      proc.stdout.on("data", (d) => {
        // optionally stream logs
        // console.log(d.toString());
      });
      proc.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      proc.on("close", (code) => {
        // cleanup downloaded temps
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

      return; // finished branch
    }

    // ELSE: fallback FFmpeg simple image+audio merge (existing behavior)
    if (!imageFile || !audioFile) {
      // cleanup
      for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
      return res.status(400).json({ error: "Both image and audio required. Send as files or imageUrl/audioUrl." });
    }

    const outPath = path.join(OUTPUT_DIR, `ffmpeg_output_${Date.now()}.mp4`);
    const cmd = `ffmpeg -y -loop 1 -i "${imageFile.path}" -i "${audioFile.path}" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${outPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      // cleanup temps
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

// health
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
