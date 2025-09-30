const express = require('express');
const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');
const fs = require('fs');
const { getAudioDurationInSeconds } = require('@remotion/media-utils');

const app = express();
app.use(express.json({ limit: '10mb' })); // تقليل الحد

const PORT = process.env.PORT || 10000;

// تنظيف الملفات القديمة
const cleanupOldFiles = () => {
  const outDir = path.join(__dirname, 'out');
  if (fs.existsSync(outDir)) {
    const files = fs.readdirSync(outDir);
    const now = Date.now();
    files.forEach(file => {
      if (file === '.gitkeep') return;
      const filePath = path.join(outDir, file);
      try {
        const stats = fs.statSync(filePath);
        const ageMinutes = (now - stats.mtimeMs) / 1000 / 60;
        if (ageMinutes > 10) { // حذف بعد 10 دقائق
          fs.unlinkSync(filePath);
          console.log(`✓ Deleted: ${file}`);
        }
      } catch (e) {
        console.error(`Error cleaning ${file}:`, e);
      }
    });
  }
};

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Remotion Video API',
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  });
});

app.post('/convert', async (req, res) => {
  const startTime = Date.now();
  const { format = 'mp4', imageUrl, audioUrl, captions = [] } = req.body;

  if (!imageUrl || !audioUrl) {
    return res.status(400).json({ error: 'imageUrl and audioUrl required' });
  }

  console.log('🎬 Starting render...');
  console.log(`📊 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

  const outputFileName = `video-${Date.now()}.${format}`;
  const outputPath = path.join(__dirname, 'out', outputFileName);

  // تنظيف قبل البدء
  cleanupOldFiles();

  // فورس garbage collection
  if (global.gc) global.gc();

  try {
    // الحصول على مدة الأوديو
    const audioDuration = await getAudioDurationInSeconds(audioUrl);
    const durationInFrames = Math.ceil(audioDuration * 30);

    console.log(`⏱️  Duration: ${audioDuration.toFixed(2)}s (${durationInFrames} frames)`);

    // Bundle
    console.log('📦 Bundling...');
    const bundleLocation = await bundle({
      entryPoint: path.join(__dirname, 'src/index.tsx'),
      webpackOverride: (config) => {
        config.resolve = {
          ...config.resolve,
          extensions: ['.tsx', '.ts', '.js', '.jsx'],
        };
        // تقليل استخدام الذاكرة في webpack
        config.optimization = {
          ...config.optimization,
          minimize: false, // إيقاف الـ minification لتوفير ذاكرة
        };
        return config;
      },
    });

    console.log('✓ Bundle ready');

    // Select composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'MyVideo',
      inputProps: { imageUrl, audioUrl, captions },
    });

    console.log('✓ Composition selected');

    // Render بإعدادات موفرة للذاكرة
    await renderMedia({
      composition: {
        ...composition,
        durationInFrames,
        fps: 30,
        width: 1080,
        height: 1920,
      },
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: { imageUrl, audioUrl, captions },
      
      // ⚡ الإعدادات الرئيسية لتوفير الذاكرة
      concurrency: 1, // معالجة فريم واحد في نفس الوقت
      disallowParallelEncoding: true, // إيقاف الـ parallel encoding
      imageFormat: 'jpeg', // JPEG أخف من PNG
      jpegQuality: 80, // تقليل الجودة قليلاً
      
      // إعدادات الفيديو
      crf: 23,
      pixelFormat: 'yuv420p',
      
      // تقليل حجم الكاش
      offthreadVideoCacheSizeInBytes: 50 * 1024 * 1024, // 50MB فقط
      
      // إعدادات المتصفح
      chromiumOptions: {
        enableMultiProcessOnLinux: false, // استخدام process واحد
        gl: 'swangle', // أخف renderer
        ignoreCertificateErrors: true,
      },
      
      // تقليل timeout
      timeoutInMilliseconds: 180000, // 3 دقائق
      
      // لوقينق أقل
      logLevel: 'info',
      
      onProgress: ({ progress, renderedFrames, encodedFrames }) => {
        const percent = Math.floor(progress * 100);
        if (percent % 5 === 0) { // كل 5%
          const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          console.log(`⏳ ${percent}% | Rendered: ${renderedFrames} | Encoded: ${encodedFrames} | RAM: ${mem}MB`);
          
          // garbage collection كل فترة
          if (global.gc && percent % 20 === 0) {
            global.gc();
          }
        }
      },
      
      onStart: ({ frameCount }) => {
        console.log(`🎥 Rendering ${frameCount} frames...`);
      },
    });

    const renderTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Render complete in ${renderTime}s`);
    console.log(`📊 Final memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

    // إرسال الملف
    res.download(outputPath, outputFileName, (err) => {
      if (err) {
        console.error('❌ Download error:', err);
      }
      // حذف الملف بعد الإرسال
      setTimeout(() => {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log('🗑️  Deleted:', outputFileName);
        }
        // تنظيف نهائي
        if (global.gc) global.gc();
      }, 3000);
    });

  } catch (error) {
    console.error('❌ Render error:', error.message);
    res.status(500).json({ 
      error: 'Render failed', 
      message: error.message,
    });
    
    // تنظيف عند الخطأ
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    if (global.gc) global.gc();
  }
});

// Graceful shutdown
const shutdown = () => {
  console.log('🛑 Shutting down...');
  cleanupOldFiles();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// تنظيف دوري كل 5 دقائق
setInterval(cleanupOldFiles, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Initial memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  cleanupOldFiles();
});
