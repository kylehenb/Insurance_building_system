import React from 'react'
import type { QuoteData } from '../hooks/useQuote'

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:              { bg: '#fff8e1', text: '#b45309' },
  sent:               { bg: '#e8f0fe', text: '#1a73e8' },
  approved:           { bg: '#e8f5e9', text: '#2e7d32' },
  partially_approved: { bg: '#e8f5e9', text: '#2e7d32' },
  rejected:           { bg: '#fce8e6', text: '#c5221f' },
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

interface QuoteHeaderProps {
  quote: QuoteData
  total: number
  insurer: string | null
}

export function QuoteHeader({ quote, total, insurer }: QuoteHeaderProps) {
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

      {insurer && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 10px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 500,
            background: '#f5f2ee',
            color: '#9e998f',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#c8b89a',
              flexShrink: 0,
            }}
          />
          {insurer}
        </span>
      )}

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

      {quote.is_locked && (
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
    </div>
  )
}
