// test/e2e.test.js
// SPDX-License-Identifier: Apache-2.0
/**
 * PixelRevive Automated End-to-End Test Suite
 * Built with native Node.js test runner (node:test & node:assert)
 *
 * Suites:
 * 1. Image Dimensions Parser
 * 2. System Diagnostics Integration
 * 3. Model Cache Inspector
 * 4. Local Server HTTP Endpoints
 * 5. CLI Arguments Validation
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  getImageDimensions,
  runSystemDiagnostics,
  getModelCacheDir,
  getCacheStatus,
  startLocalServer
} from '../src/index.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('PixelRevive Automated End-to-End Test Suite', () => {

  // =========================================================================
  // Test Suite 1: Image Dimensions Parser
  // =========================================================================
  describe('Test Suite 1: Image Dimensions Parser', () => {
    it('parses valid 256x256 PNG buffer correctly', () => {
      const pngBuffer = Buffer.alloc(24);
      // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
      pngBuffer.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
      // IHDR chunk length = 13 (offset 8..11)
      pngBuffer.writeUInt32BE(13, 8);
      // IHDR chunk type (offset 12..15)
      pngBuffer.write('IHDR', 12);
      // Width = 256 at offset 16
      pngBuffer.writeUInt32BE(256, 16);
      // Height = 256 at offset 20
      pngBuffer.writeUInt32BE(256, 20);

      const dims = getImageDimensions(pngBuffer);
      assert.ok(dims !== null, 'Dimensions should not be null for valid PNG buffer');
      assert.strictEqual(dims.width, 256, 'PNG width should be 256');
      assert.strictEqual(dims.height, 256, 'PNG height should be 256');
    });

    it('parses valid 256x256 JPEG buffer correctly', () => {
      // JPEG structure: SOI (FF D8) + SOF0 (FF C0) with 256x256
      const jpegBuffer = Buffer.alloc(19);
      jpegBuffer[0] = 0xFF;
      jpegBuffer[1] = 0xD8; // SOI
      jpegBuffer[2] = 0xFF;
      jpegBuffer[3] = 0xC0; // SOF0 marker
      jpegBuffer.writeUInt16BE(17, 4); // segment length (17 bytes)
      jpegBuffer[6] = 8; // precision (8-bit)
      jpegBuffer.writeUInt16BE(256, 7); // height = 256
      jpegBuffer.writeUInt16BE(256, 9); // width = 256

      const dims = getImageDimensions(jpegBuffer);
      assert.ok(dims !== null, 'Dimensions should not be null for valid JPEG buffer');
      assert.strictEqual(dims.width, 256, 'JPEG width should be 256');
      assert.strictEqual(dims.height, 256, 'JPEG height should be 256');
    });

    it('parses sample.jpg file correctly if present in workspace', () => {
      const samplePath = path.join(ROOT_DIR, 'sample.jpg');
      if (fs.existsSync(samplePath)) {
        const sampleBuffer = fs.readFileSync(samplePath);
        const dims = getImageDimensions(sampleBuffer);
        assert.ok(dims !== null, 'sample.jpg dimensions should be parsed');
        assert.strictEqual(dims.width, 256, 'sample.jpg width should be 256');
        assert.strictEqual(dims.height, 256, 'sample.jpg height should be 256');
      }
    });

    it('returns null safely for corrupt or truncated buffers without throwing', () => {
      const corruptBuffers = [
        Buffer.from('this is not an image'),
        Buffer.from([0x89, 0x50, 0x4E]), // Incomplete PNG header
        Buffer.from([0xFF, 0xD8, 0xFF]), // Truncated JPEG marker
        Buffer.alloc(12, 0x00),          // 12 bytes of zeros
        Buffer.from([0x00, 0xFF, 0xEE, 0xDD])
      ];

      for (const buf of corruptBuffers) {
        const dims = getImageDimensions(buf);
        assert.strictEqual(dims, null, `Corrupt buffer should return null, got ${JSON.stringify(dims)}`);
      }
    });

    it('returns null safely for empty buffer or non-buffer inputs without throwing', () => {
      assert.strictEqual(getImageDimensions(Buffer.alloc(0)), null, 'Empty buffer should return null');
      assert.strictEqual(getImageDimensions(null), null, 'null input should return null');
      assert.strictEqual(getImageDimensions(undefined), null, 'undefined input should return null');
      assert.strictEqual(getImageDimensions('string instead of buffer'), null, 'string input should return null');
      assert.strictEqual(getImageDimensions({}), null, 'plain object input should return null');
    });
  });

  // =========================================================================
  // Test Suite 2: System Diagnostics Integration
  // =========================================================================
  describe('Test Suite 2: System Diagnostics Integration', () => {
    it('runs runSystemDiagnostics() and returns valid checks for platform, node version, and memory', async () => {
      const diagnostics = await runSystemDiagnostics({ silent: true });
      assert.ok(diagnostics, 'Diagnostics result must not be null or undefined');

      // 1. Platform Check
      const platformCheck = diagnostics.platform || 
        (diagnostics.checks && (diagnostics.checks.platform || diagnostics.checks.find?.(c => c.id === 'platform_cpu')));
      assert.ok(platformCheck, 'Diagnostics must include platform check');
      const platformValue = platformCheck.details?.platform || platformCheck.platform || platformCheck.os;
      assert.ok(typeof platformValue === 'string' && platformValue.length > 0, 'Platform value must be a non-empty string');
      assert.ok(['win32', 'darwin', 'linux'].includes(process.platform), 'Platform should be recognized OS');

      // 2. Node Version Check
      const nodeCheck = diagnostics.node || 
        (diagnostics.checks && (diagnostics.checks.node || diagnostics.checks.nodeVersion || diagnostics.checks.find?.(c => c.id === 'node_engine')));
      assert.ok(nodeCheck || diagnostics.nodeVersion, 'Diagnostics must include node version check');
      const nodeVer = diagnostics.nodeVersion || nodeCheck?.details?.currentVersion || nodeCheck?.value;
      assert.match(String(nodeVer), /^v?\d+\.\d+\.\d+/, 'Node version must match semver format');

      // 3. Memory Check
      const memoryCheck = diagnostics.memory || 
        (diagnostics.checks && (diagnostics.checks.memory || diagnostics.checks.find?.(c => c.id === 'memory')));
      assert.ok(memoryCheck, 'Diagnostics must include memory check');
      const memDetails = memoryCheck.details || memoryCheck;
      assert.ok(typeof memDetails.totalBytes === 'number' && memDetails.totalBytes > 0, 'Total memory bytes must be a positive number');
      assert.ok(typeof memDetails.freeBytes === 'number' && memDetails.freeBytes > 0, 'Free memory bytes must be a positive number');
      assert.ok(typeof memDetails.totalGB === 'number' && memDetails.totalGB > 0, 'Total memory GB must be a positive number');

      // Verify overall status is reported
      assert.ok(
        ['ok', 'warning', 'error'].includes(diagnostics.status),
        `Overall diagnostics status must be ok, warning, or error; got: ${diagnostics.status}`
      );
    });
  });

  // =========================================================================
  // Test Suite 3: Model Cache Inspector
  // =========================================================================
  describe('Test Suite 3: Model Cache Inspector', () => {
    it('getModelCacheDir() returns a valid path string without throwing', () => {
      let cacheDir;
      assert.doesNotThrow(() => {
        cacheDir = getModelCacheDir();
      }, 'getModelCacheDir() should not throw');

      assert.strictEqual(typeof cacheDir, 'string', 'getModelCacheDir() must return a string path');
      assert.ok(cacheDir.length > 0, 'getModelCacheDir() path must not be empty');
      assert.ok(cacheDir.includes('.qvac'), 'getModelCacheDir() should reference .qvac directory');
    });

    it('getCacheStatus() returns valid structure without throwing', () => {
      let status;
      assert.doesNotThrow(() => {
        status = getCacheStatus({ fast: true });
      }, 'getCacheStatus() should not throw');

      assert.ok(status !== null && typeof status === 'object', 'getCacheStatus() must return an object');
      assert.strictEqual(typeof status.cacheDir, 'string', 'status.cacheDir must be a string');
      assert.strictEqual(typeof status.exists, 'boolean', 'status.exists must be a boolean');
      assert.ok(Array.isArray(status.files), 'status.files must be an array');
      assert.strictEqual(typeof status.hasRealESRGAN, 'boolean', 'status.hasRealESRGAN must be a boolean');
      assert.ok(typeof status.totalSizeBytes === 'number', 'status.totalSizeBytes must be a number');
      assert.ok(typeof status.totalSizeMB === 'number', 'status.totalSizeMB must be a number');
    });
  });

  // =========================================================================
  // Test Suite 4: Local Server HTTP Endpoints
  // =========================================================================
  describe('Test Suite 4: Local Server HTTP Endpoints', () => {
    const TEST_PORT = 3099;
    let serverInstance = null;

    before(async () => {
      // Start HTTP server on ephemeral port 3099
      serverInstance = startLocalServer(TEST_PORT);
      await new Promise((resolve) => {
        if (serverInstance.listening) {
          resolve();
        } else {
          serverInstance.once('listening', resolve);
        }
      });
    });

    after(async () => {
      // Cleanly close server after all endpoint tests
      if (serverInstance) {
        await new Promise((resolve, reject) => {
          if (typeof serverInstance.closeAllConnections === 'function') {
            serverInstance.closeAllConnections();
          }
          serverInstance.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });

    it('GET /api/status returns 200 OK, JSON with status ready, model name, and SDK version', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`);
      assert.strictEqual(response.status, 200, 'GET /api/status should return 200 OK');

      const contentType = response.headers.get('content-type') || '';
      assert.match(contentType, /application\/json/i, 'GET /api/status Content-Type must be application/json');

      const body = await response.json();
      assert.strictEqual(body.status, 'ready', 'Response status must be ready');
      assert.strictEqual(body.model, 'REALESRGAN_X4PLUS', 'Response model must be REALESRGAN_X4PLUS');
      assert.strictEqual(body.sdkVersion, '0.19.1', 'Response sdkVersion must be 0.19.1');
      assert.strictEqual(body.isProcessing, false, 'Response isProcessing must be false');
      assert.strictEqual(body.tile_size, 128, 'Response tile_size must be 128');
    });

    it('GET / and GET /index.html return 200 OK with HTML content-type', async () => {
      // Test GET /
      const rootRes = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
      assert.strictEqual(rootRes.status, 200, 'GET / should return 200 OK');
      const rootContentType = rootRes.headers.get('content-type') || '';
      assert.match(rootContentType, /text\/html/i, 'GET / Content-Type must be text/html');
      const rootHtml = await rootRes.text();
      assert.ok(rootHtml.length > 0, 'GET / response body must not be empty');

      // Test GET /index.html
      const indexRes = await fetch(`http://127.0.0.1:${TEST_PORT}/index.html`);
      assert.strictEqual(indexRes.status, 200, 'GET /index.html should return 200 OK');
      const indexContentType = indexRes.headers.get('content-type') || '';
      assert.match(indexContentType, /text\/html/i, 'GET /index.html Content-Type must be text/html');
      const indexHtml = await indexRes.text();
      assert.ok(indexHtml.length > 0, 'GET /index.html response body must not be empty');
    });

    it('POST /api/upscale with no body returns 400 Bad Request error response', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/upscale`, {
        method: 'POST',
        body: ''
      });
      assert.strictEqual(response.status, 400, 'POST /api/upscale with no body must return 400 Bad Request');

      const body = await response.json();
      assert.strictEqual(body.success, false, 'Response success flag must be false');
      assert.ok(typeof body.error === 'string' && body.error.length > 0, 'Response must include error message');
    });

    it('POST /api/upscale with invalid JSON returns 400 Bad Request error response', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/upscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"image": invalid-json-here'
      });
      assert.strictEqual(response.status, 400, 'POST /api/upscale with invalid JSON must return 400 Bad Request');

      const body = await response.json();
      assert.strictEqual(body.success, false, 'Response success flag must be false');
      assert.match(body.error, /Invalid JSON body/i, 'Error message should indicate invalid JSON');
    });
  });

  // =========================================================================
  // Test Suite 5: CLI Arguments Validation
  // =========================================================================
  describe('Test Suite 5: CLI Arguments Validation', () => {
    it('running node src/index.js --help exits with code 0 and prints usage help', async () => {
      const entryPoint = path.join(ROOT_DIR, 'src', 'index.js');
      const { stdout, stderr } = await execFileAsync(process.execPath, [entryPoint, '--help'], {
        cwd: ROOT_DIR,
        timeout: 5000
      });

      assert.strictEqual(stderr, '', 'Stderr should be empty on --help');
      assert.match(stdout, /Usage: node src\/index\.js/i, 'Stdout should print usage syntax');
      assert.match(stdout, /--cli/i, 'Stdout should describe --cli flag');
      assert.match(stdout, /--serve/i, 'Stdout should describe --serve flag');
      assert.match(stdout, /--help/i, 'Stdout should describe --help flag');
    });

    it('running node src/index.js -h exits with code 0 and prints usage help', async () => {
      const entryPoint = path.join(ROOT_DIR, 'src', 'index.js');
      const { stdout, stderr } = await execFileAsync(process.execPath, [entryPoint, '-h'], {
        cwd: ROOT_DIR,
        timeout: 5000
      });

      assert.strictEqual(stderr, '', 'Stderr should be empty on -h');
      assert.match(stdout, /Usage: node src\/index\.js/i, 'Stdout should print usage syntax');
    });
  });
});
