/**
 * Socket.IO post-to-GitHub handler.
 *
 * Manages the "Post to GitHub" flow: checking gh auth, generating
 * human-voice reviews via Claude CLI, saving drafts, and posting
 * PR comments via gh CLI.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from 'sql.js'
import { getSession, saveDb } from '../db.js'
import { cleanEnv } from './env.js'
import { buildHumanReviewPrompt } from '../prompts/human-review.js'

const execFileAsync = promisify(execFile)

/** Common git branch prefixes that use a slash separator. */
const BRANCH_PREFIXES = [
  'feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'ci',
  'build', 'perf', 'style', 'hotfix', 'release', 'bugfix',
]

/**
 * Try to find an open PR for the given branch.
 *
 * Session IDs encode the branch with hyphens (e.g. `feat-foo` for `feat/foo`),
 * so when the DB branch has no slash we also try restoring common prefixes.
 */
async function findPrForBranch(
  branch: string,
  env: NodeJS.ProcessEnv,
): Promise<{ prNumber: number; prUrl: string; resolvedBranch: string } | null> {
  const candidates = [branch]

  // If the branch has no slash, generate candidates by restoring common prefixes
  if (!branch.includes('/')) {
    for (const prefix of BRANCH_PREFIXES) {
      if (branch.startsWith(`${prefix}-`)) {
        candidates.push(`${prefix}/${branch.slice(prefix.length + 1)}`)
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'list', '--head', candidate, '--json', 'number,url', '--limit', '1'],
        { env },
      )
      const prs = JSON.parse(stdout) as { number: number; url: string }[]
      if (prs.length > 0 && prs[0]) {
        return { prNumber: prs[0].number, prUrl: prs[0].url, resolvedBranch: candidate }
      }
    } catch {
      // Try next candidate
    }
  }

  return null
}

// ── Active generation processes ──

const activeGenerations = new Map<string, ChildProcess>()

// ── Helpers ──

function formatToolDetail(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `Reading ${input['file_path'] ?? 'file'}`
    case 'Grep':
      return `Searching for "${input['pattern'] ?? '...'}"`
    case 'Glob':
      return `Finding files matching ${input['pattern'] ?? '...'}`
    default:
      return `Using ${tool}`
  }
}

function extractFullText(parsed: Record<string, unknown>): string {
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

/**
 * Registers post-to-GitHub socket handlers for a connected client.
 */
export function registerPostHandlers(
  _io: SocketIOServer,
  socket: Socket,
  db: Database,
  ocrDir: string,
): void {
  // ── Check GitHub CLI auth + find PR ──
  socket.on('post:check-gh', async (payload: { sessionId: string }) => {
    try {
      const { sessionId } = payload ?? {}
      if (typeof sessionId !== 'string') {
        socket.emit('post:gh-result', {
          authenticated: false,
          prNumber: null,
          prUrl: null,
          branch: null,
          error: 'Invalid sessionId',
        })
        return
      }

      const session = getSession(db, sessionId)
      if (!session) {
        socket.emit('post:gh-result', {
          authenticated: false,
          prNumber: null,
          prUrl: null,
          branch: null,
          error: 'Session not found',
        })
        return
      }

      const branch = session.branch

      // Check gh auth
      try {
        await execFileAsync('gh', ['auth', 'status'], { env: cleanEnv() })
      } catch {
        socket.emit('post:gh-result', {
          authenticated: false,
          prNumber: null,
          prUrl: null,
          branch,
          error: 'GitHub CLI is not authenticated. Run `gh auth login` first.',
        })
        return
      }

      // Find PR for branch (tries slash-restored variants if needed)
      const pr = await findPrForBranch(branch, cleanEnv())
      if (pr) {
        socket.emit('post:gh-result', {
          authenticated: true,
          prNumber: pr.prNumber,
          prUrl: pr.prUrl,
          branch: pr.resolvedBranch,
        })
      } else {
        socket.emit('post:gh-result', {
          authenticated: true,
          prNumber: null,
          prUrl: null,
          branch,
          error: `No open PR found for branch "${branch}".`,
        })
      }
    } catch (err) {
      console.error('Error in post:check-gh handler:', err)
      socket.emit('post:gh-result', {
        authenticated: false,
        prNumber: null,
        prUrl: null,
        branch: null,
        error: 'Internal error',
      })
    }
  })

  // ── Generate human review via Claude ──
  socket.on('post:generate', (payload: { sessionId: string; roundNumber: number }) => {
    try {
      const { sessionId, roundNumber } = payload ?? {}
      if (typeof sessionId !== 'string' || typeof roundNumber !== 'number') {
        socket.emit('post:error', { error: 'Invalid payload' })
        return
      }

      const session = getSession(db, sessionId)
      if (!session) {
        socket.emit('post:error', { error: 'Session not found' })
        return
      }

      // Read final.md + all reviewer outputs
      const sessionDir = session.session_dir || join(ocrDir, 'sessions', sessionId)
      const roundDir = join(sessionDir, 'rounds', `round-${roundNumber}`)
      const finalPath = join(roundDir, 'final.md')

      if (!existsSync(finalPath)) {
        socket.emit('post:error', { error: 'final.md not found for this round' })
        return
      }

      const finalContent = readFileSync(finalPath, 'utf-8')

      // Collect reviewer outputs
      const reviewerContents: { name: string; content: string }[] = []
      const reviewsDir = join(roundDir, 'reviews')
      if (existsSync(reviewsDir)) {
        const files = readdirSync(reviewsDir).filter((f) => f.endsWith('.md'))
        for (const file of files) {
          reviewerContents.push({
            name: file.replace(/\.md$/, ''),
            content: readFileSync(join(reviewsDir, file), 'utf-8'),
          })
        }
      }

      // Build prompt
      const prompt = buildHumanReviewPrompt(finalContent, reviewerContents)

      // Write prompt to temp file
      const tmpDir = join('/tmp', 'ocr-post-prompts')
      try { mkdirSync(tmpDir, { recursive: true, mode: 0o700 }) } catch { /* exists */ }
      const tmpFile = join(tmpDir, `${randomUUID()}.txt`)
      writeFileSync(tmpFile, prompt, { mode: 0o600 })

      // Build shell command
      const flags = [
        '--print',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--max-turns', '1',
        '--allowedTools', 'Read,Grep,Glob',
      ]
      const flagStr = flags.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')
      const shellCmd = `cat '${tmpFile}' | claude ${flagStr}`

      const proc = spawn('sh', ['-c', shellCmd], {
        cwd: process.cwd(),
        env: cleanEnv(),
      })

      // Track process for cancellation
      const generationKey = `${sessionId}-${roundNumber}`
      activeGenerations.set(generationKey, proc)

      // Parse NDJSON stream
      let assistantText = ''
      let lineBuffer = ''
      let thinkingStatusEmitted = false
      const emittedToolUseIds = new Set<string>()

      proc.stdout?.on('data', (chunk: Buffer) => {
        lineBuffer += chunk.toString()
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>
            handleNdjsonLine(parsed)
          } catch {
            // Skip non-JSON lines
          }
        }
      })

      function handleNdjsonLine(parsed: Record<string, unknown>): void {
        const type = parsed['type'] as string | undefined

        if (type === 'stream_event') {
          const event = parsed['event'] as Record<string, unknown> | undefined
          if (!event) return
          const eventType = event['type'] as string | undefined

          if (eventType === 'content_block_delta') {
            const delta = event['delta'] as Record<string, unknown> | undefined
            const deltaType = delta?.['type'] as string | undefined

            if (deltaType === 'text_delta' && typeof delta?.['text'] === 'string') {
              const text = delta['text'] as string
              assistantText += text
              socket.emit('post:token', { token: text })
            }

            if (deltaType === 'thinking_delta' && !thinkingStatusEmitted) {
              thinkingStatusEmitted = true
              socket.emit('post:status', { tool: 'thinking', detail: 'Thinking...' })
            }
          }

          if (eventType === 'content_block_start') {
            const block = event['content_block'] as Record<string, unknown> | undefined
            if (block?.['type'] === 'tool_use') {
              const toolId = block['id'] as string
              if (toolId && !emittedToolUseIds.has(toolId)) {
                emittedToolUseIds.add(toolId)
                const toolName = block['name'] as string
                const input = (block['input'] as Record<string, unknown>) ?? {}
                socket.emit('post:status', {
                  tool: toolName,
                  detail: formatToolDetail(toolName, input),
                })
              }
            }
          }
        }

        if (type === 'assistant') {
          const fullText = extractFullText(parsed)
          if (fullText.length > 0) {
            assistantText = fullText
          }
        }
      }

      let stderrBuffer = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString()
      })

      proc.on('close', (code) => {
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
        activeGenerations.delete(generationKey)

        // Process remaining buffer
        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer) as Record<string, unknown>
            handleNdjsonLine(parsed)
          } catch {
            // Skip
          }
        }

        if (code === 0 && assistantText.trim()) {
          socket.emit('post:done', { content: assistantText.trim() })
        } else if (code === null) {
          // Process was killed (cancelled)
          socket.emit('post:cancelled', {})
        } else {
          socket.emit('post:error', {
            error: stderrBuffer || `Claude process exited with code ${code}`,
          })
        }
      })

      proc.on('error', (err) => {
        socket.emit('post:error', {
          error: `Failed to spawn Claude: ${err.message}`,
        })
        activeGenerations.delete(generationKey)
      })
    } catch (err) {
      console.error('Error in post:generate handler:', err)
      socket.emit('post:error', { error: 'Internal error' })
    }
  })

  // ── Cancel generation ──
  socket.on('post:cancel', (payload: { sessionId: string; roundNumber: number }) => {
    try {
      const { sessionId, roundNumber } = payload ?? {}
      const key = `${sessionId}-${roundNumber}`
      const proc = activeGenerations.get(key)
      if (proc && !proc.killed) {
        proc.kill('SIGTERM')
      }
      activeGenerations.delete(key)
    } catch (err) {
      console.error('Error in post:cancel handler:', err)
    }
  })

  // ── Save human review draft ──
  socket.on(
    'post:save',
    (payload: { sessionId: string; roundNumber: number; content: string }) => {
      try {
        const { sessionId, roundNumber, content } = payload ?? {}
        if (
          typeof sessionId !== 'string' ||
          typeof roundNumber !== 'number' ||
          typeof content !== 'string'
        ) {
          socket.emit('post:save-result', { success: false, error: 'Invalid payload' })
          return
        }

        const session = getSession(db, sessionId)
        if (!session) {
          socket.emit('post:save-result', { success: false, error: 'Session not found' })
          return
        }

        const sessionDir = session.session_dir || join(ocrDir, 'sessions', sessionId)
        const roundDir = join(sessionDir, 'rounds', `round-${roundNumber}`)
        mkdirSync(roundDir, { recursive: true })

        const filePath = join(roundDir, 'final-human.md')
        writeFileSync(filePath, content, { mode: 0o644 })

        saveDb(db, ocrDir)

        socket.emit('post:save-result', { success: true })
      } catch (err) {
        console.error('Error in post:save handler:', err)
        socket.emit('post:save-result', { success: false, error: 'Internal error' })
      }
    },
  )

  // ── Submit review to GitHub ──
  socket.on(
    'post:submit',
    async (payload: { prNumber: number; content: string }) => {
      try {
        const { prNumber, content } = payload ?? {}
        if (typeof prNumber !== 'number' || typeof content !== 'string') {
          socket.emit('post:submit-result', { success: false, error: 'Invalid payload' })
          return
        }

        // Write content to temp file for --body-file
        const tmpDir = join('/tmp', 'ocr-post-comments')
        try { mkdirSync(tmpDir, { recursive: true, mode: 0o700 }) } catch { /* exists */ }
        const tmpFile = join(tmpDir, `${randomUUID()}.md`)
        writeFileSync(tmpFile, content, { mode: 0o600 })

        try {
          const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'comment', String(prNumber), '--body-file', tmpFile],
            { env: cleanEnv() },
          )

          // Try to extract the comment URL from gh output
          const urlMatch = stdout.match(/(https:\/\/github\.com\S+)/)?.[0] ?? null

          socket.emit('post:submit-result', { success: true, commentUrl: urlMatch })
        } catch (err) {
          socket.emit('post:submit-result', {
            success: false,
            error: `Failed to post comment: ${err instanceof Error ? err.message : 'Unknown error'}`,
          })
        } finally {
          try { unlinkSync(tmpFile) } catch { /* ignore */ }
        }
      } catch (err) {
        console.error('Error in post:submit handler:', err)
        socket.emit('post:submit-result', { success: false, error: 'Internal error' })
      }
    },
  )
}

/**
 * Kill all active generation processes. Called during server shutdown.
 */
export function cleanupAllPostGenerations(): void {
  for (const [key, proc] of activeGenerations) {
    if (!proc.killed) {
      proc.kill('SIGTERM')
    }
    activeGenerations.delete(key)
  }
}
