import React from 'react'
import type { QuoteData } from '../hooks/useQuote'

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:              { bg: '#fff8e1', text: '#b45309' },
  sent:               { bg: '#e8f0fe', text: '#1a73e8' },
  approved:           { bg: '#e8f5e9', text: '#2e7d32' },
  partially_approved: { bg: '#e8f5e9', text: '#2e7d32' },
  rejected:           { bg: '#fce8e6', text: '#c5221f' },
  ready:              { bg: '#e8f5e9', text: '#2e7d32' },
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

interface QuoteHeaderProps {
  quote: QuoteData
  total: number
  cashSettlementActive?: boolean
  onCashSettlementToggle?: () => void
  isLocked?: boolean
}

export function QuoteHeader({
  quote,
  total,
  cashSettlementActive,
  onCashSettlementToggle,
  isLocked,
}: QuoteHeaderProps) {
  const s = STATUS_STYLES[quote.status.toLowerCase()] ?? STATUS_STYLES.draft

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 20px',
        background: '#ffffff',
        borderBottom: '1px solid #e0dbd4',
        fontFamily: 'DM Sans, sans-serif',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontFamily: 'DM Mono, monospace',
          fontSize: 14,
          fontWeight: 600,
          color: '#c8b89a',
          letterSpacing: '0.02em',
        }}
      >
        {quote.quote_ref ?? '—'}
      </span>

      <span style={{ fontSize: 14, color: '#3a3530', fontWeight: 500 }}>
        {fmt(total)}{' '}
        <span style={{ fontWeight: 400, color: '#9e998f', fontSize: 12 }}>inc GST</span>
      </span>

      {/* Status badge — shows "Ready" in green when ready */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 10px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 500,
          textTransform: 'capitalize',
          background: s.bg,
          color: s.text,
        }}
      >
        {quote.status.replace(/_/g, ' ')}
      </span>

      {quote.version > 1 && (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            background: '#e8f0fe',
            color: '#1a73e8',
          }}
        >
          V{quote.version}
        </span>
      )}

      {/* Cash Settlement badge (shown on dedicated page) */}
      {cashSettlementActive && (
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 500,
            background: '#f1f5f9',
            color: '#475569',
          }}
        >
          Cash Settlement
        </span>
      )}

      {quote.is_locked && quote.status !== 'ready' && (
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 500,
            background: '#f5f2ee',
            color: '#9e998f',
          }}
        >
          Locked — sent
        </span>
      )}

      {/* Cash Settlement toggle (only on dedicated page, not locked) */}
      {onCashSettlementToggle && !isLocked && (
        <button
          onClick={onCashSettlementToggle}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 11,
            fontWeight: 500,
            color: cashSettlementActive ? '#475569' : '#9e998f',
            background: cashSettlementActive ? '#f1f5f9' : 'transparent',
            border: '1px solid ' + (cashSettlementActive ? '#94a3b8' : '#d8d0c8'),
            borderRadius: 20,
            padding: '2px 10px',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          title={cashSettlementActive ? 'Remove cash settlement from all items' : 'Mark entire quote as Cash Settlement'}
        >
          {cashSettlementActive ? '✕ Cash Settlement' : 'Cash Settlement — Entire Quote'}
        </button>
      )}
    </div>
  )
}
