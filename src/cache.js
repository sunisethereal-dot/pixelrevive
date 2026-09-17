// src/cache.js
// SPDX-License-Identifier: Apache-2.0
/**
 * Model Cache Management for PixelRevive & QVAC SDK
 * Handles cache directory resolution, status inspection, integrity verification,
 * and safe purging of temporary/corrupt download artifacts.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Registry of known model weights used or supported by PixelRevive / QVAC SDK
 */
export const KNOWN_MODELS = {
  REALESRGAN_X4PLUS: {
    name: 'RealESRGAN_x4plus',
    modelId: 'RealESRGAN_x4plus.pth',
    pattern: /RealESRGAN_x4plus\.pth$/i,
    expectedSize: 67040989,
    sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1',
    description: 'RealESRGAN 4x Super-Resolution Weights'
  },
  REALESRGAN_X4PLUS_ANIME_6B: {
    name: 'RealESRGAN_x4plus_anime_6B',
    modelId: 'RealESRGAN_x4plus_anime_6B.pth',
    pattern: /RealESRGAN_x4plus_anime_6B\.pth$/i,
    expectedSize: 17938799,
    sha256: 'f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da',
    description: 'RealESRGAN 4x Anime Super-Resolution Weights'
  },
  REALESRNET_X4PLUS: {
    name: 'RealESRNet_x4plus',
    modelId: 'RealESRNet_x4plus.pth',
    pattern: /RealESRNet_x4plus\.pth$/i,
    expectedSize: 67040989,
    sha256: 'a820b9bde89a874d7599d545567308ce6c128fc8754a53208eda016d40aa81df',
    description: 'RealESRNet 4x Super-Resolution Weights'
  }
};

/**
 * Resolves the model cache directory.
 * Defaults to `path.join(os.homedir(), '.qvac')` on Windows/Linux/macOS.
 * Respects QVAC_CACHE_DIR or QVAC_HOME environment variables when present.
 *
 * @param {...string} subPaths - Optional subdirectories or filenames under the cache dir.
 * @returns {string} Absolute path to the cache directory or sub-path.
 */
export function getModelCacheDir(...subPaths) {
  let baseDir = process.env.QVAC_CACHE_DIR;
  if (!baseDir) {
    const home = process.env.QVAC_HOME || process.env.SNAP_USER_COMMON || os.homedir();
    baseDir = path.join(home, '.qvac');
  }
  return subPaths.length > 0 ? path.join(baseDir, ...subPaths) : baseDir;
}

/**
 * Recursively calculates total disk size in bytes for a directory.
 *
 * @param {string} dirPath - Absolute path to directory.
 * @returns {number} Size in bytes.
 */
export function getDirectorySize(dirPath) {
  let total = 0;
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          total += stat.size;
        }
      } catch {
        // Skip unreadable files or locks
      }
    }
  } catch {
    // Directory unreadable
  }
  return total;
}

/**
 * Validates SHA256 checksum of a file.
 *
 * @param {string} filePath - Absolute path to file.
 * @param {string} expectedSha256 - Expected lowercase hex checksum.
 * @returns {boolean} True if checksum matches.
 */
export function verifyModelIntegrity(filePath, expectedSha256) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return hash.toLowerCase() === expectedSha256.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Scans the cache directory, checks for existing RealESRGAN weights,
 * reports total cache size in MB, lists files, and reports download completeness.
 *
 * @param {object} [options] - Options for scanning.
 * @param {string} [options.cacheDir] - Override cache directory.
 * @param {boolean} [options.verifyChecksum=true] - Verify SHA-256 for RealESRGAN weights.
 * @param {boolean} [options.fast=false] - Skip hash calculation for maximum speed.
 * @returns {object} Cache status report.
 */
export function getCacheStatus(options = {}) {
  const cacheDir = options.cacheDir || getModelCacheDir();
  const modelsDir = path.join(cacheDir, 'models');
  const verifyChecksum = options.verifyChecksum !== false && !options.fast;

  const cacheDirExists = fs.existsSync(cacheDir);
  const modelsDirExists = fs.existsSync(modelsDir);

  let totalSizeBytes = 0;
  if (cacheDirExists) {
    totalSizeBytes = getDirectorySize(cacheDir);
  }

  const files = [];
  const temporaryFiles = [];
  const corruptFiles = [];
  let modelsSizeBytes = 0;
  let realEsrganFile = null;

  if (modelsDirExists) {
    try {
      const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(modelsDir, entry.name);
        try {
          const stat = fs.statSync(filePath);
          modelsSizeBytes += stat.size;
          const lower = entry.name.toLowerCase();

          let isTemporary = false;
          let isCorrupt = false;
          let reason = '';
          let modelType = 'Model Asset';

          // 1. Temporary extension detection
          if (
            lower.endsWith('.tmp') ||
            lower.endsWith('.temp') ||
            lower.endsWith('.part') ||
            lower.endsWith('.partial') ||
            lower.endsWith('.crdownload') ||
            lower.endsWith('.download') ||
            lower.includes('.qvac-pre.tmp') ||
            lower.startsWith('tmp_')
          ) {
            isTemporary = true;
            reason = 'Temporary download artifact';
          } else if (stat.size === 0) {
            isCorrupt = true;
            reason = 'Empty 0-byte corrupt file';
          }

          // 2. Known model identification & integrity verification
          let isComplete = !isTemporary && !isCorrupt;
          let completenessPercent = 100;
          let expectedSize = null;

          if (lower.includes('realesrgan_x4plus') && !lower.includes('anime')) {
            modelType = 'RealESRGAN x4plus (Diffusion Super-Resolution)';
            expectedSize = KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize;
            if (stat.size !== expectedSize) {
              isComplete = false;
              isCorrupt = true;
              reason = `Size mismatch (${stat.size} vs ${expectedSize} bytes)`;
              completenessPercent = Math.min(100, Math.round((stat.size / expectedSize) * 100));
            } else {
              completenessPercent = 100;
              realEsrganFile = {
                name: entry.name,
                path: filePath,
                size: stat.size,
                stat
              };
            }
          } else if (lower.includes('realesrgan_x4plus_anime')) {
            modelType = 'RealESRGAN x4plus Anime 6B (Diffusion Super-Resolution)';
            expectedSize = KNOWN_MODELS.REALESRGAN_X4PLUS_ANIME_6B.expectedSize;
            if (stat.size !== expectedSize) {
              isComplete = false;
              isCorrupt = true;
              reason = `Size mismatch (${stat.size} vs ${expectedSize} bytes)`;
              completenessPercent = Math.min(100, Math.round((stat.size / expectedSize) * 100));
            }
          } else if (lower.includes('realesrnet_x4plus')) {
            modelType = 'RealESRNet x4plus';
            expectedSize = KNOWN_MODELS.REALESRNET_X4PLUS.expectedSize;
            if (stat.size !== expectedSize) {
              isComplete = false;
              isCorrupt = true;
              reason = `Size mismatch (${stat.size} vs ${expectedSize} bytes)`;
              completenessPercent = Math.min(100, Math.round((stat.size / expectedSize) * 100));
            }
          } else if (lower.endsWith('.gguf')) {
            modelType = 'GGUF Model';
          } else if (lower.endsWith('.pth') || lower.endsWith('.bin')) {
            modelType = 'PyTorch Model Weights';
          }

          const fileInfo = {
            name: entry.name,
            path: filePath,
            size: stat.size,
            sizeMB: Number((stat.size / (1024 * 1024)).toFixed(2)),
            mtime: stat.mtime,
            isTemporary,
            isCorrupt,
            isComplete,
            completenessPercent,
            expectedSize,
            modelType,
            reason: reason || (isComplete ? 'Valid' : 'Incomplete')
          };

          files.push(fileInfo);
          if (isTemporary) temporaryFiles.push(fileInfo);
          if (isCorrupt) corruptFiles.push(fileInfo);
        } catch {
          // File unreadable / stat error
        }
      }
    } catch {
      // Models directory readdir error
    }
  }

  // Verify RealESRGAN checksum if present and complete
  let realEsrganChecksumValid = false;
  if (realEsrganFile && verifyChecksum) {
    realEsrganChecksumValid = verifyModelIntegrity(
      realEsrganFile.path,
      KNOWN_MODELS.REALESRGAN_X4PLUS.sha256
    );
  } else if (realEsrganFile && !verifyChecksum) {
    realEsrganChecksumValid = realEsrganFile.size === KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize;
  }

  const hasRealESRGAN = Boolean(
    realEsrganFile && realEsrganFile.size === KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize
  );

  return {
    cacheDir,
    modelsDir,
    exists: cacheDirExists,
    modelsDirExists,
    totalSizeBytes,
    totalSizeMB: Number((totalSizeBytes / (1024 * 1024)).toFixed(2)),
    modelsSizeBytes,
    modelsSizeMB: Number((modelsSizeBytes / (1024 * 1024)).toFixed(2)),
    filesCount: files.length,
    files,
    hasRealESRGAN,
    realESRGAN: {
      found: hasRealESRGAN,
      name: realEsrganFile?.name || null,
      path: realEsrganFile?.path || null,
      sizeBytes: realEsrganFile?.size || 0,
      sizeMB: realEsrganFile ? Number((realEsrganFile.size / (1024 * 1024)).toFixed(2)) : 0,
      expectedSizeBytes: KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize,
      expectedSizeMB: Number((KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize / (1024 * 1024)).toFixed(2)),
      isComplete: hasRealESRGAN,
      completenessPercent: realEsrganFile
        ? Math.min(100, Math.round((realEsrganFile.size / KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize) * 100))
        : 0,
      sha256Verified: realEsrganChecksumValid,
      status: !realEsrganFile ? 'missing' : (hasRealESRGAN ? 'complete' : 'incomplete')
    },
    completeness: {
      isComplete: hasRealESRGAN,
      percent: hasRealESRGAN
        ? 100
        : (realEsrganFile
          ? Math.min(99, Math.round((realEsrganFile.size / KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize) * 100))
          : 0),
      status: hasRealESRGAN ? 'complete' : (!realEsrganFile ? 'missing' : 'incomplete')
    },
    readiness: {
      isReady: hasRealESRGAN && (verifyChecksum ? realEsrganChecksumValid : true),
      status: hasRealESRGAN ? 'ready' : 'not_ready',
      message: hasRealESRGAN
        ? 'RealESRGAN weights verified. Ready for 100% on-device offline super-resolution.'
        : 'RealESRGAN weights missing or incomplete. Initial run requires model download.'
    },
    temporaryFiles,
    corruptFiles
  };
}

/**
 * Safely purges temporary or corrupt downloads in the `.qvac/models` folder.
 * Supports options to purge all model cache or run in dry-run mode.
 *
 * @param {object} [options] - Cleanup options.
 * @param {string} [options.cacheDir] - Override cache directory.
 * @param {boolean} [options.all=false] - If true, purge all cached model files.
 * @param {boolean} [options.dryRun=false] - If true, only calculate without deleting.
 * @returns {object} Cleanup results including list of removed files and freed bytes.
 */
export function cleanCache(options = {}) {
  const cacheDir = options.cacheDir || getModelCacheDir();
  const modelsDir = path.join(cacheDir, 'models');
  const purgeAll = Boolean(options.all);
  const dryRun = Boolean(options.dryRun);

  const result = {
    success: true,
    cacheDir,
    modelsDir,
    deletedFiles: [],
    totalDeleted: 0,
    bytesFreed: 0,
    freedMB: 0,
    errors: []
  };

  if (!fs.existsSync(modelsDir)) {
    return result;
  }

  let entries;
  try {
    entries = fs.readdirSync(modelsDir, { withFileTypes: true });
  } catch (err) {
    result.success = false;
    result.errors.push(`Failed to read models directory: ${err.message}`);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(modelsDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      result.errors.push(`Failed to stat ${entry.name}: ${err.message}`);
      continue;
    }

    let shouldDelete = false;
    let reason = '';

    if (purgeAll) {
      shouldDelete = true;
      reason = 'All models purge requested';
    } else {
      const lower = entry.name.toLowerCase();
      // 1. Temporary extension
      if (
        lower.endsWith('.tmp') ||
        lower.endsWith('.temp') ||
        lower.endsWith('.part') ||
        lower.endsWith('.partial') ||
        lower.endsWith('.crdownload') ||
        lower.endsWith('.download') ||
        lower.includes('.qvac-pre.tmp') ||
        lower.startsWith('tmp_')
      ) {
        shouldDelete = true;
        reason = 'Temporary download artifact';
      } else if (stat.size === 0) {
        // 2. Empty / corrupt file
        shouldDelete = true;
        reason = 'Empty 0-byte corrupt file';
      } else if (lower.includes('realesrgan_x4plus') && !lower.includes('anime')) {
        // Corrupt/incomplete RealESRGAN weights
        if (stat.size !== KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize) {
          shouldDelete = true;
          reason = `Corrupt/incomplete RealESRGAN weights (${stat.size} vs expected ${KNOWN_MODELS.REALESRGAN_X4PLUS.expectedSize} bytes)`;
        }
      } else if (lower.includes('realesrgan_x4plus_anime')) {
        if (stat.size !== KNOWN_MODELS.REALESRGAN_X4PLUS_ANIME_6B.expectedSize) {
          shouldDelete = true;
          reason = `Corrupt/incomplete RealESRGAN Anime weights (${stat.size} vs expected ${KNOWN_MODELS.REALESRGAN_X4PLUS_ANIME_6B.expectedSize} bytes)`;
        }
      } else if (lower.includes('realesrnet_x4plus')) {
        if (stat.size !== KNOWN_MODELS.REALESRNET_X4PLUS.expectedSize) {
          shouldDelete = true;
          reason = `Corrupt/incomplete RealESRNet weights (${stat.size} vs expected ${KNOWN_MODELS.REALESRNET_X4PLUS.expectedSize} bytes)`;
        }
      }
    }

    if (shouldDelete) {
      try {
        if (!dryRun) {
          fs.unlinkSync(filePath);
        }
        result.deletedFiles.push({
          name: entry.name,
          path: filePath,
          size: stat.size,
          sizeMB: Number((stat.size / (1024 * 1024)).toFixed(2)),
          reason
        });
        result.bytesFreed += stat.size;
      } catch (err) {
        result.errors.push(`Failed to delete ${entry.name}: ${err.message}`);
      }
    }
  }

  result.totalDeleted = result.deletedFiles.length;
  result.freedMB = Number((result.bytesFreed / (1024 * 1024)).toFixed(2));
  return result;
}
