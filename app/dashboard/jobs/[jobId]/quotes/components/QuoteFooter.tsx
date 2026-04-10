'use client'

import React, { useState } from 'react'
import type { QuoteData, SaveStatus } from '../hooks/useQuote'

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

interface QuoteFooterProps {
  quote: QuoteData
  subtotal: number
  markup: number
  gst: number
  total: number
  onUpdateMarkup: (pct: number) => void
  isLocked: boolean
  saveStatus: SaveStatus
}

export function QuoteFooter({
  quote,
  subtotal,
  markup,
  gst,
  total,
  onUpdateMarkup,
  isLocked,
  saveStatus,
}: QuoteFooterProps) {
  const [markupLocal, setMarkupLocal] = useState(
    quote.markup_pct != null ? (quote.markup_pct * 100).toFixed(0) : '20'
  )

  // Sync when quote changes from outside
  React.useEffect(() => {
    setMarkupLocal(quote.markup_pct != null ? (quote.markup_pct * 100).toFixed(0) : '20')
  }, [quote.markup_pct])

  const commitMarkup = () => {
    const pct = parseFloat(markupLocal)
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      onUpdateMarkup(pct / 100)
    } else {
      setMarkupLocal(quote.markup_pct != null ? (quote.markup_pct * 100).toFixed(0) : '20')
    }
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  }

  return (
    <div
      style={{
        borderTop: '1px solid #e0dbd4',
        background: '#ffffff',
        padding: '14px 20px 18px',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 280 }}>
          {/* Save status */}
          <div style={{ textAlign: 'right', marginBottom: 10, minHeight: 16 }}>
            {saveStatus === 'saving' && (
              <span style={{ fontSize: 11, color: '#9e998f' }}>Saving…</span>
            )}
            {saveStatus === 'saved' && (
              <span style={{ fontSize: 11, color: '#2e7d32' }}>Saved ✓</span>
            )}
            {saveStatus === 'error' && (
              <span style={{ fontSize: 11, color: '#c5221f' }}>Save failed — retrying</span>
            )}
          </div>

          {/* Subtotal */}
          <div style={row}>
            <span style={{ fontSize: 13, color: '#9e998f' }}>Subtotal</span>
            <span
              style={{ fontSize: 13, color: '#3a3530', fontFamily: 'DM Mono, monospace' }}
            >
              {fmt(subtotal)}
            </span>
          </div>

          {/* Builder's Margin */}
          <div style={row}>
            <span style={{ fontSize: 13, color: '#9e998f', display: 'flex', alignItems: 'center', gap: 2 }}>
              Builder&apos;s Margin (
              <input
                type="text"
                inputMode="decimal"
                value={markupLocal}
                onChange={e => setMarkupLocal(e.target.value)}
                onBlur={commitMarkup}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                disabled={isLocked}
                style={{
                  width: 36,
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 12,
                  color: '#3a3530',
                  background: isLocked ? 'transparent' : '#ffffff',
                  border: isLocked ? 'none' : '1px solid #d8d0c8',
                  borderRadius: 3,
                  outline: 'none',
                  textAlign: 'center',
                  padding: '1px 4px',
                  cursor: isLocked ? 'default' : 'text',
                }}
              />
              %)
            </span>
            <span
              style={{ fontSize: 13, color: '#3a3530', fontFamily: 'DM Mono, monospace' }}
            >
              {fmt(markup)}
            </span>
          </div>

          {/* GST */}
          <div style={row}>
            <span style={{ fontSize: 13, color: '#9e998f' }}>
              GST ({(quote.gst_pct * 100).toFixed(0)}%)
            </span>
            <span
              style={{ fontSize: 13, color: '#3a3530', fontFamily: 'DM Mono, monospace' }}
            >
              {fmt(gst)}
            </span>
          </div>

          {/* Total */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '1px solid #e0dbd4',
              paddingTop: 10,
              marginTop: 4,
            }}
          >
            <span style={{ fontSize: 14, color: '#3a3530', fontWeight: 600 }}>
              Total inc GST
            </span>
            <span
              style={{
                fontSize: 17,
                color: '#3a3530',
                fontWeight: 700,
                fontFamily: 'DM Mono, monospace',
              }}
            >
              {fmt(total)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
