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
    if (inputSource.length === 0) {
      throw new Error('Invalid input image: buffer is empty (corrupt image).');
    }
    rawImage = inputSource;
    sourceDesc = `<In-Memory Buffer (${(rawImage.length / 1024).toFixed(1)} KB)>`;
  } else if (typeof inputSource === 'string') {
    if (!fs.existsSync(inputSource)) {
      throw new Error(`Input image file not found: ${inputSource}`);
    }
    try {
      rawImage = fs.readFileSync(inputSource);
    } catch (err) {
      throw new Error(`Input image file unreadable: ${inputSource} (${err.message})`);
    }
    if (!rawImage || rawImage.length === 0) {
      throw new Error(`Invalid input image (empty or corrupt file): ${inputSource}`);
    }
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

  let modelId = null;
  let loadDuration = '0.00';
  let upscaleStart = 0;
  let upscaledBuffer = null;
  let upscaleStats = null;
  let upscaleDuration = '0.00';

  try {
    try {
      modelId = await loadModel({
        modelSrc: REALESRGAN_X4PLUS,
        modelType: 'diffusion',
        modelConfig: {
          mode: 'upscale',
          upscaler: { tile_size: 128 }
        },
        onProgress: (p) => {
          const safe = p ?? {};
          const rawPct = Number(safe.percentage);
          const pct = (Number.isFinite(rawPct) ? rawPct : 0).toFixed(0);
          const mb = (n) => ((Number.isFinite(Number(n)) ? Number(n) : 0) / 1e6).toFixed(1);
          const line = `  ▸ Downloading/Mapping: ${pct}% (${mb(safe.downloaded)}/${mb(safe.total)} MB)`;
          process.stdout.write(process.stdout.isTTY ? `\r${line}` : `${line}\n`);
          if (onProgress) onProgress(p);
        }
      });
    } catch (err) {
      throw new Error(`Failed to load model REALESRGAN_X4PLUS (network down or empty cache?): ${err.message}`);
    }

    loadDuration = ((Date.now() - loadStart) / 1000).toFixed(2);
    console.log(`\n  [PASS] Model loaded in ${loadDuration}s. Model ID: ${modelId}`);

    // 2. Perform Upscaling
    console.log('\n[2/3] Performing 4x super-resolution via upscale()...');
    upscaleStart = Date.now();

    let outputs;
    let stats;
    try {
      ({ outputs, stats } = upscale({
        modelId,
        image: rawImage,
        repeats: 1
      }));
    } catch (err) {
      throw new Error(`Upscale failed to start (OOM or invalid image?): ${err.message}`);
    }
    if (!outputs || !stats) {
      throw new Error('Upscale failed: SDK returned no outputs/stats (OOM or internal error).');
    }

    let resolvedOutputs;
    try {
      resolvedOutputs = await outputs;
      upscaleStats = await stats;
    } catch (err) {
      throw new Error(`Upscale failed (OOM or corrupt image?): ${err.message}`);
    }
    [upscaledBuffer] = resolvedOutputs || [];
    if (!upscaledBuffer || upscaledBuffer.length === 0) {
      throw new Error('Upscale failed: empty output (OOM or corrupt image?).');
    }
    upscaleDuration = ((Date.now() - upscaleStart) / 1000).toFixed(2);
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
  } finally {
    // 3. Unload Model — always release even on upscale/write error
    if (modelId) {
      console.log('\n[3/3] Releasing VRAM / RAM resources via unloadModel()...');
      try {
        await unloadModel({ modelId });
        console.log('  [PASS] Model memory deallocated cleanly.');
      } catch (unloadErr) {
        console.warn(`  [Warn] unloadModel failed: ${unloadErr.message}`);
      }
    }
  }

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
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (url.pathname.includes('..') || url.pathname.includes('%2e') || url.pathname.includes('%2E')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

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
      const indexPath = path.join(ROOT_DIR, 'public', 'index.html');
      try {
        if (!fs.existsSync(indexPath)) {
          res.writeHead(404);
          res.end('UI template not found.');
          return;
        }
        const html = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        if (!res.headersSent) res.writeHead(500);
        res.end(`Failed to serve UI: ${err.message}`);
      }
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
    } else if (url.pathname === '/api/upscale') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
        res.end(JSON.stringify({ success: false, error: 'Method Not Allowed: use POST /api/upscale' }));
        return;
      }
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
      let aborted = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) {
          body = '';
          aborted = true;
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Payload too large.' }));
          }
          req.destroy();
        }
      });
      req.on('error', () => { isProcessing = false; });
      req.on('close', () => { if (aborted) isProcessing = false; });
      req.on('end', async () => {
        if (aborted || res.headersSent) return;
        try {
          let inputData = path.join(ROOT_DIR, 'sample.jpg');
          if (body) {
            let parsed;
            try {
              parsed = JSON.parse(body);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Invalid JSON body.' }));
              return;
            }
            if (parsed && typeof parsed.image === 'string' && parsed.image.length > 0) {
              const base64Clean = parsed.image.replace(/^data:image\/\w+;base64,/, '');
              const decoded = Buffer.from(base64Clean, 'base64');
              if (decoded.length === 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid image data: empty buffer.' }));
                return;
              }
              inputData = decoded;
            } else if (parsed && parsed.image !== undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Invalid image field: must be a base64 string.' }));
              return;
            }
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
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
        res.end(JSON.stringify({ success: false, error: 'Method Not Allowed: use GET /api/status' }));
        return;
      }
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

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`✖ Port ${port} is already in use (127.0.0.1:${port}). Stop the other process or retry with a free port.`);
      process.exit(1);
    } else {
      console.error('✖ Server error:', err?.message || err);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`🌐 PixelRevive UI running at: http://127.0.0.1:${port}`);
    console.log(`   Interactive Before/After slider ready in browser.`);
  });
  return server;
}

// Entry point detection
function printUsage() {
  console.log(`Usage: node src/index.js [--cli] [--serve] [--help] [input] [output]

  input   Input image path (default: sample.jpg). Quote paths with spaces: "my photos/a.jpg"
  output  Output PNG path (default: outputs/upscaled.png)
  --cli   Run upscale once and exit (exit 0 on success, 1 on error)
  --serve Start local UI server only (http://127.0.0.1:3000)
  --help, -h Show this help and exit 0`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    return;
  }
  const isCliOnly = rawArgs.includes('--cli');
  const isServeOnly = rawArgs.includes('--serve');
  if (isCliOnly && isServeOnly) {
    console.error('✖ Error: --cli and --serve are mutually exclusive.');
    printUsage();
    process.exit(1);
  }
  const args = rawArgs.filter((a) => a !== '--cli' && a !== '--serve');
  const unknownFlags = args.filter((a) => a.startsWith('-'));
  if (unknownFlags.length > 0) {
    console.error(`✖ Error: unknown option(s): ${unknownFlags.join(', ')}`);
    printUsage();
    process.exit(1);
  }
  const positionals = args.filter((a) => !a.startsWith('-'));
  if (positionals.length > 2) {
    console.error(`✖ Error: too many arguments (expected at most 2, got ${positionals.length}).`);
    printUsage();
    process.exit(1);
  }

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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error('✖ Error:', err?.message || err);
    process.exit(1);
  });
}
