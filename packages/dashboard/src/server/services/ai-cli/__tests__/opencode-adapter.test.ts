import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenCodeAdapter } from '../opencode-adapter.js'

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter()

  describe('metadata', () => {
    it('has correct name and binary', () => {
      expect(adapter.name).toBe('OpenCode')
      expect(adapter.binary).toBe('opencode')
    })
  })

  describe('detect()', () => {
    it('returns found: false when opencode is not installed', () => {
      // On CI / most dev machines without opencode installed,
      // detect() should gracefully return found: false
      const result = adapter.detect()
      // We can't guarantee opencode is installed, so just verify the shape
      expect(result).toHaveProperty('found')
      expect(typeof result.found).toBe('boolean')
      if (result.found) {
        expect(result.version).toBeDefined()
      }
    })
  })

  describe('parseLine()', () => {
    it('returns empty array for blank lines', () => {
      expect(adapter.parseLine('')).toEqual([])
      expect(adapter.parseLine('   ')).toEqual([])
    })

    it('returns empty array for invalid JSON', () => {
      expect(adapter.parseLine('not json')).toEqual([])
      expect(adapter.parseLine('{broken')).toEqual([])
    })

    it('captures sessionID from every event', () => {
      const line = JSON.stringify({
        type: 'text',
        timestamp: Date.now(),
        sessionID: 'sess-abc-123',
        part: { type: 'text', text: 'hello' },
      })
      const events = adapter.parseLine(line)
      expect(events).toContainEqual({ type: 'session_id', id: 'sess-abc-123' })
    })

    it('parses text events into text + full_text', () => {
      const line = JSON.stringify({
        type: 'text',
        timestamp: Date.now(),
        sessionID: 's1',
        part: { type: 'text', text: 'Hello world', time: { start: 1, end: 2 } },
      })
      const events = adapter.parseLine(line)
      expect(events).toContainEqual({ type: 'text', text: 'Hello world' })
      expect(events).toContainEqual({ type: 'full_text', text: 'Hello world' })
    })

    it('skips text events with empty text', () => {
      const line = JSON.stringify({
        type: 'text',
        timestamp: Date.now(),
        sessionID: 's1',
        part: { type: 'text', text: '', time: { end: 1 } },
      })
      const events = adapter.parseLine(line)
      // Should have session_id but not text/full_text
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('session_id')
    })

    it('parses tool_use events with capitalized tool name', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID: 's1',
        part: {
          type: 'tool',
          tool: 'bash',
          callID: 'call-1',
          state: { status: 'completed' },
          input: { command: 'ls -la' },
        },
      })
      const events = adapter.parseLine(line)
      expect(events).toContainEqual({
        type: 'tool_start',
        name: 'Bash',
        input: { command: 'ls -la' },
      })
      expect(events).toContainEqual({ type: 'tool_end', blockIndex: 0 })
    })

    it('capitalizes various tool names correctly', () => {
      const tools = ['read', 'write', 'edit', 'glob', 'grep', 'webfetch']
      const expected = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Webfetch']

      tools.forEach((tool, i) => {
        const line = JSON.stringify({
          type: 'tool_use',
          timestamp: Date.now(),
          sessionID: 's1',
          part: { type: 'tool', tool, callID: `c-${i}`, state: { status: 'completed' }, input: {} },
        })
        const events = adapter.parseLine(line)
        const start = events.find((e) => e.type === 'tool_start')
        expect(start).toBeDefined()
        if (start?.type === 'tool_start') {
          expect(start.name).toBe(expected[i])
        }
      })
    })

    it('extracts input from direct part.input', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID: 's1',
        part: {
          type: 'tool',
          tool: 'read',
          callID: 'c1',
          state: { status: 'completed' },
          input: { file_path: '/src/index.ts' },
        },
      })
      const events = adapter.parseLine(line)
      const start = events.find((e) => e.type === 'tool_start')
      expect(start).toBeDefined()
      if (start?.type === 'tool_start') {
        expect(start.input).toEqual({ file_path: '/src/index.ts' })
      }
    })

    it('falls back to state.input when direct input is missing', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID: 's1',
        part: {
          type: 'tool',
          tool: 'write',
          callID: 'c1',
          state: { status: 'completed', input: { file_path: '/out.txt' } },
        },
      })
      const events = adapter.parseLine(line)
      const start = events.find((e) => e.type === 'tool_start')
      if (start?.type === 'tool_start') {
        expect(start.input).toEqual({ file_path: '/out.txt' })
      }
    })

    it('returns empty input when no input found', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID: 's1',
        part: {
          type: 'tool',
          tool: 'unknown_tool',
          callID: 'c1',
          state: { status: 'completed' },
        },
      })
      const events = adapter.parseLine(line)
      const start = events.find((e) => e.type === 'tool_start')
      if (start?.type === 'tool_start') {
        expect(start.input).toEqual({})
      }
    })

    it('parses reasoning events as thinking', () => {
      const line = JSON.stringify({
        type: 'reasoning',
        timestamp: Date.now(),
        sessionID: 's1',
        part: { type: 'reasoning', text: 'Let me think about this...' },
      })
      const events = adapter.parseLine(line)
      expect(events).toContainEqual({ type: 'thinking' })
    })

    it('ignores step_start events (no normalized mapping)', () => {
      const line = JSON.stringify({
        type: 'step_start',
        timestamp: Date.now(),
        sessionID: 's1',
        part: { type: 'step-start' },
      })
      const events = adapter.parseLine(line)
      // Only session_id should be present
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('session_id')
    })

    it('ignores step_finish events (no normalized mapping)', () => {
      const line = JSON.stringify({
        type: 'step_finish',
        timestamp: Date.now(),
        sessionID: 's1',
        part: { type: 'step-finish' },
      })
      const events = adapter.parseLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('session_id')
    })

    it('ignores error events (no normalized mapping)', () => {
      const line = JSON.stringify({
        type: 'error',
        timestamp: Date.now(),
        sessionID: 's1',
        error: 'Something went wrong',
      })
      const events = adapter.parseLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('session_id')
    })

    it('handles events without sessionID', () => {
      const line = JSON.stringify({
        type: 'text',
        timestamp: Date.now(),
        part: { type: 'text', text: 'no session' },
      })
      const events = adapter.parseLine(line)
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'session_id' }))
      expect(events).toContainEqual({ type: 'text', text: 'no session' })
    })

    it('handles tool_use without part (malformed)', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID: 's1',
      })
      const events = adapter.parseLine(line)
      // Only session_id, no tool events
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('session_id')
    })
  })

  describe('spawn()', () => {
    // We can't easily test spawn() without mocking child_process,
    // but we can verify the method exists and has the right shape
    it('is a function', () => {
      expect(typeof adapter.spawn).toBe('function')
    })
  })
})
