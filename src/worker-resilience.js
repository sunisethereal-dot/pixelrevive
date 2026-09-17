// src/worker-resilience.js
// SPDX-License-Identifier: Apache-2.0

/**
 * Worker Resilience and RPC Timeout Diagnostic Handler
 * Provides actionable error translation for @qvac/sdk worker failures on Windows.
 */

/**
 * Determines if a given error is an RPC initialization timeout,
 * bare worker startup crash, or engine incompatibility.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function isWorkerTimeoutOrCrash(error) {
  if (!error) return false;

  const textParts = [
    error.message,
    error.code,
    error.name,
    error.stack,
    error.cause?.message,
    error.cause?.stderrTail,
    error.cause?.code,
    error.cause?.signal,
    error.details
  ].filter(Boolean).map(String);

  const fullText = textParts.join('\n');

  const indicators = [
    /RPC initialization timed out/i,
    /worker process may have failed to start/i,
    /EBADENGINE/i,
    /Worker did not establish IPC/i,
    /Bare worker exited/i,
    /Worker process exited/i,
    /WORKER_STARTUP_FAILED/i,
    /WORKER_CRASHED/i,
    /RPC_INIT_TIMEOUT/i,
    /\b50204\b/,
    /worker.*timed out/i,
    /bareWorkerProc/i
  ];

  return indicators.some((pattern) => pattern.test(fullText));
}

/**
 * Checks Node.js version compatibility with @qvac/sdk bare worker.
 * Bare worker requires Node.js ^22.21.0 or >=24.9.0.
 *
 * @returns {{ version: string, isCompatible: boolean | null, message: string }}
 */
export function checkNodeCompatibility() {
  const version = process.version; // e.g. 'v24.18.0'
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return {
      version,
      isCompatible: null,
      message: `Current: ${version} (Could not verify semver against required ^22.21.0 or >=24.9.0)`
    };
  }

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);

  const is22Compatible = major === 22 && minor >= 21;
  const is24Compatible = major === 24 && minor >= 9;
  const isHigherCompatible = major > 24;
  const isCompatible = is22Compatible || is24Compatible || isHigherCompatible;

  if (isCompatible) {
    return {
      version,
      isCompatible: true,
      message: `Current: ${version} (COMPATIBLE with required ^22.21.0 or >=24.9.0)`
    };
  }

  return {
    version,
    isCompatible: false,
    message: `Current: ${version} (INCOMPATIBLE - Bare worker requires Node ^22.21.0 or >=24.9.0; on <22.21.0 worker terminates silently with EBADENGINE during module loading)`
  };
}

/**
 * Generates an actionable diagnostic guide for Windows users.
 *
 * @param {any} error
 * @param {string} [context='Worker operation']
 * @returns {string}
 */
export function formatWorkerDiagnostic(error, context = 'Worker operation') {
  const isTimeout = isWorkerTimeoutOrCrash(error);
  const nodeStatus = checkNodeCompatibility();
  const rawMsg = error?.message || String(error);
  const stderrTail = error?.cause?.stderrTail ? String(error.cause.stderrTail).trim() : '';

  if (!isTimeout) {
    return [
      `[${context}] Error: ${rawMsg}`,
      stderrTail ? `Worker Stderr:\n${stderrTail}` : ''
    ].filter(Boolean).join('\n');
  }

  const separator = '='.repeat(78);
  const subSeparator = '-'.repeat(78);

  const lines = [
    separator,
    `  ⚠️  QVAC WORKER RESILIENCE & RPC TIMEOUT DIAGNOSTIC (Windows)`,
    separator,
    `Context : ${context}`,
    `Error   : ${rawMsg}`,
    stderrTail ? `Stderr  : ${stderrTail}` : null,
    subSeparator,
    `The QVAC bare worker process failed to start or establish IPC handshake`,
    `within the initialization timeout window (default 30000ms).`,
    ``,
    `DIAGNOSTIC ANALYSIS & ACTIONABLE RESOLUTIONS:`,
    ``,
    `1) Model Weights Download on First Run:`,
    `   • Real-ESRGAN requires ~67MB of weights downloaded from the CDN on first run.`,
    `   • On slow, metered, or firewalled networks, downloading weights during worker`,
    `     startup can delay the IPC handshake beyond the 30000ms threshold.`,
    `   • Fix: Increase the RPC initialization timeout environment variable:`,
    `     PowerShell:  $env:QVAC_RPC_INIT_TIMEOUT_MS="120000"`,
    `     CMD:         set QVAC_RPC_INIT_TIMEOUT_MS=120000`,
    `     Bash:        export QVAC_RPC_INIT_TIMEOUT_MS=120000`,
    ``,
    `2) Node.js Version Compatibility:`,
    `   • Bare worker requires Node.js ^22.21.0 or >=24.9.0.`,
    `   • ${nodeStatus.message}`,
    `   • On Node.js <22.21.0, the worker can terminate silently during module loading`,
    `     due to native engine incompatibility (EBADENGINE).`,
    `   • Fix: Upgrade Node.js via nvm or installer if incompatible:`,
    `     nvm install 24.18.0 && nvm use 24.18.0`,
    ``,
    `3) Windows Defender / Antivirus Interference:`,
    `   • Windows Defender Real-time Protection, SmartScreen, or third-party AV may`,
    `     scan, sandbox, or block the spawned bare worker child process during launch.`,
    `   • Fix: Add an exclusion for the QVAC cache directory and workspace:`,
    `     PowerShell (Admin): Add-MpPreference -ExclusionPath "$HOME\\.qvac"`,
    ``,
    `4) Actionable Suggestions & Pre-Check:`,
    `   • Test CDN Connectivity: Verify network reachability to QVAC CDN / HuggingFace.`,
    `   • Verify Model Cache: Check ~/.qvac (or %USERPROFILE%\\.qvac). If corrupt:`,
    `     PowerShell:  Remove-Item -Recurse -Force "$HOME\\.qvac\\*"`,
    `     CMD:         rmdir /s /q "%USERPROFILE%\\.qvac"`,
    `   • Run Pre-Check: Verify with 'node -v' and retry with extended timeout:`,
    `     PowerShell:  $env:QVAC_RPC_INIT_TIMEOUT_MS="120000"; node src/index.js --cli`,
    separator
  ].filter((line) => line !== null);

  return lines.join('\n');
}

/**
 * Creates an enhanced Error object containing diagnostic details.
 *
 * @param {any} error
 * @param {string} [context='Worker operation']
 * @returns {Error}
 */
export function createWorkerError(error, context = 'Worker operation') {
  const diagnostic = formatWorkerDiagnostic(error, context);
  const enhanced = new Error(diagnostic);
  enhanced.name = 'QVACWorkerError';
  enhanced.code = error?.code || 'ERR_QVAC_WORKER';
  enhanced.originalError = error;
  enhanced.context = context;
  enhanced.isWorkerTimeout = isWorkerTimeoutOrCrash(error);
  enhanced.diagnostic = diagnostic;
  return enhanced;
}

/**
 * Handles a worker error or wraps an async worker operation.
 * Detects RPC initialization timeouts, bare worker death, and translates them
 * into actionable diagnostic guidance for Windows users.
 *
 * Usage:
 *   // Direct error handling:
 *   try {
 *     await loadModel(...);
 *   } catch (err) {
 *     handleWorkerError(err, 'loadModel');
 *   }
 *
 *   // As a wrapper around a function:
 *   const modelId = await handleWorkerError(() => loadModel(...), 'loadModel');
 *
 * @param {any} errorOrFn - The caught error, or an async function to execute.
 * @param {string} [context='Worker operation'] - Contextual label for logging/diagnostics.
 * @returns {any}
 */
export function handleWorkerError(errorOrFn, context = 'Worker operation') {
  if (typeof errorOrFn === 'function') {
    return (async () => {
      try {
        return await errorOrFn();
      } catch (err) {
        throw createWorkerError(err, context);
      }
    })();
  }

  if (errorOrFn && typeof errorOrFn.then === 'function') {
    return errorOrFn.catch((err) => {
      throw createWorkerError(err, context);
    });
  }

  throw createWorkerError(errorOrFn, context);
}

handleWorkerError.create = createWorkerError;
handleWorkerError.isTimeout = isWorkerTimeoutOrCrash;
handleWorkerError.diagnostic = formatWorkerDiagnostic;
handleWorkerError.checkNode = checkNodeCompatibility;

/**
 * Wraps a promise with a timeout in milliseconds.
 *
 * @template T
 * @param {Promise<T> | (() => Promise<T>)} promiseOrFn - The promise or async function to await.
 * @param {number} [ms=30000] - Timeout duration in milliseconds (default: 30000).
 * @param {string} [desc='Operation'] - Description of the operation for error messaging.
 * @returns {Promise<T>}
 */
export function withTimeout(promiseOrFn, ms = 30000, desc = 'Operation') {
  const targetPromise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;

  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const err = new Error(`${desc} timed out after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
    if (timerId?.unref) {
      timerId.unref();
    }
  });

  return Promise.race([
    targetPromise,
    timeoutPromise
  ]).finally(() => {
    if (timerId) {
      clearTimeout(timerId);
    }
  });
}
