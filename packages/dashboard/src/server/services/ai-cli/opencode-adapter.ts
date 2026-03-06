/**
 * OpenCode CLI adapter (stub).
 *
 * Implements detection for the OpenCode binary. Spawn and parse are
 * not yet implemented — they will be completed once the `opencode run
 * --format json` output format is tested against a live install.
 *
 * OpenCode invocation will use:
 *   opencode run "prompt" --format json --agent build
 *
 * Key differences from Claude Code:
 * - Prompt passed as CLI argument (no cat pipe needed)
 * - `--format json` for structured output (different event schema)
 * - Agent-based tool control (`--agent build` for all tools)
 * - Session management via SDK/server, not `--resume`
 */

import { execFileSync } from 'node:child_process'
import type {
  AiCliAdapter,
  DetectionResult,
  NormalizedEvent,
  SpawnOptions,
  SpawnResult,
} from './types.js'

export class OpenCodeAdapter implements AiCliAdapter {
  readonly name = 'OpenCode'
  readonly binary = 'opencode'

  detect(): DetectionResult {
    try {
      const output = execFileSync('opencode', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const match = output.match(/\d+\.\d+[\.\d]*/)
      return { found: true, version: match?.[0] }
    } catch {
      return { found: false }
    }
  }

  spawn(_opts: SpawnOptions): SpawnResult {
    throw new Error(
      'OpenCode adapter: spawn() is not yet implemented. ' +
      'Full OpenCode support requires testing against the `opencode run --format json` output format.',
    )
  }

  parseLine(_line: string): NormalizedEvent[] {
    throw new Error(
      'OpenCode adapter: parseLine() is not yet implemented. ' +
      'Full OpenCode support requires testing against the `opencode run --format json` output format.',
    )
  }
}
