// Shared types between dashboard client and server
// Socket.IO event types, API response types, etc.

export type SessionStatus = 'active' | 'closed'
export type WorkflowType = 'review' | 'map'
export type FindingTriage = 'unread' | 'read' | 'acknowledged' | 'fixed' | 'wont_fix'
export type RoundTriage = 'needs_review' | 'in_progress' | 'changes_made' | 'acknowledged' | 'dismissed'
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type NoteTargetType = 'session' | 'round' | 'finding' | 'run' | 'section' | 'file'
export type ChatTargetType = 'map_run' | 'review_round'
export type PostReviewStep = 'idle' | 'checking' | 'ready' | 'generating' | 'preview' | 'posting' | 'posted' | 'error'

// ── Reviewers Meta (structured reviewer catalog for dashboard) ──

export type ReviewerTier = 'holistic' | 'specialist' | 'persona' | 'custom'

export type ReviewerMeta = {
  id: string
  name: string
  tier: ReviewerTier
  icon: string
  description: string
  focus_areas: string[]
  is_default: boolean
  is_builtin: boolean
  known_for?: string
  philosophy?: string
}
