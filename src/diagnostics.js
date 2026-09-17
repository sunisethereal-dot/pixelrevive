// src/diagnostics.js
// SPDX-License-Identifier: Apache-2.0
/**
 * PixelRevive: System Requirement & Hardware Preflight Diagnostics
 * Inspects and reports runtime, memory, storage, engine, and GPU capabilities
 * for on-device AI inference with Tether's QVAC SDK (@qvac/sdk).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Terminal ANSI styling helpers (auto-disabled if NO_COLOR is set or non-TTY)
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY ?? true);
const c = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  white: useColor ? '\x1b[37m' : '',
  gray: useColor ? '\x1b[90m' : '',
  bgCyan: useColor ? '\x1b[46m\x1b[30m' : '',
  bgGreen: useColor ? '\x1b[42m\x1b[30m' : '',
  bgYellow: useColor ? '\x1b[43m\x1b[30m' : '',
  bgRed: useColor ? '\x1b[41m\x1b[37m' : '',
};

const SYMBOLS = {
  ok: `${c.green}✔ OK${c.reset}`,
  warning: `${c.yellow}▲ WARN${c.reset}`,
  error: `${c.red}✖ FAIL${c.reset}`,
  bullet: `${c.cyan}•${c.reset}`,
};

/**
 * Evaluates Node.js engine compatibility against ^22.21.0 || >=24.9.0
 * Zero external dependency, robust semver evaluation.
 */
export function checkNodeEngine(versionStr = process.version) {
  const match = versionStr.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { compatible: false, major: 0, minor: 0, patch: 0 };

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);

  // ^22.21.0 matches: >= 22.21.0 and < 23.0.0
  const isNode22Match = (major === 22) && (minor > 21 || (minor === 21 && patch >= 0));
  // >=24.9.0 matches: >= 24.9.0
  const isNode24Match = (major === 24) && (minor > 9 || (minor === 9 && patch >= 0));
  const isHigherMatch = major > 24;

  const compatible = isNode22Match || isNode24Match || isHigherMatch;
  return { compatible, major, minor, patch };
}

/**
 * Detects GPU details and Windows DirectML support
 */
export function detectGpuAndDirectML() {
  const isWin = process.platform === 'win32';
  let gpuName = 'Unknown GPU';
  let directMLStatus = 'Not Available';
  let directMLSupported = false;
  let directMLPath = null;
  let directMLVersion = null;

  if (isWin) {
    const sysRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const dmlPath = path.join(sysRoot, 'System32', 'DirectML.dll');
    if (fs.existsSync(dmlPath)) {
      directMLSupported = true;
      directMLPath = dmlPath;
      try {
        const verOutput = cp.execFileSync('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-Command',
          `[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${dmlPath}').FileVersion`
        ], { timeout: 2500, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (verOutput) {
          directMLVersion = verOutput.split('+')[0];
        }
      } catch {}
      directMLStatus = directMLVersion
        ? `Supported (DirectML.dll v${directMLVersion} in System32)`
        : 'Supported (DirectML.dll present in System32)';
    } else {
      directMLStatus = 'DirectML.dll missing (Windows 10 1903+ / Windows 11 required)';
    }

    // Query GPU via CIM
    try {
      const psOut = cp.execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'
      ], { timeout: 3500, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (psOut) {
        const gpus = psOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        gpuName = gpus.join(', ');
      }
    } catch {
      // Fallback: nvidia-smi
      try {
        const nvOut = cp.execFileSync('nvidia-smi', [
          '--query-gpu=name',
          '--format=csv,noheader'
        ], { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (nvOut) {
          gpuName = nvOut.split(/\r?\n/)[0].trim();
        }
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    directMLStatus = 'N/A (macOS uses Apple Metal runtime)';
    try {
      const spOut = cp.execFileSync('system_profiler', ['SPDisplaysDataType'], {
        timeout: 3000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const match = spOut.match(/Chipset Model:\s*(.+)/);
      if (match) gpuName = match[1].trim();
    } catch {}
  } else {
    // Linux
    const wslDml = '/usr/lib/wsl/lib/libdirectml.so';
    if (fs.existsSync(wslDml)) {
      directMLSupported = true;
      directMLPath = wslDml;
      directMLStatus = 'Supported (WSL2 DirectML)';
    } else {
      directMLStatus = 'N/A (Linux uses CUDA/ROCm/Vulkan runtime)';
    }
    try {
      const nvOut = cp.execFileSync('nvidia-smi', [
        '--query-gpu=name',
        '--format=csv,noheader'
      ], { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (nvOut) {
        gpuName = nvOut.split(/\r?\n/)[0].trim();
      }
    } catch {}
  }

  return { gpuName, directMLStatus, directMLSupported, directMLPath, directMLVersion };
}

/**
 * Checks disk space and cache folder accessibility for %USERPROFILE%/.qvac or ~/.qvac
 */
export function checkCacheStorage() {
  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const cacheDir = path.join(homeDir, '.qvac');

  let exists = false;
  let readable = false;
  let writable = false;
  let freeGB = null;
  let totalGB = null;
  let accessError = null;

  try {
    exists = fs.existsSync(cacheDir);
    if (exists) {
      fs.accessSync(cacheDir, fs.constants.R_OK);
      readable = true;
      fs.accessSync(cacheDir, fs.constants.W_OK);
      writable = true;
    } else {
      // Check if parent homeDir is writable to create .qvac
      fs.accessSync(homeDir, fs.constants.W_OK);
      readable = true;
      writable = true;
    }
  } catch (err) {
    accessError = err.message;
  }

  // Check disk space
  const targetDir = exists ? cacheDir : homeDir;
  try {
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(targetDir);
      const bavail = BigInt(stat.bavail);
      const blocks = BigInt(stat.blocks);
      const bsize = BigInt(stat.bsize);
      freeGB = Number(bavail * bsize) / (1024 ** 3);
      totalGB = Number(blocks * bsize) / (1024 ** 3);
    }
  } catch {}

  return {
    cacheDir,
    exists,
    readable,
    writable,
    freeGB: freeGB !== null ? Number(freeGB.toFixed(2)) : null,
    totalGB: totalGB !== null ? Number(totalGB.toFixed(2)) : null,
    accessError
  };
}

/**
 * Core Diagnostic Suite Runner
 * Inspects all system requirements and returns structured diagnostic payload.
 */
export async function runSystemDiagnostics(options = {}) {
  const { silent = false } = options;

  // 1. Platform & CPU Architecture
  const platform = process.platform;
  const platformFriendly = {
    win32: `Windows (${os.release()})`,
    darwin: `macOS (${os.release()})`,
    linux: `Linux (${os.release()})`
  }[platform] || `${platform} (${os.release()})`;

  const arch = process.arch;
  const cpuList = os.cpus() || [];
  const cpuCores = cpuList.length;
  const cpuModel = cpuList[0]?.model?.trim() || 'Unknown CPU';

  const archSupported = ['x64', 'arm64'].includes(arch);
  let platformStatus = 'ok';
  let platformMessage = `64-bit architecture (${arch}) with ${cpuCores} logical CPU cores`;
  if (!archSupported) {
    platformStatus = 'error';
    platformMessage = `Unsupported CPU architecture: ${arch}. On-device AI requires x64 or arm64.`;
  } else if (cpuCores < 4) {
    platformStatus = 'warning';
    platformMessage = `${cpuCores} CPU cores detected. At least 4 cores recommended for optimal parallel tiling.`;
  }

  const checkPlatform = {
    id: 'platform_cpu',
    name: 'Platform & CPU Architecture',
    category: 'System',
    status: platformStatus,
    value: `${platformFriendly} • ${arch} • ${cpuCores} cores`,
    tableValue: `${process.platform === 'win32' ? 'Windows' : process.platform} (${arch}) • ${cpuCores} cores`,
    message: platformMessage,
    details: {
      platform,
      platformFriendly,
      osRelease: os.release(),
      arch,
      cpuCores,
      cpuModel
    }
  };

  // 2. Node.js Engine Compatibility (^22.21.0 || >=24.9.0)
  const nodeVersion = process.version;
  const targetEngine = '^22.21.0 || >=24.9.0';
  const engineResult = checkNodeEngine(nodeVersion);
  let engineStatus = 'ok';
  let engineMessage = `Node.js ${nodeVersion} satisfies engine target (${targetEngine})`;

  if (!engineResult.compatible) {
    if (engineResult.major < 22) {
      engineStatus = 'error';
      engineMessage = `Node.js ${nodeVersion} is unsupported. Requires Node.js ${targetEngine}.`;
    } else {
      engineStatus = 'warning';
      engineMessage = `Node.js ${nodeVersion} is outside verified engine range (${targetEngine}). QVAC SDK recommends Node ^22.21.0 or >=24.9.0.`;
    }
  }

  const checkNode = {
    id: 'node_engine',
    name: 'Node.js Engine Compatibility',
    category: 'Runtime',
    status: engineStatus,
    value: `${nodeVersion} (Target: ${targetEngine})`,
    tableValue: `${nodeVersion} (Engine: ${targetEngine})`,
    message: engineMessage,
    details: {
      currentVersion: nodeVersion,
      targetEngine,
      compatible: engineResult.compatible,
      parsed: { major: engineResult.major, minor: engineResult.minor, patch: engineResult.patch }
    }
  };

  // 3. System Memory (Total & Free RAM in GB; flags warning if <4GB free)
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const totalGB = Number((totalBytes / (1024 ** 3)).toFixed(2));
  const freeGB = Number((freeBytes / (1024 ** 3)).toFixed(2));

  let memoryStatus = 'ok';
  let memoryMessage = `${freeGB} GB free of ${totalGB} GB total RAM`;
  if (totalGB < 4.0) {
    memoryStatus = 'error';
    memoryMessage = `Critical: Total RAM (${totalGB} GB) is below minimum 4.00 GB requirement for model execution.`;
  } else if (freeGB < 4.0) {
    memoryStatus = 'warning';
    memoryMessage = `Warning: Free RAM (${freeGB} GB) is below recommended 4.00 GB threshold. Model inference may cause memory pressure or disk paging.`;
  }

  const checkMemory = {
    id: 'memory',
    name: 'System Memory (RAM)',
    category: 'Hardware',
    status: memoryStatus,
    value: `${totalGB} GB total / ${freeGB} GB free`,
    tableValue: `${totalGB} GB total • ${freeGB} GB free`,
    message: memoryMessage,
    details: {
      totalGB,
      freeGB,
      freeBytes,
      totalBytes,
      warningThresholdGB: 4.0,
      isBelow4GBFree: freeGB < 4.0
    }
  };

  // 4. Disk space / Cache folder accessibility for %USERPROFILE%/.qvac or ~/.qvac
  const cacheInfo = checkCacheStorage();
  let cacheStatus = 'ok';
  let cacheMessage = `Cache path accessible with ${cacheInfo.freeGB ?? 'N/A'} GB free disk space`;

  if (!cacheInfo.writable) {
    cacheStatus = 'error';
    cacheMessage = `Cache directory not writable: ${cacheInfo.cacheDir} (${cacheInfo.accessError || 'Permission denied'})`;
  } else if (cacheInfo.freeGB !== null && cacheInfo.freeGB < 1.0) {
    cacheStatus = 'error';
    cacheMessage = `Critical disk space: only ${cacheInfo.freeGB} GB available on cache drive (minimum 1.00 GB required).`;
  } else if (cacheInfo.freeGB !== null && cacheInfo.freeGB < 4.0) {
    cacheStatus = 'warning';
    cacheMessage = `Low disk space: ${cacheInfo.freeGB} GB available on cache drive. Multiple model downloads may deplete space.`;
  }

  const checkCache = {
    id: 'cache_storage',
    name: 'QVAC Cache & Disk Storage',
    category: 'Storage',
    status: cacheStatus,
    value: `${cacheInfo.freeGB !== null ? `${cacheInfo.freeGB} GB free` : 'Space unknown'} • ${cacheInfo.cacheDir}`,
    tableValue: `${cacheInfo.freeGB !== null ? `${cacheInfo.freeGB} GB free` : 'OK'} • ~/.qvac`,
    message: cacheMessage,
    details: cacheInfo
  };

  // 5. Windows DirectML / GPU capability detection indicator
  const gpuInfo = detectGpuAndDirectML();
  let gpuStatus = 'ok';
  let gpuMessage = '';

  if (platform === 'win32') {
    if (gpuInfo.directMLSupported && gpuInfo.gpuName !== 'Unknown GPU') {
      gpuStatus = 'ok';
      gpuMessage = `DirectML acceleration available via ${gpuInfo.gpuName} (${gpuInfo.directMLStatus})`;
    } else if (gpuInfo.gpuName !== 'Unknown GPU') {
      gpuStatus = 'warning';
      gpuMessage = `GPU detected (${gpuInfo.gpuName}) but DirectML.dll was not found in System32. CPU fallback will be active.`;
    } else {
      gpuStatus = 'warning';
      gpuMessage = 'Dedicated GPU not detected. CPU inference fallback will be utilized.';
    }
  } else {
    // Non-Windows
    if (gpuInfo.gpuName !== 'Unknown GPU') {
      gpuStatus = 'ok';
      gpuMessage = `GPU detected (${gpuInfo.gpuName}). Hardware acceleration active.`;
    } else {
      gpuStatus = 'warning';
      gpuMessage = 'Dedicated GPU not detected. CPU inference fallback will be utilized.';
    }
  }

  const cleanGpuName = gpuInfo.gpuName.replace(/^NVIDIA /, '').replace(/^AMD /, '');
  const checkGpu = {
    id: 'gpu_directml',
    name: 'DirectML & GPU Acceleration',
    category: 'Acceleration',
    status: gpuStatus,
    value: `${gpuInfo.gpuName} • ${gpuInfo.directMLStatus}`,
    tableValue: `${cleanGpuName} • ${gpuInfo.directMLSupported ? 'DirectML Ready' : 'CPU Fallback'}`,
    message: gpuMessage,
    details: gpuInfo
  };

  // Compile full check suite
  const checks = [checkPlatform, checkNode, checkMemory, checkCache, checkGpu];

  // Overall status evaluation
  const hasError = checks.some((c) => c.status === 'error');
  const hasWarning = checks.some((c) => c.status === 'warning');
  const overallStatus = hasError ? 'error' : hasWarning ? 'warning' : 'ok';

  // Overall human summary
  const passedCount = checks.filter((c) => c.status === 'ok').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const errorCount = checks.filter((c) => c.status === 'error').length;

  let summary = '';
  if (overallStatus === 'ok') {
    summary = `All ${checks.length} system requirement checks passed. Environment is fully verified and optimized for on-device AI super-resolution.`;
  } else if (overallStatus === 'warning') {
    const warnNames = checks.filter(c => c.status === 'warning').map(c => c.name).join(', ');
    summary = `System requirements passed with ${warningCount} advisory warning(s) (${warnNames}). On-device AI can run, but free memory or acceleration fallback may impact performance.`;
  } else {
    const errNames = checks.filter(c => c.status === 'error').map(c => c.name).join(', ');
    summary = `System requirements check failed with ${errorCount} error(s) (${errNames}). Blocking issues must be addressed before running on-device AI inference.`;
  }

  // Add convenience properties for quick object access
  checks.platform = checkPlatform;
  checks.node = checkNode;
  checks.nodeVersion = checkNode;
  checks.memory = checkMemory;

  const result = {
    status: overallStatus,
    checks,
    platform: checkPlatform,
    node: checkNode,
    nodeVersion: checkNode.details.currentVersion,
    memory: checkMemory,
    summary,
    timestamp: new Date().toISOString(),
    metrics: {
      total: checks.length,
      passed: passedCount,
      warnings: warningCount,
      errors: errorCount
    }
  };

  if (!silent) {
    printDiagnosticReport(result);
  }

  return result;
}

/**
 * Renders a beautifully styled terminal CLI report & table
 */
export function printDiagnosticReport(result) {
  const line = '─'.repeat(84);
  const dblLine = '═'.repeat(84);

  console.log(`\n${c.cyan}${dblLine}${c.reset}`);
  console.log(`  ${c.bold}${c.white}✨ PIXELREVIVE // SYSTEM REQUIREMENTS & HARDWARE PREFLIGHT${c.reset}`);
  console.log(`  ${c.dim}On-Device AI Super-Resolution Diagnostics (@qvac/sdk)${c.reset}`);
  console.log(`${c.cyan}${dblLine}${c.reset}\n`);

  // CLI Table Header
  console.log(`${c.dim}┌──────────────────────────────────┬──────────────────────────────────────────┬────────┐${c.reset}`);
  console.log(`${c.dim}│${c.reset} ${c.bold}Requirement Check                ${c.reset}${c.dim}│${c.reset} ${c.bold}Detected Specification                    ${c.reset}${c.dim}│${c.reset} ${c.bold}Status ${c.reset}${c.dim}│${c.reset}`);
  console.log(`${c.dim}├──────────────────────────────────┼──────────────────────────────────────────┼────────┤${c.reset}`);

  for (const item of result.checks) {
    const nameCol = padEnd(item.name, 32);
    const displayVal = item.tableValue || item.value;
    const rawVal = displayVal.length > 40 ? `${displayVal.slice(0, 37)}...` : displayVal;
    const valCol = padEnd(rawVal, 40);

    let statusCol = '  OK  ';
    if (item.status === 'ok') {
      statusCol = `${c.green}✔ OK  ${c.reset}`;
    } else if (item.status === 'warning') {
      statusCol = `${c.yellow}▲ WARN${c.reset}`;
    } else {
      statusCol = `${c.red}✖ FAIL${c.reset}`;
    }

    console.log(`${c.dim}│${c.reset} ${nameCol} ${c.dim}│${c.reset} ${valCol} ${c.dim}│${c.reset} ${statusCol} ${c.dim}│${c.reset}`);
  }
  console.log(`${c.dim}└──────────────────────────────────┴──────────────────────────────────────────┴────────┘${c.reset}\n`);

  // Detailed Findings Breakdown
  console.log(`${c.bold}DIAGNOSTIC DETAILS & HARDWARE SPECIFICATIONS:${c.reset}`);

  result.checks.forEach((item, idx) => {
    const symbol = item.status === 'ok' ? SYMBOLS.ok : (item.status === 'warning' ? SYMBOLS.warning : SYMBOLS.error);
    console.log(`\n  ${c.bold}[${idx + 1}/${result.checks.length}] ${item.name}${c.reset} -> ${symbol}`);

    if (item.id === 'platform_cpu') {
      console.log(`      ${SYMBOLS.bullet} OS Platform:    ${c.white}${item.details.platformFriendly}${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} Architecture:   ${c.white}${item.details.arch} (64-bit)${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} CPU Model:      ${c.white}${item.details.cpuModel}${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} Logical Cores:  ${c.white}${item.details.cpuCores} cores${c.reset}`);
    } else if (item.id === 'node_engine') {
      console.log(`      ${SYMBOLS.bullet} Active Version: ${c.white}${item.details.currentVersion}${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} Required Range: ${c.white}${item.details.targetEngine}${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} Compatibility:  ${item.details.compatible ? `${c.green}Satisfied${c.reset}` : `${c.red}Mismatch${c.reset}`}`);
    } else if (item.id === 'memory') {
      console.log(`      ${SYMBOLS.bullet} Total RAM:      ${c.white}${item.details.totalGB} GB${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} Free RAM:       ${item.details.isBelow4GBFree ? `${c.yellow}${item.details.freeGB} GB (< 4GB Warning)${c.reset}` : `${c.green}${item.details.freeGB} GB${c.reset}`}`);
      if (item.details.isBelow4GBFree) {
        console.log(`      ${c.dim}ℹ Recommendation: Close unused memory-heavy applications to prevent disk paging during upscaling.${c.reset}`);
      }
    } else if (item.id === 'cache_storage') {
      console.log(`      ${SYMBOLS.bullet} Directory:      ${c.white}${item.details.cacheDir}${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} Accessibility:  ${item.details.writable ? `${c.green}Read/Write Verified${c.reset}` : `${c.red}Access Denied${c.reset}`}`);
      console.log(`      ${SYMBOLS.bullet} Free Disk:      ${c.white}${item.details.freeGB ?? 'N/A'} GB available${c.reset} ${c.dim}(of ${item.details.totalGB ?? 'N/A'} GB total)${c.reset}`);
    } else if (item.id === 'gpu_directml') {
      console.log(`      ${SYMBOLS.bullet} GPU Device:     ${c.white}${item.details.gpuName}${c.reset}`);
      console.log(`      ${SYMBOLS.bullet} DirectML State: ${item.details.directMLSupported ? `${c.green}${item.details.directMLStatus}${c.reset}` : `${c.yellow}${item.details.directMLStatus}${c.reset}`}`);
      if (item.details.directMLPath) {
        console.log(`      ${SYMBOLS.bullet} DirectML Path:  ${c.dim}${item.details.directMLPath}${c.reset}`);
      }
    }
    console.log(`      ${c.dim}Notes: ${item.message}${c.reset}`);
  });

  // Overall Summary Box
  console.log(`\n${c.dim}${line}${c.reset}`);
  let statusBanner = `${c.bgGreen} STATUS: OK ${c.reset}`;
  if (result.status === 'warning') {
    statusBanner = `${c.bgYellow} STATUS: WARNING ${c.reset}`;
  } else if (result.status === 'error') {
    statusBanner = `${c.bgRed} STATUS: ERROR ${c.reset}`;
  }

  console.log(`${statusBanner}  ${c.bold}${result.metrics.passed} passed${c.reset}, ${c.yellow}${result.metrics.warnings} warning(s)${c.reset}, ${c.red}${result.metrics.errors} error(s)${c.reset}`);
  console.log(`\n${c.bold}Summary:${c.reset} ${result.summary}`);
  console.log(`${c.dim}${line}${c.reset}\n`);
}

function padEnd(str, len) {
  const cleanStr = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = len - cleanStr.length;
  return pad > 0 ? str + ' '.repeat(pad) : str;
}

// Support direct CLI invocation: `node src/diagnostics.js`
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runSystemDiagnostics()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`${c.red}✖ Diagnostic error:${c.reset}`, err?.message || err);
      process.exit(1);
    });
}
