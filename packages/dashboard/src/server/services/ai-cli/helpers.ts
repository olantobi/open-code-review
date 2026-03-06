/**
 * Shared helpers for AI CLI adapters.
 *
 * Consolidates utility functions that were previously duplicated across
 * command-runner.ts, chat-handler.ts, and post-handler.ts.
 */

import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// ── Tool Detail Formatting ──
// Converts tool_use blocks into human-readable terminal lines.

export function formatToolDetail(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `Reading ${input['file_path'] ?? 'file'}`
    case 'Write':
      return `Writing ${input['file_path'] ?? 'file'}`
    case 'Edit':
      return `Editing ${input['file_path'] ?? 'file'}`
    case 'Grep':
      return `Searching for "${input['pattern'] ?? '...'}"`
    case 'Glob':
      return `Finding files matching ${input['pattern'] ?? '...'}`
    case 'Bash': {
      let cmd = (input['command'] as string) ?? '...'
      // Strip "cd /long/path && " prefix — the cwd is already known
      cmd = cmd.replace(/^cd\s+\S+\s*&&\s*/, '')
      return `Running: ${cmd.slice(0, 120)}`
    }
    case 'Agent':
      return `Spawning agent: ${input['description'] ?? '...'}`
    default:
      return `Using ${tool}`
  }
}

// ── Assistant Text Extraction ──
// Extracts concatenated text from a complete Claude Code assistant message.

export function extractAssistantText(parsed: Record<string, unknown>): string {
  const msg = parsed['message'] as Record<string, unknown> | undefined
  const content = msg?.['content'] as Array<Record<string, unknown>> | undefined
  if (!content) return ''

  let text = ''
  for (const block of content) {
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      text += block['text']
    }
  }
  return text
}

// ── Temp File Management ──
// Writes prompts to secure temp files and provides cleanup.

const TEMP_BASE = join(tmpdir(), 'ocr-ai-prompts')

export function writeTempPrompt(prompt: string): string {
  try { mkdirSync(TEMP_BASE, { recursive: true, mode: 0o700 }) } catch { /* exists */ }
  const tmpFile = join(TEMP_BASE, `${randomUUID()}.txt`)
  writeFileSync(tmpFile, prompt, { mode: 0o600 })
  return tmpFile
}

export function cleanupTempFile(path: string): void {
  try { unlinkSync(path) } catch { /* ignore */ }
}
