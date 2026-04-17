import { createClient } from '@/lib/supabase/server'
import { fetchJobContext } from '@/lib/jobs/fetchJobContext'
import { getJobStage } from '@/lib/jobs/getJobStage'
import type { JobStage } from '@/lib/jobs/getJobStage'
import type { OpenLoop } from '@/lib/jobs/openLoops'

// Border colour is driven by stage state — custom hex values require inline styles
function getBorderColor(stage: JobStage): string {
  if (stage.key === 'on_hold' || stage.key === 'cancelled') return '#9e998f'
  if (stage.isWaiting) return '#e0dbd4'
  if (stage.isBranch) return '#f59e0b'
  return '#c9a96e'
}

type LoopChipProps = { loop: OpenLoop }

function LoopChip({ loop }: LoopChipProps) {
  const isUrgent = loop.urgency === 'urgent'
  return (
    // TODO: wire onClick when extracted to a client component — console.log('open loop clicked:', loop.type)
    <button
      type="button"
      style={{
        backgroundColor: isUrgent ? '#fee2e2' : '#fef9ee',
        color: isUrgent ? '#991b1b' : '#92400e',
        border: `1px solid ${isUrgent ? '#fca5a5' : '#f59e0b'}`,
        fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
        fontSize: 11,
        fontWeight: 500,
      }}
      className="rounded-full px-2 py-0.5 whitespace-nowrap"
    >
      {loop.label}
    </button>
  )
}

type StageBannerProps = { jobId: string }

export default async function StageBanner({ jobId }: StageBannerProps) {
  const supabase = await createClient()
  const context = await fetchJobContext(jobId, supabase)
  const stage = getJobStage(context)

  const borderColor = getBorderColor(stage)
  const isTerminal = stage.key === 'on_hold' || stage.key === 'cancelled'
  const labelColor = stage.isWaiting ? '#9e998f' : '#1a1a1a'
  const labelPrefix = stage.isWaiting ? 'Waiting — ' : ''

  return (
    <div
      style={{
        borderLeft: `4px solid ${borderColor}`,
        fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
      }}
      className="w-full bg-white flex items-center gap-3 px-5 py-3"
    >
      {/* Stage label */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: labelColor,
        }}
      >
        {labelPrefix}{stage.label}
      </span>

      {/* Separator + description */}
      <span
        style={{
          fontSize: 12,
          color: '#9e998f',
        }}
      >
        · {stage.description}
      </span>

      {/* Contextual warning chip */}
      {stage.contextualWarning && (
        <span
          style={{
            backgroundColor: '#fef3c7',
            color: '#92400e',
            border: '1px solid #f59e0b',
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
            marginLeft: 4,
          }}
          className="rounded-full px-2 py-0.5 whitespace-nowrap"
        >
          ⚠ {stage.contextualWarning.message}
        </span>
      )}

      {/* Open loop chips */}
      {!isTerminal && stage.openLoops.length > 0 && (
        <>
          {stage.openLoops.map((loop) => (
            <LoopChip key={loop.type} loop={loop} />
          ))}
        </>
      )}

      {/* Push primary action to the right */}
      {!isTerminal && <span className="flex-1" />}

      {/* Primary action button */}
      {!isTerminal && stage.primaryAction && (
        // TODO: wire onClick when extracted to a client component — console.log('primary action:', stage.primaryAction.actionKey)
        <button
          type="button"
          style={{
            backgroundColor: '#1a1a1a',
            color: 'white',
            fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
            fontSize: 13,
            fontWeight: 500,
          }}
          className="px-4 py-2 rounded-md hover:bg-[#3a3530] transition-colors whitespace-nowrap"
        >
          {stage.primaryAction.label}
        </button>
      )}
    </div>
  )
}
