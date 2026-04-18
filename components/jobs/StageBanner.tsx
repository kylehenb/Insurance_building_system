import { createClient } from '@/lib/supabase/server'
import { STAGE_CONFIG } from '@/lib/jobs/stageConfig'
import type { JobStageKey } from '@/lib/jobs/getJobStage'
import type { OpenLoop } from '@/lib/jobs/openLoops'

// These columns are added by migration and not yet in database.types.ts
type JobStageRow = {
  current_stage: string | null
  current_stage_updated_at: string | null
  override_stage: 'on_hold' | 'cancelled' | null
}

function getBorderColor(stageKey: JobStageKey): string {
  if (stageKey === 'on_hold') return '#f59e0b'
  if (stageKey === 'cancelled') return '#9e998f'
  return '#c9a96e'
}

function getSectionLabelColor(stageKey: JobStageKey): string {
  if (stageKey === 'on_hold') return '#b45309'
  if (stageKey === 'cancelled') return '#9e998f'
  return '#a07840'
}

function getStageNameColor(stageKey: JobStageKey): string {
  if (stageKey === 'on_hold') return '#92400e'
  if (stageKey === 'cancelled') return '#6a6460'
  return '#1a1a1a'
}

function getStageDescriptionColor(stageKey: JobStageKey): string {
  if (stageKey === 'on_hold') return '#a07840'
  if (stageKey === 'cancelled') return '#9e998f'
  return '#9e8060'
}

function getSectionBorderBottom(stageKey: JobStageKey): string {
  if (stageKey === 'on_hold') return '#f0d58c'
  if (stageKey === 'cancelled') return '#e0dbd4'
  return '#e8dfc8'
}

function getLoopLabelColor(stageKey: JobStageKey): string {
  if (stageKey === 'on_hold') return '#b45309'
  return '#a07840'
}

type StageBannerProps = { jobId: string }

export default async function StageBanner({ jobId }: StageBannerProps) {
  const supabase = await createClient()

  const { data: raw } = await supabase
    .from('jobs')
    .select('current_stage, current_stage_updated_at, override_stage')
    .eq('id', jobId)
    .single()

  const row = raw as unknown as JobStageRow | null

  // Loading state: job not yet computed
  if (row === null || row.current_stage === null) {
    const borderColor = getBorderColor('order_received')
    const sectionLabelColor = getSectionLabelColor('order_received')
    const sectionBorderBottom = getSectionBorderBottom('order_received')

    return (
      <div
        style={{
          width: 365.0625,
          minWidth: 365.0625,
          borderLeft: `3px solid ${borderColor}`,
          backgroundColor: '#f5f0e8',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            padding: '13px 16px 11px',
            borderBottom: `1px solid ${sectionBorderBottom}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: sectionLabelColor,
              marginBottom: 5,
            }}
          >
            Current Stage
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 500,
              color: '#1a1a1a',
              marginBottom: 4,
              letterSpacing: '-0.2px',
            }}
          >
            —
          </div>
        </div>
      </div>
    )
  }

  // Resolve effective stage key: override_stage takes precedence
  const effectiveKey: JobStageKey =
    row.override_stage === 'on_hold'
      ? 'on_hold'
      : row.override_stage === 'cancelled'
        ? 'cancelled'
        : row.current_stage in STAGE_CONFIG
          ? (row.current_stage as JobStageKey)
          : 'order_received'

  const config = STAGE_CONFIG[effectiveKey]

  // Open loops are not yet populated from the database
  const openLoops: OpenLoop[] = []

  const borderColor = getBorderColor(effectiveKey)
  const sectionLabelColor = getSectionLabelColor(effectiveKey)
  const stageNameColor = getStageNameColor(effectiveKey)
  const stageDescriptionColor = getStageDescriptionColor(effectiveKey)
  const sectionBorderBottom = getSectionBorderBottom(effectiveKey)
  const loopLabelColor = getLoopLabelColor(effectiveKey)
  const isOnHold = effectiveKey === 'on_hold'
  const isCancelled = effectiveKey === 'cancelled'

  return (
    <div
      style={{
        width: 365.0625,
        minWidth: 365.0625,
        borderLeft: `3px solid ${borderColor}`,
        backgroundColor: '#f5f0e8',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'inherit',
      }}
    >
      {/* Section 1 — Stage */}
      <div
        style={{
          padding: '13px 16px 11px',
          borderBottom: `1px solid ${sectionBorderBottom}`,
        }}
      >
        {/* Section label */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: sectionLabelColor,
            marginBottom: 5,
          }}
        >
          Current Stage
        </div>

        {/* Stage name and action button row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {/* Stage name and description column */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 500,
                color: stageNameColor,
                marginBottom: 4,
                letterSpacing: '-0.2px',
              }}
            >
              {config.label}
            </div>
            <div
              style={{
                fontSize: 12,
                color: stageDescriptionColor,
                lineHeight: 1.3,
              }}
            >
              {config.description}
            </div>
          </div>

          {/* Action button or waiting pill */}
          {isOnHold && config.primaryAction ? (
            <button
              type="button"
              style={{
                backgroundColor: 'transparent',
                color: '#c9a96e',
                border: '1px solid #c9a96e',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                fontFamily: 'inherit',
              }}
            >
              Resume Job
            </button>
          ) : config.isWaiting ? (
            <div
              style={{
                backgroundColor: '#ece6d8',
                borderRadius: 4,
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  backgroundColor: '#c9b898',
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: '#9e8060',
                  fontWeight: 500,
                }}
              >
                Waiting
              </span>
            </div>
          ) : config.primaryAction && !isCancelled ? (
            <button
              type="button"
              style={{
                backgroundColor: '#1a1a1a',
                color: '#c9a96e',
                border: 'none',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                fontFamily: 'inherit',
              }}
            >
              {config.primaryAction.label}
            </button>
          ) : null}
        </div>
      </div>

      {/* Section 2 — Open Loops */}
      {isCancelled ? (
        <div
          style={{
            padding: '10px 16px 14px',
            fontSize: 13,
            color: '#b0a898',
            fontStyle: 'italic',
          }}
        >
          Job cancelled
        </div>
      ) : (
        <div
          style={{
            padding: '10px 16px 14px',
            flex: 1,
          }}
        >
          {/* Section header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              marginBottom: 7,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: loopLabelColor,
              }}
            >
              Open Loops
            </div>
            <div
              style={{
                backgroundColor: openLoops.length > 0 ? '#ef4444' : '#e0d8c8',
                color: openLoops.length > 0 ? 'white' : '#9e8060',
                borderRadius: 10,
                padding: '1px 6px',
                fontSize: 9,
                fontWeight: 600,
              }}
            >
              {openLoops.length}
            </div>
          </div>

          {/* Loop rows */}
          {openLoops.length === 0 ? (
            <div
              style={{
                fontSize: 11,
                color: '#b0a890',
                fontStyle: 'italic',
              }}
            >
              No open items
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {openLoops.slice(0, 3).map((loop) => {
                const isUrgent = loop.urgency === 'urgent'
                return (
                  <div
                    key={loop.type}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 9px',
                      backgroundColor: 'white',
                      borderRadius: 4,
                      border: isUrgent ? '0.5px solid #fca5a5' : '0.5px solid #e8dfc8',
                      borderLeft: isUrgent ? '2px solid #ef4444' : '2px solid #c9a96e',
                    }}
                  >
                    <div
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        backgroundColor: isUrgent ? '#ef4444' : '#c9a96e',
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: isUrgent ? '#7f1d1d' : '#4a3820',
                        fontWeight: 500,
                        flex: 1,
                      }}
                    >
                      {loop.label}
                    </div>
                    {isUrgent && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#ef4444',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Urgent
                      </div>
                    )}
                  </div>
                )
              })}
              {openLoops.length > 3 && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#9e8060',
                    padding: '4px 2px',
                  }}
                >
                  + {openLoops.length - 3} more{' '}
                  <span
                    style={{
                      color: '#6a5a40',
                      fontWeight: 500,
                      borderBottom: '1px solid #c9a96e4a',
                      cursor: 'pointer',
                    }}
                  >
                    view all
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
