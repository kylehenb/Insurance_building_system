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
  const [editingMarkup, setEditingMarkup] = useState(false)
  const [markupLocal, setMarkupLocal] = useState((quote.markup_pct * 100).toFixed(0))

  // Sync when quote changes from outside
  React.useEffect(() => {
    if (!editingMarkup) {
      setMarkupLocal((quote.markup_pct * 100).toFixed(0))
    }
  }, [quote.markup_pct, editingMarkup])

  const commitMarkup = () => {
    setEditingMarkup(false)
    const pct = parseFloat(markupLocal)
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      onUpdateMarkup(pct / 100)
    } else {
      setMarkupLocal((quote.markup_pct * 100).toFixed(0))
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
            <span style={{ fontSize: 13, color: '#9e998f' }}>
              Builder&apos;s Margin (
              {editingMarkup && !isLocked ? (
                <input
                  type="text"
                  inputMode="decimal"
                  value={markupLocal}
                  onChange={e => setMarkupLocal(e.target.value)}
                  onBlur={commitMarkup}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitMarkup()
                    if (e.key === 'Escape') {
                      setEditingMarkup(false)
                      setMarkupLocal((quote.markup_pct * 100).toFixed(0))
                    }
                  }}
                  autoFocus
                  style={{
                    width: 32,
                    fontFamily: 'DM Mono, monospace',
                    fontSize: 13,
                    color: '#3a3530',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #c8b89a',
                    outline: 'none',
                    textAlign: 'center',
                    padding: 0,
                  }}
                />
              ) : (
                <span
                  onClick={() => !isLocked && setEditingMarkup(true)}
                  style={{
                    cursor: isLocked ? 'default' : 'pointer',
                    borderBottom: isLocked ? 'none' : '1px dashed #c8b89a',
                    padding: '0 1px',
                  }}
                >
                  {(quote.markup_pct * 100).toFixed(0)}
                </span>
              )}
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
