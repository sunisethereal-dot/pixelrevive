// src/runtime-check.js
// SPDX-License-Identifier: Apache-2.0

/**
 * Parses a semver version string into major, minor, patch numbers.
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const clean = version.trim().replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Checks whether a Node.js version satisfies ^22.21.0 || >=24.9.0.
 *
 * @param {string} version
 * @returns {{ compatible: boolean, isLessThan22_21: boolean }}
 */
function checkEngineCompatibility(version) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return { compatible: false, isLessThan22_21: true };
  }

  const { major, minor, patch } = parsed;

  // Check if version is strictly less than 22.21.0
  const isLessThan22_21 = major < 22 || (major === 22 && minor < 21);

  // ^22.21.0 matches: major === 22 and (minor > 21 or (minor === 21 and patch >= 0))
  const isNode22 = major === 22 && (minor > 21 || (minor === 21 && patch >= 0));

  // >=24.9.0 matches: major > 24 or (major === 24 and (minor > 9 or (minor === 9 and patch >= 0)))
  const isNode24Plus = major > 24 || (major === 24 && (minor > 9 || (minor === 9 && patch >= 0)));

  const compatible = isNode22 || isNode24Plus;

  return { compatible, isLessThan22_21 };
}

/**
 * Verifies that the Node.js runtime is compatible with @qvac/sdk requirements.
 *
 * Checks process.versions.node against ^22.21.0 || >=24.9.0.
 * If < 22.21.0, prints a helpful, clean warning explaining that the underlying
 * Bare runtime modules (bare-module-lexer, bare-type-stripper) in @qvac/sdk
 * require Node 22.21.0+ to prevent worker startup crashes.
 *
 * @param {string} [nodeVersion=process.versions.node] - Optional Node.js version string to check
 * @returns {{ compatible: boolean, nodeVersion: string, warning: string | null }}
 */
export function verifyRuntimeCompatibility(nodeVersion = process.versions.node) {
  const version = typeof nodeVersion === 'string' ? nodeVersion : (process.versions?.node || '');
  const { compatible, isLessThan22_21 } = checkEngineCompatibility(version);

  let warning = null;

  if (isLessThan22_21) {
    warning =
      `[PixelRevive] Node.js runtime warning: Current Node.js version is ${version}.\n` +
      `The underlying Bare runtime modules (bare-module-lexer, bare-type-stripper) in @qvac/sdk ` +
      `require Node 22.21.0+ to prevent worker startup crashes.\n` +
      `Please upgrade your Node.js runtime to ^22.21.0 or >=24.9.0.`;
    console.warn(warning);
  } else if (!compatible) {
    warning =
      `[PixelRevive] Node.js runtime warning: Current Node.js version ${version} does not satisfy ` +
      `the required engines range (^22.21.0 || >=24.9.0). Worker thread or module loading issues may occur.`;
    console.warn(warning);
  }

  return {
    compatible,
    nodeVersion: version,
    warning
  };
}

export default verifyRuntimeCompatibility;
