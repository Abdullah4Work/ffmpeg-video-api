// server.js
import express from "express";
import { exec, spawnSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import multer from "multer";
import { pipeline } from "stream/promises";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: '10mb' })); // حد للـ JSON

const OUTPUT_DIR = path.join(".", "out");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Multer مع حد للحجم
const upload = multer({ 
  dest: OUTPUT_DIR,
  limits: { fileSize: 50 * 1024 * 1024 } // max 50MB per file
});

// الحد الأقصى للرام (بالبايت)
const MAX_MEMORY_MB = 450;
const MAX_MEMORY_BYTES = MAX_MEMORY_MB * 1024 * 1024;

// دالة لمراقبة وتنظيف الذاكرة
function checkAndCleanMemory() {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
  
  if (usage.heapUsed > MAX_MEMORY_BYTES * 0.85) { // لو وصلنا 85% من الحد
    console.warn(`⚠️  Memory high: ${usedMB}MB / ${MAX_MEMORY_MB}MB - Running GC...`);
    if (global.gc) {
      global.gc(); // تشغيل Garbage Collector يدوياً
      const afterGC = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`✅ Memory after GC: ${afterGC}MB`);
    }
  }
  
  return usedMB;
}

// مراقبة الذاكرة كل 30 ثانية
setInterval(() => {
  const usedMB = checkAndCleanMemory();
  console.log(`💾 Memory: ${usedMB}MB / ${MAX_MEMORY_MB}MB`);
}, 30000);

// حذف الملفات القديمة من OUTPUT_DIR (أكثر من ساعة)
function cleanOldFiles() {
  try {
    const files = fs.readdirSync(OUTPUT_DIR);
    const now = Date.now();
    let cleaned = 0;
    
    files.forEach(file => {
      const filePath = path.join(OUTPUT_DIR, file);
      const stats = fs.statSync(filePath);
      const ageMinutes = (now - stats.mtimeMs) / 1000 / 60;
      
      if (ageMinutes > 60) { // ملفات أقدم من ساعة
        fs.unlinkSync(filePath);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} old files`);
    }
  } catch (e) {
    console.error("Error cleaning old files:", e.message);
  }
}

// تنظيف الملفات القديمة كل 15 دقيقة
setInterval(cleanOldFiles, 15 * 60 * 1000);

async function downloadToFile(url, destPath) {
  const resp = await fetch(url, { timeout: 30000 }); // timeout 30s
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  const writeStream = fs.createWriteStream(destPath);
  await pipeline(resp.body, writeStream);
  return destPath;
}

app.get("/", (req, res) => {
  const usedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  res.send(`✅ FFmpeg Video API is running... (Memory: ${usedMB}MB / ${MAX_MEMORY_MB}MB)`);
});

app.get("/health", (req, res) => res.status(200).send("OK"));

// Middleware للتحقق من الذاكرة قبل كل طلب
app.use((req, res, next) => {
  const usage = process.memoryUsage();
  if (usage.heapUsed > MAX_MEMORY_BYTES * 0.95) { // لو وصلنا 95%
    console.error(`❌ Memory critical: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
    return res.status(503).json({ 
      error: "Server memory full, try again in a moment",
      memoryUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
      memoryLimit: `${MAX_MEMORY_MB}MB`
    });
  }
  next();
});

app.post("/convert", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  const tempFilesToClean = [];
  
  try {
    checkAndCleanMemory(); // تنظيف قبل البدء
    
    const body = Object.keys(req.body).length ? req.body : req.query;

    let imageFile = req.files && req.files.image && req.files.image[0];
    let audioFile = req.files && req.files.audio && req.files.audio[0];

    const imageUrl = body.imageUrl || body.image_url || body.image;
    const audioUrl = body.audioUrl || body.audio_url || body.audio;

    let captions = body.captions || body.captionsJson || body.captionsjson || null;
    if (typeof captions === "string") {
      try { captions = JSON.parse(captions); } catch (e) { captions = null; }
    }

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

    if (captions && Array.isArray(captions) && captions.length > 0) {
      const props = {
        audioUrl: audioUrl || (audioFile && `file://${path.resolve(audioFile.path)}`) || null,
        imageUrl: imageUrl || (imageFile && `file://${path.resolve(imageFile.path)}`) || null,
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

      let framesArg = null;
      try {
        const audioPath = props.audioUrl.startsWith("file://") ? props.audioUrl.replace("file://", "") : props.audioUrl;
        const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
        const probeResult = spawnSync("bash", ["-lc", ffprobeCmd], { encoding: "utf8", timeout: 10000 });
        if (probeResult.status === 0) {
          const durSec = parseFloat((probeResult.stdout || "").trim());
          if (!Number.isNaN(durSec) && durSec > 0) {
            const fps = 30;
            const lastFrame = Math.max(0, Math.ceil(durSec * fps) - 1);
            framesArg = `0-${lastFrame}`;
          }
        }
      } catch (e) {
        console.warn("ffprobe failed:", e?.message || e);
      }

      const propsStr = JSON.stringify(props);
      const args = [
        "remotion", "render",
        "src/index.tsx", "MyVideo",
        outPath,
        "--props", propsStr,
        "--concurrency", "1", // عملية واحدة فقط لتوفير الرام
      ];
      if (framesArg) {
        args.push("--frames", framesArg);
      }

      const proc = spawn("npx", args, { 
        stdio: ["ignore", "pipe", "pipe"],
        env: { 
          ...process.env, 
          NODE_OPTIONS: `--max-old-space-size=${MAX_MEMORY_MB}` 
        }
      });

      let stderr = "";
      proc.stdout.on("data", (d) => process.stdout.write(d));
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        // حذف الملفات المؤقتة فوراً
        for (const f of tempFilesToClean) {
          try { fs.unlinkSync(f); } catch (e) {}
        }
        
        checkAndCleanMemory(); // تنظيف بعد الانتهاء
        
        if (code !== 0) {
          console.error("Remotion render error:", stderr);
          try { fs.unlinkSync(outPath); } catch (e) {}
          return res.status(500).json({ error: "Remotion render failed", details: stderr });
        }
        
        res.download(outPath, (err) => {
          try { fs.unlinkSync(outPath); } catch (e) {}
          if (err) console.error("Download error:", err);
        });
      });

      return;
    }

    // FFmpeg fallback
    if (!imageFile || !audioFile) {
      for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
      return res.status(400).json({ error: "Both image and audio required. Send as files or imageUrl/audioUrl." });
    }

    const outPath = path.join(OUTPUT_DIR, `ffmpeg_output_${Date.now()}.mp4`);
    const cmd = `ffmpeg -y -loop 1 -i "${imageFile.path}" -i "${audioFile.path}" -c:v libx264 -preset ultrafast -c:a aac -pix_fmt yuv420p -shortest "${outPath}"`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
      
      checkAndCleanMemory();
      
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
    for (const f of tempFilesToClean) try { fs.unlinkSync(f); } catch (e) {}
    checkAndCleanMemory();
    return res.status(500).json({ error: "Server error", details: e.message });
  }
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`💾 Memory limit: ${MAX_MEMORY_MB}MB`);
  console.log(`📊 Current usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
});

// معالجة الإيقاف
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// لو صار out of memory error - نحاول ننظف ونكمل
process.on('uncaughtException', (err) => {
  if (err.message.includes('heap') || err.message.includes('memory')) {
    console.error('❌ Memory error caught:', err.message);
    if (global.gc) global.gc();
  } else {
    console.error('❌ Uncaught exception:', err);
    process.exit(1);
  }
});
