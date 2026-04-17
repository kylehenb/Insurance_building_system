'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { QuoteData, SaveStatus, ScopeItem, ItemType } from '../hooks/useQuote'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NoteTemplate {
  id: string
  title: string
  content: string
}

interface QuoteFooterProps {
  quote: QuoteData
  subtotal: number
  markup: number
  gst: number
  total: number
  items: ScopeItem[]
  onUpdateMarkup: (pct: number) => void
  onUpdateNotes: (notes: string) => void
  onMarkReady: () => void
  onUnlockEdit: () => void
  isLocked: boolean
  saveStatus: SaveStatus
  tenantId: string
  cashSettlementActive: boolean
  onCashSettlementToggle: () => void
  quoteId: string
  jobId: string
  onQuoteUpdated?: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

const ITEM_TYPE_LABELS: Record<NonNullable<ItemType>, { label: string; color: string; border: string }> = {
  provisional_sum: { label: 'Provisional Sum Items', color: '#b45309', border: '#f59e0b' },
  prime_cost: { label: 'Prime Cost Items', color: '#1a73e8', border: '#60a5fa' },
  cash_settlement: { label: 'Cash Settlement Items', color: '#64748b', border: '#94a3b8' },
}

// ── Notes area ────────────────────────────────────────────────────────────────

function NotesArea({
  notes,
  onUpdate,
  isLocked,
  tenantId,
}: {
  notes: string | null
  onUpdate: (v: string) => void
  isLocked: boolean
  tenantId: string
}) {
  const [local, setLocal] = useState(notes ?? '')
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const templateMenuRef = useRef<HTMLDivElement>(null)

  // Sync from external changes (e.g. on load)
  useEffect(() => {
    setLocal(notes ?? '')
  }, [notes])

  // Fetch templates on mount
  useEffect(() => {
    fetch(`/api/quote-note-templates?tenantId=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then((data: NoteTemplate[]) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [tenantId])

  // Close template menu on outside click
  useEffect(() => {
    if (!showTemplates) return
    function handler(e: MouseEvent) {
      if (!templateMenuRef.current?.contains(e.target as Node)) {
        setShowTemplates(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplates])

  const handleChange = useCallback(
    (v: string) => {
      setLocal(v)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onUpdate(v), 800)
    },
    [onUpdate]
  )

  const insertTemplate = useCallback(
    (content: string) => {
      const newVal = local ? `${local}\n\n${content}` : content
      setLocal(newVal)
      setShowTemplates(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onUpdate(newVal), 800)
    },
    [local, onUpdate]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Label + Insert template button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#b0a89e',
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          Notes
        </span>

        {!isLocked && templates.length > 0 && (
          <div ref={templateMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowTemplates(s => !s)}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 11,
                color: '#9e998f',
                background: 'none',
                border: '1px solid #d8d0c8',
                borderRadius: 4,
                padding: '2px 9px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#c8b89a'
                e.currentTarget.style.color = '#3a3530'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#d8d0c8'
                e.currentTarget.style.color = '#9e998f'
              }}
            >
              Insert template ▾
            </button>

            {showTemplates && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 200,
                  background: '#ffffff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                  minWidth: 220,
                  padding: '4px',
                }}
              >
                {templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => insertTemplate(t.content)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 12px',
                      fontSize: 12,
                      fontFamily: 'DM Sans, sans-serif',
                      color: '#3a3530',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: 3,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <textarea
        value={local}
        onChange={e => handleChange(e.target.value)}
        disabled={isLocked}
        placeholder="Add quote notes…"
        rows={5}
        style={{
          width: '100%',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 12,
          color: '#3a3530',
          background: isLocked ? '#f5f2ee' : '#ffffff',
          border: '1px solid #e0dbd4',
          borderRadius: 6,
          padding: '8px 10px',
          outline: 'none',
          resize: 'vertical',
          lineHeight: 1.55,
          boxSizing: 'border-box',
          cursor: isLocked ? 'default' : 'text',
        }}
      />
    </div>
  )
}

// ── Trade cost summary ────────────────────────────────────────────────────────

function TradeSummary({ items }: { items: ScopeItem[] }) {
  type Row = { trade: string; count: number; subtotal: number }
  const rows: Row[] = []
  const map = new Map<string, Row>()

  for (const item of items) {
    const trade = item.trade || 'Unassigned'
    if (!map.has(trade)) map.set(trade, { trade, count: 0, subtotal: 0 })
    const row = map.get(trade)!
    row.count++
    row.subtotal += item.line_total ?? 0
  }

  map.forEach(r => rows.push(r))
  rows.sort((a, b) => b.subtotal - a.subtotal)

  if (rows.length === 0) {
    return (
      <p style={{ fontSize: 12, color: '#9e998f', fontFamily: 'DM Sans, sans-serif', margin: 0 }}>
        No items yet.
      </p>
    )
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Trade', 'Items', 'Subtotal (ex GST)'].map(h => (
            <th
              key={h}
              style={{
                textAlign: h === 'Trade' ? 'left' : 'right',
                padding: '3px 6px',
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#b0a89e',
                fontFamily: 'DM Sans, sans-serif',
                borderBottom: '1px solid #e8e4e0',
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.trade}>
            <td
              style={{
                padding: '4px 6px',
                fontSize: 12,
                color: '#3a3530',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {r.trade}
            </td>
            <td
              style={{
                padding: '4px 6px',
                fontSize: 12,
                color: '#9e998f',
                fontFamily: 'DM Sans, sans-serif',
                textAlign: 'right',
              }}
            >
              {r.count}
            </td>
            <td
              style={{
                padding: '4px 6px',
                fontSize: 12,
                color: '#3a3530',
                fontFamily: 'DM Mono, monospace',
                textAlign: 'right',
              }}
            >
              {fmt(r.subtotal)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Main footer ───────────────────────────────────────────────────────────────

export function QuoteFooter({
  quote,
  subtotal,
  markup,
  gst,
  total,
  items,
  onUpdateMarkup,
  onUpdateNotes,
  onMarkReady,
  onUnlockEdit,
  isLocked,
  saveStatus,
  tenantId,
  cashSettlementActive,
  onCashSettlementToggle,
  quoteId,
  jobId,
  onQuoteUpdated,
}: QuoteFooterProps) {
  const [markupLocal, setMarkupLocal] = useState(
    quote.markup_pct != null ? (quote.markup_pct * 100).toFixed(0) : '20'
  )
  const [showTradeSummary, setShowTradeSummary] = useState(false)

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

  // Compute per-type subtotals
  const typeSubtotals: Partial<Record<NonNullable<ItemType>, number>> = {}
  for (const item of items) {
    if (item.item_type) {
      typeSubtotals[item.item_type] = (typeSubtotals[item.item_type] ?? 0) + (item.line_total ?? 0)
    }
  }
  const hasTypeSubtotals = Object.keys(typeSubtotals).length > 0

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  }

  // Determine button states based on quote status
  const canMarkReady = !isLocked && quote.status === 'draft'
  const canUnlock = isLocked && quote.status === 'ready'
  const canSend = isLocked && quote.status === 'ready'
  const isLockedStatus = isLocked && quote.status !== 'ready' && quote.status !== 'draft'
  // sent/approved quotes cannot be unlocked via this button

  // Dialog states
  const [showSendDialog, setShowSendDialog] = useState(false)
  const [showLockedDialog, setShowLockedDialog] = useState(false)
  const [isCloning, setIsCloning] = useState(false)

  return (
    <div
      style={{
        borderTop: '1px solid #e0dbd4',
        background: '#ffffff',
        padding: '14px 20px 18px',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Trade summary toggle */}
      <div style={{ marginBottom: 10 }}>
        <button
          onClick={() => setShowTradeSummary(s => !s)}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 11,
            color: showTradeSummary ? '#3a3530' : '#9e998f',
            background: 'none',
            border: '1px solid #e0dbd4',
            borderRadius: 4,
            padding: '3px 10px',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = '#c8b89a'
            e.currentTarget.style.color = '#3a3530'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = '#e0dbd4'
            e.currentTarget.style.color = showTradeSummary ? '#3a3530' : '#9e998f'
          }}
        >
          {showTradeSummary ? '▴ Hide trade summary' : '▾ View by Trade'}
        </button>
      </div>

      {showTradeSummary && (
        <div
          style={{
            marginBottom: 14,
            background: '#fafaf8',
            border: '1px solid #e8e4e0',
            borderRadius: 6,
            padding: '10px 12px',
          }}
        >
          <TradeSummary items={items} />
        </div>
      )}

      {/* Two-column layout: notes left (~60%), totals right (~40%) */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* Notes — left column */}
        <div style={{ flex: '0 0 58%' }}>
          <NotesArea
            notes={quote.notes}
            onUpdate={onUpdateNotes}
            isLocked={isLocked}
            tenantId={tenantId}
          />

          {/* Cash Settlement toggle (in footer for inline editor access) */}
          {!isLocked && (
            <div style={{ marginTop: 10 }}>
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
                  padding: '3px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {cashSettlementActive ? '✕ Remove Cash Settlement' : 'Cash Settlement — Entire Quote'}
              </button>
            </div>
          )}
        </div>

        {/* Totals — right column */}
        <div style={{ flex: '0 0 38%' }}>
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
            <span style={{ fontSize: 13, color: '#3a3530', fontFamily: 'DM Mono, monospace' }}>
              {fmt(subtotal)}
            </span>
          </div>

          {/* Builder's Margin */}
          <div style={row}>
            <span
              style={{
                fontSize: 13,
                color: '#9e998f',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
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
            <span style={{ fontSize: 13, color: '#3a3530', fontFamily: 'DM Mono, monospace' }}>
              {fmt(markup)}
            </span>
          </div>

          {/* GST */}
          <div style={row}>
            <span style={{ fontSize: 13, color: '#9e998f' }}>
              GST ({(quote.gst_pct * 100).toFixed(0)}%)
            </span>
            <span style={{ fontSize: 13, color: '#3a3530', fontFamily: 'DM Mono, monospace' }}>
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

          {/* Type subtotals — conditional */}
          {hasTypeSubtotals && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px dashed #e0dbd4',
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#b0a89e',
                  fontFamily: 'DM Sans, sans-serif',
                  marginBottom: 6,
                }}
              >
                Informational breakdown
              </div>
              {(
                ['provisional_sum', 'prime_cost', 'cash_settlement'] as NonNullable<ItemType>[]
              )
                .filter(t => typeSubtotals[t] !== undefined)
                .map(type => (
                  <div
                    key={type}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                      paddingLeft: 8,
                      paddingRight: 8,
                      borderLeft: `3px solid ${ITEM_TYPE_LABELS[type].border}`,
                      borderRight: `3px solid ${ITEM_TYPE_LABELS[type].border}`,
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#9e998f' }}>
                      {ITEM_TYPE_LABELS[type].label} incl GST
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: '#3a3530',
                        fontFamily: 'DM Mono, monospace',
                      }}
                    >
                      {fmt(typeSubtotals[type]! * 1.1)}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* Action buttons based on quote status */}
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {/* Preview Quote - always shown */}
            <button
              onClick={() => window.open(`/print/quotes/${quoteId}`, '_blank')}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 500,
                color: '#3a3530',
                background: '#ffffff',
                border: '1px solid #d8d0c8',
                borderRadius: 6,
                padding: '8px 20px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#c8b89a'
                e.currentTarget.style.background = '#f5f2ee'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#d8d0c8'
                e.currentTarget.style.background = '#ffffff'
              }}
            >
              Preview Quote
            </button>

            {/* Draft status: Mark as Ready */}
            {canMarkReady && (
              <button
                onClick={onMarkReady}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#2e7d32',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1b5e20')}
                onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
              >
                Mark as Ready
              </button>
            )}

            {/* Ready status: Unlock and Edit */}
            {canUnlock && (
              <button
                onClick={onUnlockEdit}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
              >
                Unlock and Edit
              </button>
            )}

            {/* Ready status: Send it */}
            {canSend && (
              <button
                onClick={() => setShowSendDialog(true)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a73e8',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1557b0')}
                onMouseLeave={e => (e.currentTarget.style.background = '#1a73e8')}
              >
                Send it
              </button>
            )}

            {/* Sent to insurer and other locked statuses: Locked */}
            {isLockedStatus && (
              <button
                onClick={() => setShowLockedDialog(true)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#9e998f',
                  background: '#f5f2ee',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
              >
                Locked
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Send it dialog */}
      {showSendDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowSendDialog(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              padding: '24px',
              maxWidth: 400,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: '#3a3530',
                marginBottom: 12,
                margin: 0,
              }}
            >
              Send Quote
            </h3>
            <p
              style={{
                fontSize: 13,
                color: '#3a3530',
                lineHeight: 1.6,
                marginBottom: 20,
                margin: 0,
              }}
            >
              Mock send only as this function is not built yet - please send manually - status will still change
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSendDialog(false)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#c8b89a'
                  e.currentTarget.style.background = '#f5f2ee'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#d8d0c8'
                  e.currentTarget.style.background = '#ffffff'
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowSendDialog(false)
                  await onUpdateNotes?.(quote.notes ?? '')
                  // Update status to sent_to_insurer
                  await fetch(`/api/quotes/${quoteId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      tenantId,
                      status: 'sent_to_insurer',
                    }),
                  })
                  onQuoteUpdated?.()
                }}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a73e8',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1557b0')}
                onMouseLeave={e => (e.currentTarget.style.background = '#1a73e8')}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Locked dialog */}
      {showLockedDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowLockedDialog(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              padding: '24px',
              maxWidth: 400,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: '#3a3530',
                marginBottom: 12,
                margin: 0,
              }}
            >
              Quote Locked
            </h3>
            <p
              style={{
                fontSize: 13,
                color: '#3a3530',
                lineHeight: 1.6,
                marginBottom: 20,
                margin: 0,
              }}
            >
              Sorry Bud, already sent off. No changing it now
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowLockedDialog(false)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#c8b89a'
                  e.currentTarget.style.background = '#f5f2ee'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#d8d0c8'
                  e.currentTarget.style.background = '#ffffff'
                }}
              >
                Close
              </button>
              <button
                onClick={async () => {
                  setShowLockedDialog(false)
                  setIsCloning(true)
                  try {
                    // Clone the quote
                    const response = await fetch(`/api/quotes/${quoteId}/clone`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tenantId }),
                    })
                    if (response.ok) {
                      const newQuote = await response.json()
                      // Navigate to the new quote
                      window.location.href = `/dashboard/jobs/${jobId}/quotes/${newQuote.id}`
                    } else {
                      console.error('Failed to clone quote')
                      setIsCloning(false)
                    }
                  } catch (error) {
                    console.error('Error cloning quote:', error)
                    setIsCloning(false)
                  }
                }}
                disabled={isCloning}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#2e7d32',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: isCloning ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                  opacity: isCloning ? 0.7 : 1,
                }}
                onMouseEnter={e => !isCloning && (e.currentTarget.style.background = '#1b5e20')}
                onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
              >
                {isCloning ? 'Creating...' : 'Create variation or make changes (new quote version)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
