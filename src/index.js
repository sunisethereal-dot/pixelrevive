// src/index.js
// SPDX-License-Identifier: Apache-2.0
/**
 * PixelRevive: On-Device ESRGAN Image Super-Resolution
 * Powered by Tether's QVAC SDK (@qvac/sdk v0.19.1)
 *
 * Sequence:
 * 1. loadModel({ modelSrc: REALESRGAN_X4PLUS, modelType: "diffusion", modelConfig: { mode: "upscale", upscaler: { tile_size: 128 } }, onProgress })
 * 2. upscale({ modelId, image: imageBytes, repeats: 1 })
 * 3. unloadModel({ modelId })
 * 4. Save output to outputs/upscaled.png
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { 
  loadModel, 
  upscale, 
  unloadModel, 
  REALESRGAN_X4PLUS 
} from '@qvac/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to inspect basic JPEG/PNG dimensions to guard against >2000px OOM
function getImageDimensions(buffer) {
  try {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      // PNG width and height at byte offset 16
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    } else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      // JPEG scan for SOF markers
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] === 0xFF) {
          const marker = buffer[offset + 1];
          if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { width, height };
          }
          offset += 2 + buffer.readUInt16BE(offset + 2);
        } else {
          offset++;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Core Upscale Function
 * Accepts either a file path (string) or an in-memory image Buffer
 */
export async function runUpscale(inputSource, outputPath = path.join(ROOT_DIR, 'outputs', 'upscaled.png'), onProgress = null) {
  console.log('======================================================');
  console.log('  ✨ PIXELREVIVE // ON-DEVICE ESRGAN 4X SUPER-RES   ');
  console.log('======================================================');

  let rawImage;
  let sourceDesc;

  if (Buffer.isBuffer(inputSource)) {
    rawImage = inputSource;
    sourceDesc = `<In-Memory Buffer (${(rawImage.length / 1024).toFixed(1)} KB)>`;
  } else if (typeof inputSource === 'string') {
    if (!fs.existsSync(inputSource)) {
      throw new Error(`Input image file not found: ${inputSource}`);
    }
    rawImage = fs.readFileSync(inputSource);
    sourceDesc = inputSource;
  } else {
    throw new Error('Invalid input image: must be a file path string or Buffer.');
  }

  console.log(`[Input]  ${sourceDesc}`);
  console.log(`[Output] ${outputPath}`);

  const dims = getImageDimensions(rawImage);
  if (dims) {
    console.log(`[Resolution] Input Dimensions: ${dims.width}x${dims.height}`);
    if (dims.width > 2000 || dims.height > 2000) {
      console.warn(`[Warning] Image exceeds 2000px (${dims.width}x${dims.height}). Tile size 128 will be used to protect system memory.`);
    }
  }

  // 1. Load Model with RealESRGAN constant
  console.log('\n[1/3] Loading RealESRGAN upscaler via loadModel()...');
  const loadStart = Date.now();

  const modelId = await loadModel({
    modelSrc: REALESRGAN_X4PLUS,
    modelType: 'diffusion',
    modelConfig: {
      mode: 'upscale',
      upscaler: { tile_size: 128 }
    },
    onProgress: (p) => {
      const pct = (p.percentage || 0).toFixed(0);
      const mb = (n) => ((n || 0) / 1e6).toFixed(1);
      const line = `  ▸ Downloading/Mapping: ${pct}% (${mb(p.downloaded)}/${mb(p.total)} MB)`;
      process.stdout.write(process.stdout.isTTY ? `\r${line}` : `${line}\n`);
      if (onProgress) onProgress(p);
    }
  });

  const loadDuration = ((Date.now() - loadStart) / 1000).toFixed(2);
  console.log(`\n  [PASS] Model loaded in ${loadDuration}s. Model ID: ${modelId}`);

  // 2. Perform Upscaling
  console.log('\n[2/3] Performing 4x super-resolution via upscale()...');
  const upscaleStart = Date.now();

  const { outputs, stats } = upscale({
    modelId,
    image: rawImage,
    repeats: 1
  });

  const [upscaledBuffer] = await outputs;
  const upscaleStats = await stats;
  const upscaleDuration = ((Date.now() - upscaleStart) / 1000).toFixed(2);
  console.log(`  [PASS] Super-resolution completed in ${upscaleDuration}s!`);
  if (upscaleStats) {
    console.log('  [Stats]', upscaleStats);
  }

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, upscaledBuffer);
  console.log(`  [Saved] ${outputPath} (${(upscaledBuffer.length / 1024).toFixed(1)} KB)`);

  // 3. Unload Model
  console.log('\n[3/3] Releasing VRAM / RAM resources via unloadModel()...');
  await unloadModel({ modelId });
  console.log('  [PASS] Model memory deallocated cleanly.');

  console.log('\n======================================================');
  console.log('  ✨ UPSCALING COMPLETED SUCCESSFULLY WITH QVAC SDK');
  console.log('======================================================\n');

  return {
    outputPath,
    loadDuration,
    upscaleDuration,
    stats: upscaleStats,
    outputBuffer: upscaledBuffer
  };
}

let isProcessing = false;

/**
 * Lightweight Local Web Server for Before/After Slider UI & Agent Workspace
 */
function startLocalServer(port = 3000) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS headers for local origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (url.pathname === '/studio' || url.pathname === '/studio.html') {
      const studioPath = path.join(ROOT_DIR, 'public', 'studio.html');
      if (fs.existsSync(studioPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(studioPath));
      } else {
        res.writeHead(404);
        res.end('Studio UI template not found.');
      }
    } else if (url.pathname === '/sample.jpg') {
      const imgPath = path.join(ROOT_DIR, 'sample.jpg');
      if (fs.existsSync(imgPath)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(fs.readFileSync(imgPath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else if (url.pathname === '/outputs/upscaled.png' || url.pathname === '/upscaled.png') {
      const imgPath = path.join(ROOT_DIR, 'outputs', 'upscaled.png');
      if (fs.existsSync(imgPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(imgPath));
      } else {
        res.writeHead(404);
        res.end('Upscaled image not yet generated. Run upscale first.');
      }
    } else if (url.pathname === '/api/upscale' && req.method === 'POST') {
      if (isProcessing) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Engine is currently processing an upscale task on local hardware. Please wait.' 
        }));
        return;
      }

      isProcessing = true;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          let inputData = path.join(ROOT_DIR, 'sample.jpg');
          if (body) {
            try {
              const parsed = JSON.parse(body);
              if (parsed.image) {
                const base64Clean = parsed.image.replace(/^data:image\/\w+;base64,/, '');
                inputData = Buffer.from(base64Clean, 'base64');
              }
            } catch {}
          }
          const outputPath = path.join(ROOT_DIR, 'outputs', 'upscaled.png');
          const result = await runUpscale(inputData, outputPath);
          const upscaledBase64 = fs.readFileSync(outputPath).toString('base64');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            result: {
              outputPath: result.outputPath,
              loadDuration: result.loadDuration,
              upscaleDuration: result.upscaleDuration,
              stats: result.stats
            },
            upscaledDataUrl: `data:image/png;base64,${upscaledBase64}`
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } finally {
          isProcessing = false;
        }
      });
    } else if (url.pathname === '/api/status') {
      const hasUpscaled = fs.existsSync(path.join(ROOT_DIR, 'outputs', 'upscaled.png'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: isProcessing ? 'processing' : 'ready',
        isProcessing,
        hasUpscaled,
        model: 'REALESRGAN_X4PLUS',
        sdkVersion: '0.19.1',
        nodeVersion: process.version,
        tile_size: 128
      }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`🌐 PixelRevive UI running at: http://127.0.0.1:${port}`);
    console.log(`   Interactive Before/After slider ready in browser.`);
  });
}

// Entry point detection
async function main() {
  const rawArgs = process.argv.slice(2);
  const isCliOnly = rawArgs.includes('--cli');
  const isServeOnly = rawArgs.includes('--serve');
  const args = rawArgs.filter((a) => a !== '--cli' && a !== '--serve');
  const positionals = args.filter((a) => !a.startsWith('--'));

  const defaultInput = path.join(ROOT_DIR, 'sample.jpg');
  const targetInput = positionals[0] || defaultInput;
  const targetOutput = positionals[1]
    ? path.resolve(positionals[1])
    : path.join(ROOT_DIR, 'outputs', 'upscaled.png');

  if (isCliOnly || positionals.length > 0) {
    // Pure CLI mode
    try {
      await runUpscale(targetInput, targetOutput);
    } catch (err) {
      console.error('✖ Error:', err.message);
      process.exit(1);
    }
  } else if (isServeOnly || fs.existsSync(targetOutput)) {
    // Start local server instantly if upscaled asset is already ready
    startLocalServer(3000);
  } else {
    // First-run default mode: run initial upscale then launch server
    try {
      await runUpscale(targetInput, targetOutput);
    } catch (err) {
      console.warn('Initial upscale warning (will serve UI):', err.message);
    }
    startLocalServer(3000);
  }
}

main();
