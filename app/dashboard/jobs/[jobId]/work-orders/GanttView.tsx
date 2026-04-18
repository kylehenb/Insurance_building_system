'use client'

import React, { useLayoutEffect, useRef } from 'react'
import { type WorkOrderWithDetails, getTradeColor } from './types'

export type GanttScale = 'day' | 'week' | 'month'

interface GanttConfig {
  cols:   string[]
  header: string
}

const GANTT_CONFIGS: Record<GanttScale, GanttConfig> = {
  day: {
    cols:   ['6am','7am','8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm'],
    header: 'Today',
  },
  week: {
    cols:   ['Mon','Tue','Wed','Thu','Fri','Mon','Tue','Wed','Thu','Fri'],
    header: 'Next 2 weeks',
  },
  month: {
    cols:   ['Wk 1','Wk 2','Wk 3','Wk 4','Wk 5','Wk 6','Wk 7','Wk 8'],
    header: 'Next 2 months',
  },
}

// Estimate bar position as fraction [0,1] based on sequence and scale
// In production this would use scheduled_date; here it positions by sequence
function estimateBarPos(
  wo: WorkOrderWithDetails,
  totalPlaced: number,
  scale: GanttScale
): { left: number; width: number; lagWidth: number; cushionWidth: number } {
  const visit = wo.visits[0]

  if (visit?.scheduled_date) {
    // Real positioning based on date (simplified)
    const now = Date.now()
    const start = new Date(visit.scheduled_date).getTime()
    const totalMs =
      scale === 'day'   ? 12 * 60 * 60 * 1000
      : scale === 'week' ? 10 * 24 * 60 * 60 * 1000
      :                     56 * 24 * 60 * 60 * 1000

    const offsetMs = start - now
    const left = Math.max(0, Math.min(0.9, offsetMs / totalMs))

    const hoursMs = (wo.estimated_hours ?? 4) * 60 * 60 * 1000
    const width   = Math.max(0.04, Math.min(0.6, hoursMs / totalMs))
    const lagDays = wo.lagDays
    const cushionDays = wo.cushionDays

    const dayMs = 24 * 60 * 60 * 1000
    const lagWidth     = (lagDays     * dayMs) / totalMs
    const cushionWidth = (cushionDays * dayMs) / totalMs

    return { left, width, lagWidth, cushionWidth }
  }

  // Estimated positioning based on sequence
  const seq = (wo.sequence_order ?? totalPlaced) - 1
  const slotW = 0.9 / Math.max(totalPlaced, 1)
  const left   = seq * slotW + 0.01
  const width  = Math.max(0.04, slotW * 0.65)
  const lagWidth     = wo.lagDays     > 0 ? slotW * 0.15 : 0
  const cushionWidth = wo.cushionDays > 0 ? slotW * 0.10 : 0

  return { left: Math.min(left, 0.9), width, lagWidth, cushionWidth }
}

export interface GanttViewProps {
  workOrders: WorkOrderWithDetails[]
  scale:      GanttScale
}

export function GanttView({ workOrders, scale }: GanttViewProps) {
  const placed = workOrders
    .filter(w => w.placementState !== 'unplaced')
    .sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999))

  const cfg     = GANTT_CONFIGS[scale]
  const bodyRef = useRef<HTMLDivElement>(null)
  const svgRef  = useRef<SVGSVGElement>(null)

  // ── SVG dependency connectors ────────────────────────────────────────────
  useLayoutEffect(() => {
    const body = bodyRef.current
    const svg  = svgRef.current
    if (!body || !svg) return

    const bRect = body.getBoundingClientRect()
    svg.setAttribute('width',  String(bRect.width))
    svg.setAttribute('height', String(bRect.height))

    const defs = `<defs>
      <marker id="arr-solid" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <polygon points="0,0 7,3.5 0,7" fill="#b0a89e"/>
      </marker>
      <marker id="arr-dash" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <polygon points="0,0 7,3.5 0,7" fill="#d4cdc4"/>
      </marker>
    </defs>`

    let paths = ''
    placed.forEach(wo => {
      if (!wo.predecessor_work_order_id) return
      const predWo = placed.find(p => p.id === wo.predecessor_work_order_id)
      if (!predWo) return

      const predBar = document.getElementById(`g-bar-${predWo.id}`)
      const thisBar = document.getElementById(`g-bar-${wo.id}`)
      if (!predBar || !thisBar) return

      const pR = predBar.getBoundingClientRect()
      const tR = thisBar.getBoundingClientRect()

      const x1 = pR.right  - bRect.left
      const y1 = pR.top    + pR.height / 2 - bRect.top
      const x2 = tR.left   - bRect.left - 6
      const y2 = tR.top    + tR.height / 2 - bRect.top
      const mx = Math.min(x1 + 28, x2 - 4)

      const isDash = wo.is_concurrent
      const stroke = isDash ? '#d4cdc4' : '#b0a89e'
      const dash   = isDash ? 'stroke-dasharray="5,3"' : ''
      const marker = isDash ? 'arr-dash' : 'arr-solid'

      paths += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"
        fill="none" stroke="${stroke}" stroke-width="1.5" ${dash}
        marker-end="url(#${marker})"/>`
    })

    svg.innerHTML = defs + paths
  })

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #ddd8d0',
          background: '#ede9e3',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}
      >
        <div
          style={{
            width: 170,
            minWidth: 170,
            padding: '6px 12px',
            fontSize: 9,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: '#9a9590',
            borderRight: '1px solid #ddd8d0',
          }}
        >
          {cfg.header}
        </div>
        <div style={{ flex: 1, display: 'flex' }}>
          {cfg.cols.map((col, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                fontSize: 9,
                fontWeight: 500,
                color: '#9a9590',
                padding: '6px 6px',
                borderRight: '1px solid #e8e4de',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                letterSpacing: '.03em',
              }}
            >
              {col}
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ position: 'relative', flex: 1 }}>
        {placed.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              fontSize: 12,
              color: '#9a9590',
            }}
          >
            No placed work orders to display
          </div>
        ) : (
          placed.map(wo => {
            const color = getTradeColor(wo.tradeTypeLabel)
            const sent  = wo.placementState === 'placed_sent' || wo.placementState === 'placed_complete'
            const pos   = estimateBarPos(wo, placed.length, scale)
            const isDashed = !wo.visits[0]?.scheduled_date

            return (
              <div
                key={wo.id}
                style={{
                  display: 'flex',
                  borderBottom: '1px solid #e8e4de',
                  minHeight: 50,
                  position: 'relative',
                }}
              >
                {/* Label column */}
                <div
                  style={{
                    width: 170,
                    minWidth: 170,
                    padding: '8px 12px',
                    borderRight: '1px solid #e8e4de',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 2,
                    background: '#fff',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '.09em',
                      color: '#9a9590',
                    }}
                  >
                    {wo.tradeTypeLabel || wo.work_type}
                  </div>
                  <div style={{ fontSize: 12, color: '#1a1a1a' }}>
                    {wo.trade?.business_name?.split(' ')[0] ?? '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(wo.total_visits ?? 1) > 1 && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 5px',
                          borderRadius: 3,
                          border: '1px solid #bfdbfe',
                          background: '#eff4ff',
                          color: '#1e40af',
                        }}
                      >
                        V{wo.current_visit}/{wo.total_visits}
                      </span>
                    )}
                    {wo.proximity_range === 'extended' && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 5px',
                          borderRadius: 3,
                          border: '1px solid #fca5a5',
                          background: '#fff0f0',
                          color: '#991b1b',
                        }}
                      >
                        Ext
                      </span>
                    )}
                  </div>
                </div>

                {/* Track */}
                <div
                  style={{
                    flex: 1,
                    position: 'relative',
                    background: '#fff',
                  }}
                >
                  {/* Grid lines */}
                  {cfg.cols.map((_, i) =>
                    i < cfg.cols.length - 1 ? (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${((i + 1) / cfg.cols.length) * 100}%`,
                          width: 1,
                          background: '#e8e4de',
                          pointerEvents: 'none',
                        }}
                      />
                    ) : null
                  )}

                  {/* Lag block */}
                  {pos.lagWidth > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: `${(pos.left + pos.width) * 100}%`,
                        width: `${pos.lagWidth * 100}%`,
                        height: 28,
                        borderRadius: '0 5px 5px 0',
                        pointerEvents: 'none',
                        background: `repeating-linear-gradient(
                          -45deg, transparent, transparent 3px,
                          rgba(146,64,14,.12) 3px, rgba(146,64,14,.12) 6px
                        )`,
                        border: '1px dashed #f0c080',
                      }}
                    />
                  )}

                  {/* Cushion block */}
                  {pos.cushionWidth > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 14,
                        left: `${(pos.left + pos.width + pos.lagWidth) * 100}%`,
                        width: `${pos.cushionWidth * 100}%`,
                        height: 20,
                        borderRadius: '0 3px 3px 0',
                        opacity: 0.12,
                        pointerEvents: 'none',
                        background: color,
                      }}
                    />
                  )}

                  {/* Bar */}
                  <div
                    id={`g-bar-${wo.id}`}
                    style={{
                      position: 'absolute',
                      top: 10,
                      left: `${pos.left * 100}%`,
                      width: `${pos.width * 100}%`,
                      height: 28,
                      borderRadius: 5,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 9px',
                      fontSize: 10,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      cursor: sent ? 'default' : 'grab',
                      background: `${color}${sent ? '30' : '18'}`,
                      border: isDashed ? `1px dashed ${color}` : `1px solid ${color}`,
                      color: color,
                      opacity: wo.placementState === 'placed_complete' ? 0.65 : 1,
                    }}
                  >
                    {sent ? '🔒 ' : ''}{wo.tradeTypeLabel || wo.work_type}
                    {!sent && (
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: 7,
                          borderRadius: '0 5px 5px 0',
                          background: 'rgba(0,0,0,.08)',
                          cursor: 'ew-resize',
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* SVG dependency connectors */}
        <svg
          ref={svgRef}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 3,
            overflow: 'visible',
          }}
        />
      </div>
    </div>
  )
}
