/**
 * Session CRUD endpoints.
 *
 * Enriches raw `SessionRow` objects with per-workflow progress derived
 * from artifact tables (review_rounds, map_runs, markdown_artifacts).
 * This lets the client render independent progress for review and map
 * workflows without requiring CLI schema changes.
 */

import { Router } from 'express'
import type { Database } from 'sql.js'
import {
  type SessionRow,
  getAllSessions,
  getSession,
  getEventsForSession,
  getRoundsForSession,
  getMapRunsForSession,
  getArtifact,
  getReviewerOutputsForRound,
} from '../db.js'

// Phase names must match session-detail-page.tsx constants
const REVIEW_PHASE_NAMES = [
  'context',
  'change-context',
  'analysis',
  'reviews',
  'aggregation',
  'discourse',
  'synthesis',
  'complete',
]

const MAP_PHASE_NAMES = [
  'map-context',
  'topology',
  'flow-analysis',
  'requirements-mapping',
  'synthesis',
  'complete',
]

// ── Enrichment ──

interface EnrichedSession extends SessionRow {
  has_review: boolean
  has_map: boolean
  review_phase_number: number
  review_phase: string
  map_phase_number: number
  map_phase: string
}

/**
 * Derive the review workflow's phase number from artifact presence.
 */
function deriveReviewPhase(db: Database, sessionId: string): number {
  const rounds = getRoundsForSession(db, sessionId)
  if (rounds.length === 0) {
    // No rounds, check if context artifacts exist (review was started but no round yet)
    const context = getArtifact(db, sessionId, 'context')
    if (context) return 3 // analysis
    const standards = getArtifact(db, sessionId, 'discovered-standards')
    if (standards) return 2 // change-context
    return 1 // context
  }

  const latestRound = rounds[rounds.length - 1]!
  if (latestRound.final_md_path) return 8 // complete
  const discourse = getArtifact(db, sessionId, 'discourse')
  if (discourse) return 7 // synthesis
  const outputs = getReviewerOutputsForRound(db, latestRound.id)
  if (outputs.length > 0) return 4 // reviews
  const context = getArtifact(db, sessionId, 'context')
  if (context) return 3 // analysis
  const standards = getArtifact(db, sessionId, 'discovered-standards')
  if (standards) return 2 // change-context
  return 1
}

/**
 * Derive the map workflow's phase number from artifact presence.
 */
function deriveMapPhase(db: Database, sessionId: string): number {
  const runs = getMapRunsForSession(db, sessionId)
  if (runs.length === 0) {
    const standards = getArtifact(db, sessionId, 'discovered-standards')
    if (standards) return 2 // topology
    return 1 // map-context
  }

  const latestRun = runs[runs.length - 1]!
  if (latestRun.map_md_path) return 6 // complete
  const reqMapping = getArtifact(db, sessionId, 'requirements-mapping')
  if (reqMapping) return 5 // synthesis
  const flow = getArtifact(db, sessionId, 'flow-analysis')
  if (flow) return 4 // requirements-mapping
  const topo = getArtifact(db, sessionId, 'topology')
  if (topo) return 3 // flow-analysis
  const standards = getArtifact(db, sessionId, 'discovered-standards')
  if (standards) return 2 // topology
  return 1
}

function enrichSession(db: Database, session: SessionRow): EnrichedSession {
  const rounds = getRoundsForSession(db, session.id)
  const mapRuns = getMapRunsForSession(db, session.id)

  const hasReview = session.workflow_type === 'review' || session.current_round > 0 || rounds.length > 0
  const hasMap = session.workflow_type === 'map' || session.current_map_run > 1 || mapRuns.length > 0

  // For the primary workflow (matching workflow_type), use the CLI's authoritative phase_number.
  // For the secondary workflow, derive from artifacts.
  let reviewPhaseNumber = 0
  let reviewPhase = ''
  if (hasReview) {
    if (session.workflow_type === 'review') {
      reviewPhaseNumber = session.phase_number
      reviewPhase = session.current_phase
    } else {
      reviewPhaseNumber = deriveReviewPhase(db, session.id)
      reviewPhase = REVIEW_PHASE_NAMES[reviewPhaseNumber - 1] ?? 'context'
    }
  }

  let mapPhaseNumber = 0
  let mapPhase = ''
  if (hasMap) {
    if (session.workflow_type === 'map') {
      mapPhaseNumber = session.phase_number
      mapPhase = session.current_phase
    } else {
      mapPhaseNumber = deriveMapPhase(db, session.id)
      mapPhase = MAP_PHASE_NAMES[mapPhaseNumber - 1] ?? 'map-context'
    }
  }

  return {
    ...session,
    has_review: hasReview,
    has_map: hasMap,
    review_phase_number: reviewPhaseNumber,
    review_phase: reviewPhase,
    map_phase_number: mapPhaseNumber,
    map_phase: mapPhase,
  }
}

// ── Router ──

export function createSessionsRouter(db: Database): Router {
  const router = Router()

  // GET /api/sessions — List all sessions, sorted by updated_at desc
  router.get('/', (_req, res) => {
    try {
      const sessions = getAllSessions(db)
      res.json(sessions.map((s) => enrichSession(db, s)))
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
      res.status(500).json({ error: 'Failed to fetch sessions' })
    }
  })

  // GET /api/sessions/:id — Get single session with detail
  router.get('/:id', (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json(enrichSession(db, session))
    } catch (err) {
      console.error('Failed to fetch session:', err)
      res.status(500).json({ error: 'Failed to fetch session' })
    }
  })

  // GET /api/sessions/:id/events — Get orchestration events for session
  router.get('/:id/events', (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const events = getEventsForSession(db, req.params['id'] as string)
      res.json(events)
    } catch (err) {
      console.error('Failed to fetch events:', err)
      res.status(500).json({ error: 'Failed to fetch events' })
    }
  })

  return router
}
