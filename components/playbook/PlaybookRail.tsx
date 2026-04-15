'use client'

/**
 * PlaybookRail
 *
 * A vertical workflow rail that guides users through every stage of a job
 * from lodgement to close. Sits on the Overview tab between the Job Details
 * accordion and the To Do section.
 *
 * Collapsed: shows current step card + progress indicator + "View all steps" toggle.
 * Expanded:  shows full step list — complete (tick), current (expanded card),
 *            upcoming (grey), skipped (dash with undo link).
 */

import React, { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { usePlaybookState, type ComputedStep } from '@/lib/hooks/usePlaybookState'
import type { JobPlaybookContext, PlaybookAction } from '@/lib/playbook/steps'

// ── Props ─────────────────────────────────────────────────────────────────────

interface PlaybookRailProps {
  ctx: JobPlaybookContext
  /** Called when an inline action is triggered (e.g. close job confirmation) */
  onInlineAction?: (target: string) => void
}

// ── Category labels ───────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  lodge: 'Lodgement',
  inspect: 'Inspection',
  report: 'Report',
  send: 'Submission',
  approval: 'Approval',
  contract: 'Contract',
  repairs: 'Repairs',
  invoice: 'Invoice',
  close: 'Close',
}

// ── SVG icons (no emoji, no external deps) ───────────────────────────────────

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" fill="#2a6b50" />
      <path d="M4 7l2.2 2.3L10 5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconCurrent() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" fill="#c9a96e" />
      <circle cx="7" cy="7" r="2.5" fill="#fff" />
    </svg>
  )
}

function IconUpcoming() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" stroke="#d4cfc8" strokeWidth="1" />
    </svg>
  )
}

function IconSkipped() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" stroke="#d4cfc8" strokeWidth="1" strokeDasharray="3 2" />
      <path d="M4.5 7h5" stroke="#b0a898" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
    >
      <path d="M3 5l4 4 4-4" stroke="#9e998f" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Connector line between steps ──────────────────────────────────────────────

function StepConnector({ complete }: { complete: boolean }) {
  return (
    <div
      style={{
        width: 1,
        height: 14,
        marginLeft: 6.5,
        background: complete ? '#2a6b50' : '#e4dfd8',
        flexShrink: 0,
      }}
    />
  )
}

// ── Action handler hook ───────────────────────────────────────────────────────

function useActionHandler(onInlineAction?: (target: string) => void) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return function handleAction(action: PlaybookAction) {
    if (action.type === 'navigate' && action.target) {
      const params = new URLSearchParams(searchParams.toString())
      // Map friendly target names to actual tab IDs
      const tabMap: Record<string, string> = {
        comms: 'overview', // Comms is on overview for now; navigate to the comms section
        calendar: 'overview',
        inspections: 'inspections',
        reports: 'reports',
        quotes: 'quotes',
        'trade-work-orders': 'trade-work-orders',
        photos: 'photos',
        files: 'files',
        invoices: 'invoices',
      }
      const tabId = tabMap[action.target] ?? action.target
      params.set('tab', tabId)
      router.push(`${pathname}?${params.toString()}`)
    } else if (action.type === 'inline' && action.target && onInlineAction) {
      onInlineAction(action.target)
    }
    // compose and generate are handled by future dedicated components — no-op for now
  }
}

// ── Sub-task checklist ────────────────────────────────────────────────────────

function SubTaskList({
  step,
  ctx,
  onAction,
}: {
  step: ComputedStep
  ctx: JobPlaybookContext
  onAction: (action: PlaybookAction) => void
}) {
  if (!step.subTasks?.length) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {step.subTasks.map(task => {
        const done = task.isComplete(ctx)
        return (
          <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              {done ? <IconCheck /> : <IconUpcoming />}
            </div>
            <span
              style={{
                fontSize: 12,
                color: done ? '#9e998f' : '#3a3530',
                textDecoration: done ? 'line-through' : 'none',
                flex: 1,
              }}
            >
              {task.label}
            </span>
            {!done && task.action && (
              <button
                onClick={() => task.action && onAction(task.action)}
                style={{
                  fontSize: 11,
                  color: '#c9a96e',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {task.action.label} →
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Current step expanded card ────────────────────────────────────────────────

function CurrentStepCard({
  step,
  ctx,
  onAction,
  onSkip,
}: {
  step: ComputedStep
  ctx: JobPlaybookContext
  onAction: (action: PlaybookAction) => void
  onSkip: () => void
}) {
  const [skipConfirm, setSkipConfirm] = useState(false)

  // "awaiting_response" step uses a subtle link rather than a full button
  const isPassiveStep = step.id === 'awaiting_response'

  return (
    <div
      style={{
        background: '#fff',
        border: '0.5px solid #e4dfd8',
        borderRadius: 8,
        padding: '14px 16px',
        marginLeft: 22,
      }}
    >
      {/* Step label */}
      <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', marginBottom: 4 }}>
        {step.label}
      </div>

      {/* Description */}
      <div style={{ fontSize: 12, color: '#9e998f', lineHeight: 1.55, marginBottom: 10 }}>
        {step.description}
      </div>

      {/* Sub-tasks */}
      {step.subTasks && step.subTasks.length > 0 && (
        <SubTaskList step={step} ctx={ctx} onAction={onAction} />
      )}

      {/* Primary action */}
      {step.primaryAction && (
        <div style={{ marginTop: step.subTasks?.length ? 12 : 0 }}>
          {isPassiveStep ? (
            <button
              onClick={() => step.primaryAction && onAction(step.primaryAction)}
              style={{
                fontSize: 11,
                color: '#9e998f',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {step.primaryAction.label} →
            </button>
          ) : (
            <button
              onClick={() => step.primaryAction && onAction(step.primaryAction)}
              style={{
                width: '100%',
                padding: '9px 16px',
                background: '#c9a96e',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#b8955a' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#c9a96e' }}
            >
              {step.primaryAction.label}
            </button>
          )}
        </div>
      )}

      {/* Skip */}
      {step.skipAllowed && (
        <div style={{ marginTop: 10 }}>
          {skipConfirm ? (
            <span style={{ fontSize: 11, color: '#9e998f' }}>
              Skip &ldquo;{step.label}&rdquo;?{' '}
              <button
                onClick={() => { setSkipConfirm(false); onSkip() }}
                style={{ fontSize: 11, color: '#d4524a', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Confirm
              </button>
              {' / '}
              <button
                onClick={() => setSkipConfirm(false)}
                style={{ fontSize: 11, color: '#9e998f', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setSkipConfirm(true)}
              style={{
                fontSize: 11,
                color: '#b0a898',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Skip this step
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Complete step row (collapsed, expandable) ─────────────────────────────────

function CompleteStepRow({ step, expanded, onToggle }: {
  step: ComputedStep
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <div style={{ flexShrink: 0 }}><IconCheck /></div>
        <span style={{ fontSize: 12, color: '#9e998f', flex: 1 }}>{step.label}</span>
        <IconChevron open={expanded} />
      </button>
      {expanded && (
        <div
          style={{
            marginLeft: 24,
            marginTop: 6,
            padding: '10px 14px',
            background: '#faf9f7',
            border: '0.5px solid #e4dfd8',
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 12, color: '#9e998f', marginBottom: 4 }}>{step.description}</div>
          <div style={{ fontSize: 11, color: '#2a6b50' }}>✓ Completed</div>
        </div>
      )}
    </>
  )
}

// ── Upcoming step row ─────────────────────────────────────────────────────────

function UpcomingStepRow({ step }: { step: ComputedStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flexShrink: 0 }}><IconUpcoming /></div>
      <span style={{ fontSize: 12, color: '#c8c0b8' }}>{step.label}</span>
    </div>
  )
}

// ── Skipped step row ──────────────────────────────────────────────────────────

function SkippedStepRow({ step, onUnskip }: { step: ComputedStep; onUnskip: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flexShrink: 0 }}><IconSkipped /></div>
      <span style={{ fontSize: 12, color: '#b0a898', fontStyle: 'italic', flex: 1 }}>
        {step.label}
      </span>
      <button
        onClick={onUnskip}
        style={{
          fontSize: 10,
          color: '#c9a96e',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        Undo skip
      </button>
    </div>
  )
}

// ── Category divider ──────────────────────────────────────────────────────────

function CategoryDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 24,
        marginBottom: 2,
        marginTop: 4,
      }}
    >
      <span
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.09em',
          color: '#c8b89a',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#f0ece6' }} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlaybookRail({ ctx, onInlineAction }: PlaybookRailProps) {
  const { steps, currentStepId, progress, skipStep, unskipStep } = usePlaybookState(ctx)
  const [expanded, setExpanded] = useState(false)
  const [expandedCompleteId, setExpandedCompleteId] = useState<string | null>(null)

  const handleAction = useActionHandler(onInlineAction)

  const currentStep = steps.find(s => s.id === currentStepId) ?? null
  const currentIndex = steps.findIndex(s => s.id === currentStepId)
  const percentComplete = progress.total > 0
    ? Math.round((progress.complete / progress.total) * 100)
    : 0

  // Group consecutive steps by category for dividers
  let lastRenderedCategory: string | null = null

  return (
    <div
      style={{
        background: '#fff',
        border: '0.5px solid #e4dfd8',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: '13px 16px 12px',
          borderBottom: '0.5px solid #f0ece6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: '#9e998f',
              fontWeight: 500,
            }}
          >
            Job Playbook
          </span>
          {currentStep && (
            <span style={{ fontSize: 11, color: '#b0a898' }}>
              Step {currentIndex + 1} of {progress.total}
              {' · '}
              <span style={{ color: '#3a3530', fontWeight: 500 }}>{currentStep.label}</span>
            </span>
          )}
          {!currentStep && progress.complete === progress.total && (
            <span style={{ fontSize: 11, color: '#2a6b50', fontWeight: 500 }}>All steps complete</span>
          )}
        </div>

        <span style={{ fontSize: 11, color: '#9e998f' }}>
          {progress.complete}/{progress.total} done
        </span>
      </div>

      {/* ── Progress bar ────────────────────────────────────────── */}
      <div style={{ height: 3, background: '#f5f2ee' }}>
        <div
          style={{
            height: '100%',
            width: `${percentComplete}%`,
            background: '#c9a96e',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 16px 14px' }}>

        {/* COLLAPSED: show only current step */}
        {!expanded && currentStep && (
          <>
            <CurrentStepCard
              step={currentStep}
              ctx={ctx}
              onAction={handleAction}
              onSkip={() => skipStep(currentStep.id)}
            />
          </>
        )}

        {/* COLLAPSED: all complete */}
        {!expanded && !currentStep && (
          <div style={{ fontSize: 13, color: '#2a6b50', fontWeight: 500, textAlign: 'center', padding: '8px 0' }}>
            Job playbook complete ✓
          </div>
        )}

        {/* EXPANDED: full step list */}
        {expanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1
              const showDivider = step.category !== lastRenderedCategory
              lastRenderedCategory = step.category

              const connector = !isLast ? (
                <StepConnector complete={step.status === 'complete'} />
              ) : null

              return (
                <React.Fragment key={step.id}>
                  {showDivider && (
                    <CategoryDivider label={CATEGORY_LABELS[step.category] ?? step.category} />
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 0 }}>
                    {step.status === 'complete' && (
                      <CompleteStepRow
                        step={step}
                        expanded={expandedCompleteId === step.id}
                        onToggle={() =>
                          setExpandedCompleteId(prev => prev === step.id ? null : step.id)
                        }
                      />
                    )}

                    {step.status === 'current' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <div style={{ flexShrink: 0 }}><IconCurrent /></div>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
                            {step.label}
                          </span>
                        </div>
                        <CurrentStepCard
                          step={step}
                          ctx={ctx}
                          onAction={handleAction}
                          onSkip={() => skipStep(step.id)}
                        />
                      </div>
                    )}

                    {step.status === 'upcoming' && <UpcomingStepRow step={step} />}

                    {step.status === 'skipped' && (
                      <SkippedStepRow step={step} onUnskip={() => unskipStep(step.id)} />
                    )}

                    {connector && (
                      <div style={{ paddingLeft: 0 }}>
                        {connector}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        )}

        {/* ── Expand / collapse toggle ─────────────────────────── */}
        <div style={{ marginTop: expanded ? 16 : 12, textAlign: 'center' }}>
          <button
            onClick={() => setExpanded(prev => !prev)}
            style={{
              fontSize: 11,
              color: '#c9a96e',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {expanded ? '← Hide steps' : `View all steps (${progress.total}) →`}
          </button>
        </div>
      </div>
    </div>
  )
}
