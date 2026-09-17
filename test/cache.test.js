// test/cache.test.js
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { 
  getModelCacheDir, 
  getCacheStatus, 
  cleanCache, 
  KNOWN_MODELS, 
  verifyModelIntegrity, 
  getDirectorySize 
} from '../src/cache.js';

console.log('🧪 Starting Model Cache Management Tests...\n');

// Test 1: getModelCacheDir
console.log('Test 1: getModelCacheDir resolves default ~/.qvac path');
const defaultCacheDir = getModelCacheDir();
assert.ok(typeof defaultCacheDir === 'string');
assert.strictEqual(defaultCacheDir, path.join(os.homedir(), '.qvac'));
const modelsSubDir = getModelCacheDir('models');
assert.strictEqual(modelsSubDir, path.join(os.homedir(), '.qvac', 'models'));
console.log('  ✔ Passed: getModelCacheDir matches os.homedir()/.qvac\n');

// Test 2: getCacheStatus on real environment
console.log('Test 2: getCacheStatus scans existing cache accurately');
const realStatus = getCacheStatus();
assert.ok(realStatus.cacheDir.endsWith('.qvac'));
assert.ok(typeof realStatus.totalSizeMB === 'number');
assert.ok(Array.isArray(realStatus.files));
assert.ok(typeof realStatus.hasRealESRGAN === 'boolean');
assert.ok(typeof realStatus.completeness === 'object');
assert.ok(typeof realStatus.readiness === 'object');
console.log(`  ✔ Passed: Found ${realStatus.filesCount} file(s), RealESRGAN ready: ${realStatus.readiness.isReady}\n`);

// Test 3: cleanCache & getCacheStatus on isolated mock sandbox
console.log('Test 3: Isolated sandbox testing for temporary and corrupt files');
const sandboxDir = path.join(os.tmpdir(), 'qvac-test-sandbox-' + Date.now());
const sandboxModels = path.join(sandboxDir, 'models');
fs.mkdirSync(sandboxModels, { recursive: true });

try {
  // Create valid model file
  const validFile = path.join(sandboxModels, 'valid-model.gguf');
  fs.writeFileSync(validFile, Buffer.alloc(1024 * 1024)); // 1MB

  // Create temporary file (.tmp)
  const tmpFile = path.join(sandboxModels, 'model_part.tmp');
  fs.writeFileSync(tmpFile, Buffer.alloc(256 * 1024)); // 256KB

  // Create empty corrupt file (0 bytes)
  const emptyCorruptFile = path.join(sandboxModels, 'corrupt.pth');
  fs.writeFileSync(emptyCorruptFile, Buffer.alloc(0));

  // Create truncated RealESRGAN file
  const truncatedRealESRGAN = path.join(sandboxModels, 'abc_RealESRGAN_x4plus.pth');
  fs.writeFileSync(truncatedRealESRGAN, Buffer.alloc(5000)); // Should be 67040989 bytes

  // Scan sandbox cache status
  const sandboxStatus = getCacheStatus({ cacheDir: sandboxDir, verifyChecksum: false });
  assert.strictEqual(sandboxStatus.filesCount, 4);
  assert.strictEqual(sandboxStatus.temporaryFiles.length, 1);
  assert.strictEqual(sandboxStatus.corruptFiles.length, 2); // empty + truncated

  // Test dryRun
  const dryRunResult = cleanCache({ cacheDir: sandboxDir, dryRun: true });
  assert.strictEqual(dryRunResult.totalDeleted, 3);
  assert.strictEqual(fs.readdirSync(sandboxModels).length, 4, 'dryRun should not delete actual files');

  // Test cleanCache execution
  const cleanResult = cleanCache({ cacheDir: sandboxDir });
  assert.strictEqual(cleanResult.totalDeleted, 3);
  assert.ok(cleanResult.bytesFreed > 0);

  const remainingFiles = fs.readdirSync(sandboxModels);
  assert.deepStrictEqual(remainingFiles, ['valid-model.gguf']);
  console.log('  ✔ Passed: Safely purged 3 corrupt/temporary files, kept valid model intact\n');

  // Test cleanCache with all: true
  const purgeAllResult = cleanCache({ cacheDir: sandboxDir, all: true });
  assert.strictEqual(purgeAllResult.totalDeleted, 1);
  assert.deepStrictEqual(fs.readdirSync(sandboxModels), []);
  console.log('  ✔ Passed: cleanCache({ all: true }) purged remaining files\n');
} finally {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
}

// Test 4: Integrity check on known models
console.log('Test 4: Verify KNOWN_MODELS specification');
assert.strictEqual(KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize, 67040989);
assert.strictEqual(
  KNOWN_MODELS.REALESRGAN_X4PLUS.sha256,
  '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1'
);
console.log('  ✔ Passed: RealESRGAN parameters match QVAC SDK specifications\n');

console.log('🎉 All Model Cache Management tests passed successfully!');
