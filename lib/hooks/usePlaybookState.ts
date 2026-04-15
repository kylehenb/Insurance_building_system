/**
 * usePlaybookState
 *
 * Accepts a JobPlaybookContext and returns the resolved status of every
 * visible playbook step, the current step ID, and overall progress.
 *
 * Skipped step IDs are persisted in localStorage keyed by job ID so they
 * survive page refreshes.
 */

import { useState, useCallback, useMemo } from 'react'
import { playbookSteps, type PlaybookStep, type PlaybookStepStatus, type JobPlaybookContext } from '@/lib/playbook/steps'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComputedStep extends PlaybookStep {
  /** Resolved status evaluated against live job data */
  status: PlaybookStepStatus
}

export interface PlaybookProgress {
  complete: number
  total: number
}

export interface UsePlaybookStateResult {
  steps: ComputedStep[]
  currentStepId: string | null
  progress: PlaybookProgress
  skipStep: (stepId: string) => void
  unskipStep: (stepId: string) => void
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function storageKey(jobId: string) {
  return `playbook_skipped_${jobId}`
}

function loadSkipped(jobId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey(jobId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function saveSkipped(jobId: string, skipped: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(jobId), JSON.stringify(Array.from(skipped)))
  } catch {
    // Silently ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePlaybookState(ctx: JobPlaybookContext): UsePlaybookStateResult {
  const jobId = ctx.job.id

  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => loadSkipped(jobId))

  // ── Skip / unskip ─────────────────────────────────────────────────────────

  const skipStep = useCallback((stepId: string) => {
    setSkippedIds(prev => {
      const next = new Set(prev).add(stepId)
      saveSkipped(jobId, next)
      return next
    })
  }, [jobId])

  const unskipStep = useCallback((stepId: string) => {
    setSkippedIds(prev => {
      const next = new Set(prev)
      next.delete(stepId)
      saveSkipped(jobId, next)
      return next
    })
  }, [jobId])

  // ── Resolve step statuses ─────────────────────────────────────────────────

  const { steps, currentStepId, progress } = useMemo(() => {
    // Filter to only visible steps
    const visible = playbookSteps.filter(step => step.isVisible(ctx))

    let foundCurrent = false

    const computed: ComputedStep[] = visible.map(step => {
      let status: PlaybookStepStatus

      if (skippedIds.has(step.id)) {
        status = 'skipped'
      } else if (step.isComplete(ctx)) {
        status = 'complete'
      } else if (!foundCurrent) {
        // First non-complete, non-skipped step becomes 'current'
        status = 'current'
        foundCurrent = true
      } else {
        status = 'upcoming'
      }

      return { ...step, status }
    })

    const completedCount = computed.filter(s => s.status === 'complete').length
    const currentStep = computed.find(s => s.status === 'current') ?? null

    return {
      steps: computed,
      currentStepId: currentStep?.id ?? null,
      progress: {
        complete: completedCount,
        total: computed.length,
      },
    }
  }, [ctx, skippedIds])

  return { steps, currentStepId, progress, skipStep, unskipStep }
}
