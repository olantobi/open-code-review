/**
 * Spawn the built OCR CLI as a real subprocess.
 *
 * Uses `node dist/index.js` rather than the shebang to ensure
 * cross-platform compatibility (Windows does not honor shebangs).
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_BIN = resolve(
  import.meta.dirname,
  "../../../../packages/cli/dist/index.js",
);

if (!existsSync(CLI_BIN)) {
  throw new Error(
    `CLI binary not found at ${CLI_BIN}. Run "pnpm nx build cli" first.`,
  );
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CliTimeoutError extends Error {
  constructor(
    public readonly args: string[],
    public readonly timeoutMs: number,
  ) {
    super(
      `CLI timed out after ${timeoutMs}ms running: ocr ${args.join(" ")}`,
    );
    this.name = "CliTimeoutError";
  }
}

export async function spawnCli(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [CLI_BIN, ...args],
      {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env, NO_COLOR: "1" },
        timeout: options?.timeout ?? 30_000,
      },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };

    if (e.killed) {
      throw new CliTimeoutError(args, options?.timeout ?? 30_000);
    }

    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}
