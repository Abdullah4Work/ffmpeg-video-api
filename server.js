import express from "express";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import multer from "multer";
import { pipeline } from "stream/promises";
import fetch from "node-fetch"; // optional if node <18; on node18+ you can use global fetch

const app = express();

// Body parsing for JSON (keeps working for JSON endpoints)
app.use(express.json());

// تأكد أن مجلد out موجود
const OUTPUT_DIR = path.join(".", "out");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// multer: نحفظ الملفات مؤقتاً داخل OUT
const upload = multer({ dest: OUTPUT_DIR });

// homepage
app.get("/", (req, res) => {
  res.send("✅ FFmpeg Video API is running...");
});

/**
 * Utility: download URL -> file path
 */
async function downloadToFile(url, destPath) {
  // node18+ has global fetch. If your environment doesn't, we used node-fetch import above.
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  const writeStream = fs.createWriteStream(destPath);
  await pipeline(resp.body, writeStream);
  return destPath;
}

/**
 * NEW endpoint: /convert
 * - يدعم:
 *    • إرسال ملفات باينري (fields: image, audio) كـ multipart/form-data
 *    • أو إرسال روابط مباشرة (fields: imageUrl, audioUrl) كـ multipart/form-data أو JSON
 * - يعيد ملف mp4 جاهز كـ download
 */
app.post("/convert", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    const format = (req.body.format || "mp4").toLowerCase();

    // 1) ملفات مرسلة مباشرة (multer)
    let imageFile = req.files && req.files.image && req.files.image[0];
    let audioFile = req.files && req.files.audio && req.files.audio[0];

    // 2) أو روابط مرسلة كحقول text (imageUrl/audioUrl)
    const imageUrl = req.body.imageUrl || req.body.image_url || req.body.image;
    const audioUrl = req.body.audioUrl || req.body.audio_url || req.body.audio;

    const tempFilesToClean = [];

    // إذا في رابط للصورة ونهاية لم يتم رفع ملف
    if (!imageFile && imageUrl) {
      const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
      const tmpImagePath = path.join(OUTPUT_DIR, `image_${Date.now()}${ext}`);
      await downloadToFile(imageUrl, tmpImagePath);
      imageFile = { path: tmpImagePath, originalname: path.basename(tmpImagePath) };
      tempFilesToClean.push(tmpImagePath);
    }

    // إذا في رابط للصوت ونهاية لم يتم رفع ملف
    if (!audioFile && audioUrl) {
      const audioExt = path.extname(new URL(audioUrl).pathname) || ".mp3";
      const tmpAudioPath = path.join(OUTPUT_DIR, `audio_${Date.now()}${audioExt}`);
      await downloadToFile(audioUrl, tmpAudioPath);
      audioFile = { path: tmpAudioPath, originalname: path.basename(tmpAudioPath) };
      tempFilesToClean.push(tmpAudioPath);
    }

    // تحقق
    if (!imageFile || !audioFile) {
      // نظّف أي ملفات منزلقة جزئياً
      for (const f of tempFilesToClean) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
      return res.status(400).json({ error: "Both image and audio required. Send as files (image, audio) or as URLs (imageUrl, audioUrl)." });
    }

    // نعمل اسم ملف الإخراج داخل OUT
    const outPath = path.join(OUTPUT_DIR, `ffmpeg_output_${Date.now()}.${format}`);

    // صيغة أمر FFmpeg لعمل فيديو من صورة ثابتة + ملف صوتي
    // -loop 1: تكرار الصورة لمدى الصوت
    // -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest
    const cmd = `ffmpeg -y -loop 1 -i "${imageFile.path}" -i "${audioFile.path}" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${outPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      // مسح الملفات المؤقتة (الصوت/الصورة) لو كانت من تحميل مؤقت
      for (const f of tempFilesToClean) {
        try { fs.unlinkSync(f); } catch (e) {}
      }

      if (err) {
        console.error("FFmpeg error:", err, stderr);
        return res.status(500).json({ error: "FFmpeg processing failed", details: stderr || err.message });
      }

      // إرسال الملف للمستخدِم ثم حذفه
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

// Health
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
