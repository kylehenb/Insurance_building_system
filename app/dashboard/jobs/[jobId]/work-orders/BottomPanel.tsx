'use client'

import React, { useState } from 'react'
import {
  type WorkOrderWithDetails,
  type QuoteRow,
  getTradeColor,
  garyLabel,
  aud,
  INVOICE_CHAIN_STEPS,
  woIsSent,
} from './types'

function PlacementPill({ wo }: { wo: WorkOrderWithDetails }) {
  const { placementState } = wo
  const styles: Record<string, { bg: string; color: string; border: string; label: string }> = {
    unplaced:       { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'Unplaced' },
    placed_unsent:  { bg: '#eff4ff', color: '#1e40af', border: '#bfdbfe', label: 'Placed' },
    placed_sent:    { bg: '#fef3e2', color: '#92400e', border: '#fcd38d', label: 'Sent' },
    placed_complete:{ bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc', label: 'Complete' },
  }
  const s = styles[placementState] ?? styles.unplaced
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 500,
        padding: '2px 7px',
        borderRadius: 10,
        display: 'inline-block',
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {s.label}
    </span>
  )
}

function GaryPill({ state }: { state: string | null }) {
  const s = state ?? 'not_started'
  const map: Record<string, { bg: string; color: string; border: string }> = {
    not_started:          { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
    confirmed:            { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc' },
    complete:             { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc' },
    waiting_on_dependent: { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
    waiting_reply:        { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
    booking_proposed:     { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
    return_visit_pending: { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
  }
  const style = map[s] ?? map.not_started
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 500,
        padding: '2px 7px',
        borderRadius: 10,
        display: 'inline-block',
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
      }}
    >
      {garyLabel(state)}
    </span>
  )
}

function InvoiceChain({ extStatus }: { extStatus: string | null }) {
  if (!extStatus) return <span style={{ fontSize: 10, color: '#9a9590' }}>—</span>
  const activeIdx = INVOICE_CHAIN_STEPS.findIndex(s => s.key === extStatus)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {INVOICE_CHAIN_STEPS.map((step, i) => {
        const isDone = i < activeIdx
        const isCur  = i === activeIdx
        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <span style={{ color: '#ddd8d0', margin: '0 1px', fontSize: 9 }}>›</span>
            )}
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                background: isDone ? '#eaf4ef' : isCur ? '#fef3e2' : '#ede9e3',
                color:      isDone ? '#2d6a4f' : isCur ? '#92400e' : '#9a9590',
                fontWeight: isCur ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {step.label}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function WORow({
  wo,
  allPlaced,
}: {
  wo: WorkOrderWithDetails
  allPlaced: WorkOrderWithDetails[]
}) {
  const color  = getTradeColor(wo.tradeTypeLabel)
  const predWo = wo.predecessor_work_order_id
    ? allPlaced.find(p => p.id === wo.predecessor_work_order_id)
    : null

  const xeroStyle =
    wo.invoice?.xero_sync_status === 'synced'
      ? { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc', label: 'Synced' }
      : { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'Pending' }

  return (
    <tr>
      <td
        style={{
          fontFamily: 'DM Mono, monospace',
          fontSize: 10,
          color: '#9a9590',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.sequence_order ?? '—'}
      </td>
      <td style={{ padding: '6px 14px', borderBottom: '1px solid #e8e4de', whiteSpace: 'nowrap' }}>
        <span
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: color,
            display: 'inline-block', marginRight: 5, verticalAlign: 'middle',
          }}
        />
        {wo.tradeTypeLabel || wo.work_type}
      </td>
      <td
        style={{
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          color: '#1a1a1a',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.trade?.business_name ?? (
          <span style={{ color: '#991b1b', fontSize: 10 }}>No contractor</span>
        )}
      </td>
      <td style={{ padding: '6px 14px', borderBottom: '1px solid #e8e4de', whiteSpace: 'nowrap' }}>
        <PlacementPill wo={wo} />
      </td>
      <td style={{ padding: '6px 14px', borderBottom: '1px solid #e8e4de', whiteSpace: 'nowrap' }}>
        <GaryPill state={wo.gary_state} />
      </td>
      <td
        style={{
          fontFamily: 'DM Mono, monospace',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.estimated_hours ?? '—'}
      </td>
      <td
        style={{
          fontFamily: 'DM Mono, monospace',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          color: wo.lagDays > 0 ? '#92400e' : '#9a9590',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.lagDays > 0 ? `${wo.lagDays}d` : '—'}
      </td>
      <td
        style={{
          fontFamily: 'DM Mono, monospace',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.quotedAllowance > 0 ? aud.format(wo.quotedAllowance) : '—'}
      </td>
      <td
        style={{
          fontFamily: 'DM Mono, monospace',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.agreed_amount ? aud.format(wo.agreed_amount) : '—'}
      </td>
      <td
        style={{
          fontFamily: 'DM Mono, monospace',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          whiteSpace: 'nowrap',
        }}
      >
        {wo.trade_cost ? aud.format(wo.trade_cost) : '—'}
      </td>
      <td style={{ padding: '6px 14px', borderBottom: '1px solid #e8e4de' }}>
        <InvoiceChain extStatus={woIsSent(wo) ? (wo.invoice?.external_status ?? 'sent_awaiting_invoice') : null} />
      </td>
      <td
        style={{
          fontSize: 10,
          color: '#5a5650',
          padding: '6px 14px',
          borderBottom: '1px solid #e8e4de',
          whiteSpace: 'nowrap',
        }}
      >
        {predWo
          ? `${predWo.tradeTypeLabel || predWo.work_type} · ${predWo.trade?.business_name?.split(' ')[0] ?? '?'}`
          : '—'}
      </td>
      <td style={{ padding: '6px 14px', borderBottom: '1px solid #e8e4de', whiteSpace: 'nowrap' }}>
        <span
          style={{
            fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
            background: wo.proximity_range === 'extended' ? '#fff0f0' : '#f1f5f9',
            color:      wo.proximity_range === 'extended' ? '#991b1b' : '#475569',
            border:     `1px solid ${wo.proximity_range === 'extended' ? '#fca5a5' : '#cbd5e1'}`,
          }}
        >
          {wo.proximity_range ?? 'standard'}
        </span>
      </td>
      <td style={{ padding: '6px 14px', borderBottom: '1px solid #e8e4de', whiteSpace: 'nowrap' }}>
        <span
          style={{
            fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
            background: xeroStyle.bg,
            color:      xeroStyle.color,
            border:     `1px solid ${xeroStyle.border}`,
          }}
        >
          {xeroStyle.label}
        </span>
      </td>
    </tr>
  )
}

const TH_STYLE: React.CSSProperties = {
  padding: '4px 14px',
  textAlign: 'left',
  fontSize: 9,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: '#9a9590',
  borderBottom: '1px solid #e8e4de',
  background: '#fff',
  whiteSpace: 'nowrap',
}

function WOTable({
  workOrders,
  allWorkOrders,
}: {
  workOrders: WorkOrderWithDetails[]
  allWorkOrders: WorkOrderWithDetails[]
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          {['Seq','Trade','Contractor','Status','Gary','Hours','Lag','Quoted','Override','Trade cost','Invoice chain','Depends on','Proximity','Xero'].map(h => (
            <th key={h} style={TH_STYLE}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {workOrders.map(wo => (
          <WORow key={wo.id} wo={wo} allPlaced={allWorkOrders} />
        ))}
      </tbody>
    </table>
  )
}

export interface BottomPanelProps {
  workOrders:  WorkOrderWithDetails[]
  quotes:      QuoteRow[]
  onAddToQuote: (quoteId: string) => void
  onAddAdditional: () => void
}

export function BottomPanel({
  workOrders,
  quotes,
  onAddToQuote,
  onAddAdditional,
}: BottomPanelProps) {
  const [open, setOpen] = useState(true)

  const total = workOrders.length

  // Group: quote-linked vs additional
  const quotedWOs     = workOrders.filter(wo => wo.quote_id !== null && wo.work_type !== 'make_safe')
  const additionalWOs = workOrders.filter(wo => wo.quote_id === null  || wo.work_type === 'make_safe')

  // Sum per quote
  function quoteTotal(quoteId: string) {
    return quotedWOs
      .filter(wo => wo.quote_id === quoteId)
      .reduce((s, wo) => s + (wo.quotedAllowance || wo.agreed_amount || 0), 0)
  }

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid #ddd8d0',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        height: 'auto',
        transition: 'height .2s ease',
      }}
    >
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '7px 20px',
          background: '#ede9e3',
          borderBottom: '1px solid #ddd8d0',
          cursor: 'pointer',
          gap: 9,
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 9, color: '#9a9590' }}>{open ? '▲' : '▼'}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.09em',
            color: '#5a5650',
            flex: 1,
          }}
        >
          All work orders — by quote
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'DM Mono, monospace',
            color: '#9a9590',
          }}
        >
          {total} orders
        </span>
      </div>

      {/* Body */}
      {open && (
        <div style={{ overflowX: 'auto' }}>
          {/* Quote sections */}
          {quotes.map(quote => {
            const qWOs = quotedWOs.filter(wo => wo.quote_id === quote.id)
            return (
              <div key={quote.id}>
                {/* Section header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 20px',
                    background: '#f5f2ee',
                    borderBottom: '1px solid #e8e4de',
                    gap: 8,
                    position: 'sticky',
                    top: 0,
                    zIndex: 4,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'DM Mono, monospace',
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: '#1a1a1a',
                      color: '#fff',
                      letterSpacing: '.03em',
                    }}
                  >
                    {quote.quote_ref ?? `Q-${quote.id.slice(0, 8)}`}
                  </span>
                  <span style={{ fontSize: 10, color: '#9a9590' }}>
                    {aud.format(quoteTotal(quote.id))} ex GST · {qWOs.length} orders
                  </span>
                  <button
                    onClick={() => onAddToQuote(quote.id)}
                    style={{
                      marginLeft: 'auto',
                      padding: '2px 9px',
                      fontSize: 10,
                      fontFamily: 'DM Sans, sans-serif',
                      border: '1px solid #ddd8d0',
                      borderRadius: 4,
                      background: '#fff',
                      color: '#9a9590',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => {
                      const t = e.target as HTMLElement
                      t.style.background = '#1a1a1a'
                      t.style.color = '#fff'
                      t.style.borderColor = '#1a1a1a'
                    }}
                    onMouseLeave={e => {
                      const t = e.target as HTMLElement
                      t.style.background = '#fff'
                      t.style.color = '#9a9590'
                      t.style.borderColor = '#ddd8d0'
                    }}
                  >
                    + Add to quote
                  </button>
                </div>
                {qWOs.length > 0 ? (
                  <WOTable workOrders={qWOs} allWorkOrders={workOrders} />
                ) : (
                  <div style={{ padding: '10px 20px', fontSize: 11, color: '#9a9590' }}>
                    No work orders for this quote yet.
                  </div>
                )}
              </div>
            )
          })}

          {/* Additional works section */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 20px',
                background: '#f5f2ee',
                borderBottom: '1px solid #e8e4de',
                gap: 8,
                position: 'sticky',
                top: 0,
                zIndex: 4,
              }}
            >
              <span
                style={{
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'transparent',
                  border: '1px solid #ddd8d0',
                  color: '#5a5650',
                  letterSpacing: '.03em',
                }}
              >
                Additional works
              </span>
              <span style={{ fontSize: 10, color: '#9a9590' }}>
                Make safes · Specialist reports · Non-quoted
              </span>
              <button
                onClick={onAddAdditional}
                style={{
                  marginLeft: 'auto',
                  padding: '2px 9px',
                  fontSize: 10,
                  fontFamily: 'DM Sans, sans-serif',
                  border: '1px solid #ddd8d0',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#9a9590',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  const t = e.target as HTMLElement
                  t.style.background = '#1a1a1a'
                  t.style.color = '#fff'
                  t.style.borderColor = '#1a1a1a'
                }}
                onMouseLeave={e => {
                  const t = e.target as HTMLElement
                  t.style.background = '#fff'
                  t.style.color = '#9a9590'
                  t.style.borderColor = '#ddd8d0'
                }}
              >
                + Add
              </button>
            </div>
            {additionalWOs.length > 0 ? (
              <WOTable workOrders={additionalWOs} allWorkOrders={workOrders} />
            ) : (
              <div style={{ padding: '10px 20px', fontSize: 11, color: '#9a9590' }}>
                No additional work orders yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
