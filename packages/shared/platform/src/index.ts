/**
 * Cross-platform utilities for Open Code Review.
 *
 * Thin wrappers around Node.js built-in APIs that handle Windows-specific
 * requirements (file:// URLs for ESM imports, shell for .cmd shims).
 * These work identically on all platforms — no conditional branching needed
 * at call sites.
 */

import { pathToFileURL } from "node:url";
import {
  execFileSync,
  spawn,
  type SpawnOptions,
  type ExecFileSyncOptions,
  type ChildProcess,
} from "node:child_process";

const isWindows = process.platform === "win32";

/**
 * Dynamically import a module from an absolute file path.
 *
 * Converts the path to a `file://` URL before importing, which is required
 * on Windows and harmless on POSIX. This is the canonical approach recommended
 * by the Node.js ESM documentation.
 */
export async function importModule<T = Record<string, unknown>>(
  absolutePath: string,
): Promise<T> {
  return import(pathToFileURL(absolutePath).href) as Promise<T>;
}

/**
 * Execute a binary synchronously with cross-platform .cmd/.bat support.
 *
 * On Windows, npm-installed binaries are `.cmd` shims that require a shell
 * to execute. On POSIX, `shell: false` is used to avoid unnecessary shell
 * injection surface.
 */
export function execBinary(
  binary: string,
  args: string[],
  opts?: ExecFileSyncOptions,
): string {
  return execFileSync(binary, args, {
    ...opts,
    shell: isWindows,
  }) as string;
}

/**
 * Spawn a child process with cross-platform .cmd/.bat support.
 *
 * On Windows, sets `shell: true` for .cmd shim resolution and
 * `windowsHide: true` to prevent a console window from flashing
 * (important when combined with `detached: true`).
 */
export function spawnBinary(
  binary: string,
  args: string[],
  opts?: SpawnOptions,
): ChildProcess {
  return spawn(binary, args, {
    ...opts,
    ...(isWindows && { shell: true, windowsHide: true }),
  });
}
