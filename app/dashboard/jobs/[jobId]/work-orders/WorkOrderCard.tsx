'use client'

import React, { useCallback, useRef, useState } from 'react'
import {
  type WorkOrderWithDetails,
  type WorkOrderRow,
  type WorkOrderVisitRow,
  type TradeRow,
  getTradeColor,
  garyLabel,
  aud,
  woIsSent,
} from './types'

// ─── CSS shared across card variants (injected once via WorkOrdersTab) ────────
export const CARD_CSS = `
  .wo-field-input {
    font-size: 12px;
    font-family: 'DM Mono', monospace;
    color: #1a1a1a;
    border: none;
    border-bottom: 1px solid #ddd8d0;
    background: transparent;
    outline: none;
    padding: 0 0 1px;
    transition: border-color .15s;
  }
  .wo-field-input:focus { border-bottom-color: #c9a96e; }
  .wo-field-input:disabled { color: #9a9590; border-bottom-color: transparent; }
  .wo-field-input::placeholder { color: #9a9590; }
  .wo-select {
    font-size: 12px;
    font-family: 'DM Sans', sans-serif;
    border: none;
    background: transparent;
    color: #1a1a1a;
    cursor: pointer;
    padding: 0;
    width: 100%;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a89e' stroke-width='1.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 2px center;
    padding-right: 16px;
    outline: none;
  }
  .wo-select:disabled { cursor: default; opacity: .7; }
  .wo-dep-select {
    font-size: 11px;
    font-family: 'DM Sans', sans-serif;
    border: 1px solid #ddd8d0;
    border-radius: 4px;
    background: #ede9e3;
    color: #5a5650;
    padding: 2px 7px;
    cursor: pointer;
    outline: none;
  }
`

const GARY_BADGE_STYLE: Record<string, { color: string; bg: string }> = {
  not_started:          { color: '#9a9590', bg: '#f5f2ee' },
  waiting_on_dependent: { color: '#92400e', bg: '#fef3e2' },
  waiting_reply:        { color: '#1e40af', bg: '#eff4ff' },
  booking_proposed:     { color: '#92400e', bg: '#fef3e2' },
  confirmed:            { color: '#2d6a4f', bg: '#eaf4ef' },
  return_visit_pending: { color: '#92400e', bg: '#fef3e2' },
  complete:             { color: '#475569', bg: '#f1f5f9' },
}

function GaryBadge({ state }: { state: string | null }) {
  const s = state ?? 'not_started'
  const style = GARY_BADGE_STYLE[s] ?? GARY_BADGE_STYLE.not_started
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        whiteSpace: 'nowrap',
        fontWeight: 500,
        color: style.color,
        background: style.bg,
      }}
    >
      {garyLabel(state)}
    </span>
  )
}

function FieldGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '.07em',
          color: '#9a9590',
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function FieldDivider() {
  return (
    <div
      style={{
        width: 1,
        height: 32,
        background: '#e8e4de',
        alignSelf: 'center',
        flexShrink: 0,
      }}
    />
  )
}

// ─── CtxMenu ──────────────────────────────────────────────────────────────────
function CtxMenu({
  items,
}: {
  items: { label: string; onClick: () => void; danger?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          padding: '3px 7px',
          fontSize: 12,
          border: '1px solid #ddd8d0',
          borderRadius: 5,
          background: 'transparent',
          cursor: 'pointer',
          color: '#9a9590',
          letterSpacing: '.05em',
          lineHeight: 1,
        }}
      >
        •••
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            background: '#fff',
            border: '1px solid #ddd8d0',
            borderRadius: 8,
            minWidth: 165,
            zIndex: 80,
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,.1)',
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); item.onClick() }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '7px 13px',
                fontSize: 12,
                cursor: 'pointer',
                color: item.danger ? '#991b1b' : '#1a1a1a',
                background: 'transparent',
                border: 'none',
                fontFamily: 'DM Sans, sans-serif',
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = '#f5f2ee' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Expanded detail section (shared between placed-expanded and unplaced) ────
function CardDetail({
  wo,
  locked,
  allTrades,
  allPlaced,
  onUpdate,
  onSetPredecessor,
  showDependency,
}: {
  wo: WorkOrderWithDetails
  locked: boolean
  allTrades: TradeRow[]
  allPlaced: WorkOrderWithDetails[]
  onUpdate: (u: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string }) => void
  onSetPredecessor: (predId: string | null) => void
  showDependency: boolean
}) {
  // Debounce
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function debounce(fn: () => void) {
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(fn, 800)
  }

  // Trades filtered by trade type
  const filteredTrades = allTrades.filter(
    t => !wo.tradeTypeLabel || t.primary_trade === wo.tradeTypeLabel
  )
  if (filteredTrades.length === 0) {
    allTrades.forEach(t => { if (!filteredTrades.includes(t)) filteredTrades.push(t) })
  }

  const quotedAmount = wo.quotedAllowance > 0 ? aud.format(wo.quotedAllowance) : '—'

  // predecessor options
  const predOptions = allPlaced.filter(p => p.id !== wo.id)

  return (
    <div
      style={{
        padding: '10px 12px 10px 28px',
        background: '#f5f2ee',
        borderTop: '1px solid #e8e4de',
      }}
    >
      {/* Field row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FieldGroup label="Contractor">
          <select
            className="wo-select"
            disabled={locked}
            defaultValue={wo.trade_id ?? ''}
            onChange={e => onUpdate({ trade_id: e.target.value || null })}
            style={{ maxWidth: 180 }}
          >
            <option value="">— Select contractor —</option>
            {filteredTrades.map(t => (
              <option key={t.id} value={t.id}>
                {t.business_name}
              </option>
            ))}
          </select>
        </FieldGroup>

        <FieldDivider />

        <FieldGroup label="Hours est.">
          <input
            className="wo-field-input"
            type="number"
            defaultValue={wo.estimated_hours ?? ''}
            disabled={locked}
            placeholder="—"
            style={{ width: 50 }}
            onChange={e => {
              const v = parseFloat(e.target.value)
              debounce(() => onUpdate({ estimated_hours: isNaN(v) ? null : v }))
            }}
          />
        </FieldGroup>

        <FieldDivider />

        <FieldGroup label="Cushion">
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              className="wo-field-input"
              type="number"
              defaultValue={wo.cushionDays}
              style={{ width: 30 }}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                debounce(() => onUpdate({ cushionDays: isNaN(v) ? 1 : v }))
              }}
            />
            <span style={{ fontSize: 10, color: '#9a9590' }}>d</span>
          </div>
        </FieldGroup>

        <FieldDivider />

        <FieldGroup label="Lag">
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              className="wo-field-input"
              type="number"
              defaultValue={wo.lagDays}
              style={{ width: 30 }}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                debounce(() => onUpdate({ lagDays: isNaN(v) ? 0 : v }))
              }}
            />
            <span style={{ fontSize: 10, color: '#9a9590' }}>
              d{wo.lagDescription ? ` · ${wo.lagDescription}` : ''}
            </span>
          </div>
        </FieldGroup>

        <FieldDivider />

        <FieldGroup label="Quoted">
          <div
            style={{
              fontSize: 12,
              fontFamily: 'DM Mono, monospace',
              color: '#1a1a1a',
            }}
          >
            {quotedAmount}
          </div>
        </FieldGroup>

        <FieldDivider />

        <FieldGroup label="Override">
          <input
            className="wo-field-input"
            type="number"
            defaultValue={wo.agreed_amount ?? ''}
            disabled={locked}
            placeholder="—"
            style={{ width: 64 }}
            onChange={e => {
              const v = parseFloat(e.target.value)
              debounce(() => onUpdate({ agreed_amount: isNaN(v) ? null : v }))
            }}
          />
        </FieldGroup>

        <FieldDivider />

        <FieldGroup label="Trade cost">
          <input
            className="wo-field-input"
            type="number"
            defaultValue={wo.trade_cost ?? ''}
            placeholder="—"
            style={{ width: 64 }}
            onChange={e => {
              const v = parseFloat(e.target.value)
              debounce(() => onUpdate({ trade_cost: isNaN(v) ? null : v }))
            }}
          />
        </FieldGroup>
      </div>

      {/* Dependency row (placed only) */}
      {showDependency && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            fontSize: 11,
            color: '#9a9590',
          }}
        >
          <span style={{ fontSize: 10 }}>After:</span>
          <select
            className="wo-dep-select"
            value={wo.predecessor_work_order_id ?? ''}
            onChange={e =>
              onSetPredecessor(e.target.value || null)
            }
          >
            <option value="">None</option>
            {predOptions.map(p => (
              <option key={p.id} value={p.id}>
                {p.tradeTypeLabel || p.work_type || 'Work order'} ·{' '}
                {p.trade?.business_name?.split(' ')[0] ?? '?'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Line items */}
      {wo.scopeItems.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid #e8e4de', paddingTop: 8 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              color: '#9a9590',
              marginBottom: 5,
            }}
          >
            Line items
          </div>
          {wo.scopeItems.map(si => (
            <div
              key={si.id}
              style={{
                display: 'flex',
                gap: 8,
                padding: '3px 0',
                borderBottom: '1px solid #e8e4de',
                fontSize: 11,
                color: '#5a5650',
              }}
            >
              <span style={{ flex: 1 }}>{si.item_description ?? '—'}</span>
              <span
                style={{
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 10,
                  color: '#9a9590',
                }}
              >
                {si.qty} {si.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export interface WorkOrderCardProps {
  wo:               WorkOrderWithDetails
  isExpanded:       boolean
  onToggleExpand:   () => void
  onPlace:          () => void
  onUnplace:        () => void
  onSendOne:        () => void
  onCancel:         () => void
  onUpdate:         (u: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string }) => void
  onAddVisit:       () => void
  onSetPredecessor: (predId: string | null) => void
  trades:           TradeRow[]
  allPlacedOrders:  WorkOrderWithDetails[]
  onDragStart:      (e: React.DragEvent<HTMLDivElement>) => void
  onDragEnd:        () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  visitNumber?:     number // If rendering as a visit card
  visit?:           WorkOrderVisitRow // The visit data if rendering as a visit card
}

export function WorkOrderCard({
  wo,
  isExpanded,
  onToggleExpand,
  onPlace,
  onUnplace,
  onSendOne,
  onCancel,
  onUpdate,
  onAddVisit,
  onSetPredecessor,
  trades,
  allPlacedOrders,
  onDragStart,
  onDragEnd,
  dragHandleProps,
  visitNumber,
  visit,
}: WorkOrderCardProps) {
  const isPlacedWo  = wo.placementState !== 'unplaced'
  const sent        = woIsSent(wo)
  const complete    = wo.placementState === 'placed_complete'
  const locked      = sent
  const color       = getTradeColor(wo.tradeTypeLabel)

  // Card state class
  const cardBorderLeft =
    complete ? '3px solid #2d6a4f'
    : sent   ? '3px solid #c9a96e'
    :           undefined

  const cardBg    = complete ? '#eaf4ef' : '#ffffff'
  const cardBorder = complete ? '1px solid #c8e6d8' : '1px solid #ddd8d0'

  // Can place gate
  const canPlace  = !!wo.trade_id && (wo.estimated_hours ?? 0) > 0
  const gateReason = !wo.trade_id
    ? 'Select a contractor first'
    : 'Set estimated hours first'

  // Next sequence position
  const nextSeq = Math.max(0, ...allPlacedOrders.map(p => p.sequence_order ?? 0)) + 1

  // ── Chips ──────────────────────────────────────────────────────────────────
  const chips: React.ReactNode[] = []
  if (complete)
    chips.push(<span key="complete" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#475569' }}>Complete</span>)
  else if (sent)
    chips.push(<span key="sent" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #a7d4bc', background: '#eaf4ef', color: '#2d6a4f' }}>Sent</span>)
  if (wo.proximity_range === 'extended')
    chips.push(<span key="ext" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #fca5a5', background: '#fff0f0', color: '#991b1b' }}>Extended range</span>)
  if (visitNumber !== undefined) {
    chips.push(<span key="visit" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #c9a96e', background: '#fef9e7', color: '#92400e' }}>Visit {visitNumber}/{wo.total_visits}</span>)
  } else if ((wo.total_visits ?? 1) > 1) {
    chips.push(<span key="visits" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #ddd8d0', background: '#f5f2ee', color: '#5a5650' }}>{wo.current_visit}/{wo.total_visits} visits</span>)
  }

  // ── Context menu items ─────────────────────────────────────────────────────
  const ctxItems: { label: string; onClick: () => void; danger?: boolean }[] = [
    { label: 'Add visit', onClick: onAddVisit },
  ]
  if (isPlacedWo && !sent) ctxItems.push({ label: '↩ Unplace', onClick: onUnplace })
  if (!sent) ctxItems.push({ label: 'Pause', onClick: () => {}, danger: true })
  if (sent && !complete) ctxItems.push({ label: 'Cancel work order', onClick: onCancel, danger: true })

  // ── Action button ──────────────────────────────────────────────────────────
  const ActionBtn = useCallback(() => {
    if (!isPlacedWo) {
      return canPlace ? (
        <button
          onClick={e => { e.stopPropagation(); onPlace() }}
          style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 500,
            fontFamily: 'DM Sans, sans-serif',
            background: '#1a1a1a', color: '#fff',
            border: '1px solid #1a1a1a', borderRadius: 5, cursor: 'pointer',
          }}
        >
          Place →
        </button>
      ) : (
        <div>
          <button
            disabled
            style={{
              padding: '4px 12px', fontSize: 11, fontWeight: 500,
              fontFamily: 'DM Sans, sans-serif',
              background: '#e2ddd6', color: '#9a9590',
              border: '1px solid #ddd8d0', borderRadius: 5, cursor: 'not-allowed',
            }}
          >
            Place →
          </button>
          <div style={{ fontSize: 10, color: '#991b1b', marginTop: 3 }}>{gateReason}</div>
        </div>
      )
    }
    if (complete) {
      return <span style={{ fontSize: 10, color: '#9a9590' }}>Invoiced</span>
    }
    if (!sent) {
      return (
        <button
          onClick={e => { e.stopPropagation(); onSendOne() }}
          style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 500,
            fontFamily: 'DM Sans, sans-serif',
            background: '#1a1a1a', color: '#fff',
            border: '1px solid #1a1a1a', borderRadius: 5, cursor: 'pointer',
          }}
        >
          Send
        </button>
      )
    }
    return (
      <button
        onClick={e => { e.stopPropagation(); onCancel() }}
        style={{
          padding: '4px 12px', fontSize: 11, fontWeight: 500,
          fontFamily: 'DM Sans, sans-serif',
          color: '#991b1b', border: '1px solid #fca5a5',
          background: '#fff', borderRadius: 5, cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    )
  }, [isPlacedWo, canPlace, complete, sent, gateReason, onPlace, onSendOne, onCancel])

  // ── Predecessor label ──────────────────────────────────────────────────────
  const predWo = wo.predecessor_work_order_id
    ? allPlacedOrders.find(p => p.id === wo.predecessor_work_order_id)
    : null

  // ── Amount display ─────────────────────────────────────────────────────────
  const amountDisplay = wo.agreed_amount
    ? `${aud.format(wo.agreed_amount)} override`
    : wo.quotedAllowance > 0
    ? aud.format(wo.quotedAllowance)
    : '—'

  // ────────────────────────────────────────────────────────────────────────────
  // PLACED VARIANT
  // ────────────────────────────────────────────────────────────────────────────
  if (isPlacedWo) {
    return (
      <div
        draggable={!dragHandleProps}
        onDragStart={!dragHandleProps ? onDragStart : undefined}
        onDragEnd={!dragHandleProps ? onDragEnd : undefined}
        {...dragHandleProps}
        style={{
          borderRadius: 8,
          overflow: 'hidden',
          background: cardBg,
          border: cardBorder,
          borderLeft: cardBorderLeft,
          cursor: dragHandleProps ? 'grab' : 'grab',
          position: 'relative',
          opacity: complete ? 0.8 : 1,
        }}
      >
        {/* Compact summary row */}
        <div
          onClick={onToggleExpand}
          style={{
            padding: '9px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 10,
              color: '#9a9590',
              minWidth: 16,
              flexShrink: 0,
            }}
          >
            {wo.sequence_order}
          </div>
          <div
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: color, flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#1a1a1a' }}>
                {wo.trade?.business_name ?? (
                  <span style={{ color: '#9a9590', fontWeight: 400, fontStyle: 'italic' }}>
                    No contractor
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: '#9a9590',
                  textTransform: 'uppercase',
                  letterSpacing: '.07em',
                }}
              >
                {wo.tradeTypeLabel || wo.work_type}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 3,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 11,
                  color: '#1a1a1a',
                }}
              >
                {amountDisplay}
              </span>
              <span style={{ color: '#ddd8d0', fontSize: 10 }}>·</span>
              <span
                style={{
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 11,
                  color: '#5a5650',
                }}
              >
                {wo.estimated_hours ? `${wo.estimated_hours}h` : '—'}
              </span>
              {wo.lagDays > 0 && (
                <>
                  <span style={{ color: '#ddd8d0', fontSize: 10 }}>·</span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 4,
                      border: '1px solid #fcd38d',
                      background: '#fef3e2',
                      color: '#92400e',
                    }}
                  >
                    {wo.lagDays}d lag
                  </span>
                </>
              )}
              {predWo && (
                <>
                  <span style={{ color: '#ddd8d0', fontSize: 10 }}>·</span>
                  <span style={{ fontSize: 10, color: '#9a9590' }}>
                    after {predWo.tradeTypeLabel || predWo.work_type}
                  </span>
                </>
              )}
              {chips.length > 0 && (
                <>
                  <span style={{ color: '#ddd8d0', fontSize: 10 }}>·</span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{chips}</div>
                </>
              )}
            </div>
          </div>

          {/* Right side */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <GaryBadge state={wo.gary_state} />
            <ActionBtn />
            <CtxMenu items={ctxItems} />
          </div>
          <span style={{ fontSize: 10, color: '#9a9590', marginLeft: 2 }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>

        {/* Expanded detail */}
        {isExpanded && (
          <CardDetail
            wo={wo}
            locked={locked}
            allTrades={trades}
            allPlaced={allPlacedOrders}
            onUpdate={onUpdate}
            onSetPredecessor={onSetPredecessor}
            showDependency
          />
        )}
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // UNPLACED VARIANT (fully expanded by default)
  // ────────────────────────────────────────────────────────────────────────────
  const filteredTrades = trades.filter(
    t => !wo.tradeTypeLabel || t.primary_trade === wo.tradeTypeLabel
  )

  return (
    <div
      draggable={!dragHandleProps}
      onDragStart={!dragHandleProps ? onDragStart : undefined}
      onDragEnd={!dragHandleProps ? onDragEnd : undefined}
      {...dragHandleProps}
      style={{
        borderRadius: 8,
        overflow: 'hidden',
        background: '#ede9e3',
        border: '1px solid #ddd8d0',
        cursor: dragHandleProps ? 'grab' : 'grab',
      }}
    >
      <div style={{ padding: '10px 12px 9px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ opacity: 0, minWidth: 16 }}>·</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Trade type label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.1em',
                color: '#9a9590',
              }}
            >
              {wo.tradeTypeLabel || wo.work_type || 'Work order'}
            </span>
          </div>

          {/* Contractor dropdown */}
          <select
            className="wo-select"
            value={wo.trade_id ?? ''}
            onChange={e => onUpdate({ trade_id: e.target.value || null })}
            style={{ fontSize: 13, fontWeight: wo.trade_id ? 500 : 400 }}
          >
            <option value="">— Select contractor —</option>
            {filteredTrades.map(t => (
              <option key={t.id} value={t.id}>
                {t.business_name}
              </option>
            ))}
          </select>

          {/* Field row */}
          <div
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 8, flexWrap: 'wrap' }}
          >
            <FieldGroup label="Hours est.">
              <input
                className="wo-field-input"
                type="number"
                defaultValue={wo.estimated_hours ?? ''}
                placeholder="—"
                style={{ width: 50 }}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  onUpdate({ estimated_hours: isNaN(v) ? null : v })
                }}
              />
            </FieldGroup>
            <FieldDivider />
            <FieldGroup label="Cushion">
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  className="wo-field-input"
                  type="number"
                  defaultValue={wo.cushionDays}
                  style={{ width: 30 }}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    onUpdate({ cushionDays: isNaN(v) ? 1 : v })
                  }}
                />
                <span style={{ fontSize: 10, color: '#9a9590' }}>d</span>
              </div>
            </FieldGroup>
            <FieldDivider />
            <FieldGroup label="Lag">
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  className="wo-field-input"
                  type="number"
                  defaultValue={wo.lagDays}
                  style={{ width: 30 }}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    onUpdate({ lagDays: isNaN(v) ? 0 : v })
                  }}
                />
                <span style={{ fontSize: 10, color: '#9a9590' }}>d</span>
              </div>
            </FieldGroup>
            <FieldDivider />
            <FieldGroup label="Quoted">
              <div style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#1a1a1a' }}>
                {wo.quotedAllowance > 0 ? aud.format(wo.quotedAllowance) : '—'}
              </div>
            </FieldGroup>
            <FieldDivider />
            <FieldGroup label="Override">
              <input
                className="wo-field-input"
                type="number"
                defaultValue={wo.agreed_amount ?? ''}
                placeholder="—"
                style={{ width: 64 }}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  onUpdate({ agreed_amount: isNaN(v) ? null : v })
                }}
              />
            </FieldGroup>
            <FieldDivider />
            <FieldGroup label="Trade cost">
              <input
                className="wo-field-input"
                type="number"
                defaultValue={wo.trade_cost ?? ''}
                placeholder="—"
                style={{ width: 64 }}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  onUpdate({ trade_cost: isNaN(v) ? null : v })
                }}
              />
            </FieldGroup>
          </div>

          {/* Chips */}
          {chips.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
              {chips}
            </div>
          )}

          {/* Expand / actions row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 7,
              paddingTop: 6,
              borderTop: '1px solid #e8e4de',
            }}
          >
            <button
              onClick={onToggleExpand}
              style={{
                fontSize: 10,
                fontFamily: 'DM Sans, sans-serif',
                color: '#9a9590',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {isExpanded ? '▲' : '▼'} {wo.scopeItems.length} line items
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ActionBtn />
              <CtxMenu items={ctxItems} />
            </div>
          </div>
        </div>
      </div>

      {/* Line items (expandable) */}
      {isExpanded && wo.scopeItems.length > 0 && (
        <div style={{ borderTop: '1px solid #e8e4de', padding: '7px 12px 8px 28px', background: '#f5f2ee' }}>
          {wo.scopeItems.map(si => (
            <div
              key={si.id}
              style={{
                display: 'flex',
                gap: 8,
                padding: '3px 0',
                borderBottom: '1px solid #e8e4de',
                fontSize: 11,
                color: '#5a5650',
              }}
            >
              <span style={{ flex: 1 }}>{si.item_description ?? '—'}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9a9590' }}>
                {si.qty} {si.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
