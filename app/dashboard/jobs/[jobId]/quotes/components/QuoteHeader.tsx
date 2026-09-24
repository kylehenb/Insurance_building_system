import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { QuoteData } from '../hooks/useQuote'
import { TccModal } from './TccModal'

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:              { bg: '#fff8e1', text: '#b45309' },
  sent:               { bg: '#e8f0fe', text: '#1a73e8' },
  approved:           { bg: '#e8f5e9', text: '#2e7d32' },
  partially_approved: { bg: '#e8f5e9', text: '#2e7d32' },
  rejected:           { bg: '#fce8e6', text: '#c5221f' },
  ready:              { bg: '#e8f5e9', text: '#2e7d32' },
  sent_to_insurer:    { bg: '#e8f0fe', text: '#1a73e8' },
  declined_superseded: { bg: '#fce8e6', text: '#c5221f' },
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
  quoteId: string
  tenantId: string
  onMarkReady?: () => void
  onUnlockEdit?: () => void
  onSend?: () => void
  onShowLocked?: () => void
  onFlushPending?: () => Promise<void>
}

export function QuoteHeader({
  quote,
  total,
  cashSettlementActive,
  onCashSettlementToggle,
  isLocked,
  quoteId,
  tenantId,
  onMarkReady,
  onUnlockEdit,
  onSend,
  onShowLocked,
  onFlushPending,
}: QuoteHeaderProps) {
  // Blur whatever's focused (a description field only commits its edit on
  // blur) and wait for any pending debounced item saves to land on the
  // server before opening a preview tab — otherwise the preview can render
  // before the last edit was persisted and show stale text.
  const [previewLoading, setPreviewLoading] = useState(false)
  const openPreview = useCallback(
    async (url: string) => {
      setShowMenu(false)
      setPreviewLoading(true)
      try {
        ;(document.activeElement as HTMLElement | null)?.blur()
        await new Promise(resolve => setTimeout(resolve, 200))
        await onFlushPending?.()
      } finally {
        setPreviewLoading(false)
      }
      window.open(url, '_blank')
    },
    [onFlushPending]
  )
  const s = STATUS_STYLES[quote.status.toLowerCase()] ?? STATUS_STYLES.draft

  // 3-dot menu state
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // TCC modal state
  const [showTccModal, setShowTccModal] = useState(false)

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return
    function handler(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  // Determine button states based on quote status
  const canMarkReady = !isLocked && quote.status === 'draft'
  const canUnlock = isLocked && quote.status === 'ready'
  const canSend = isLocked && quote.status === 'ready'
  const isLockedStatus = isLocked && quote.status !== 'ready' && quote.status !== 'draft'

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

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Status-dependent buttons */}
      {/* Draft status: Mark as Ready */}
      {canMarkReady && onMarkReady && (
        <button
          onClick={onMarkReady}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 12,
            fontWeight: 500,
            color: '#ffffff',
            background: '#2e7d32',
            border: 'none',
            borderRadius: 6,
            padding: '6px 16px',
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
      {canUnlock && onUnlockEdit && (
        <button
          onClick={onUnlockEdit}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 12,
            fontWeight: 500,
            color: '#3a3530',
            background: '#f5f2ee',
            border: '1px solid #d8d0c8',
            borderRadius: 6,
            padding: '6px 16px',
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
      {canSend && onSend && (
        <button
          onClick={onSend}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 12,
            fontWeight: 500,
            color: '#ffffff',
            background: '#1a73e8',
            border: 'none',
            borderRadius: 6,
            padding: '6px 16px',
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
      {isLockedStatus && onShowLocked && (
        <button
          onClick={onShowLocked}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 12,
            fontWeight: 500,
            color: '#9e998f',
            background: '#f5f2ee',
            border: '1px solid #e0dbd4',
            borderRadius: 6,
            padding: '6px 16px',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
        >
          Locked
        </button>
      )}

      {/* 3-dot menu with Preview Quote */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#9e998f',
            fontSize: 16,
            padding: '4px 6px',
            borderRadius: 4,
            lineHeight: 1,
            fontFamily: 'DM Sans, sans-serif',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#3a3530')}
          onMouseLeave={e => (e.currentTarget.style.color = '#9e998f')}
        >
          •••
        </button>

        {showMenu && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 500,
              background: '#ffffff',
              border: '1px solid #e0dbd4',
              borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
              padding: '4px 0',
              minWidth: 180,
            }}
          >
            <button
              disabled={previewLoading}
              onClick={() => {
                void openPreview(`/print/quotes/${quoteId}`)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                padding: '7px 14px',
                fontSize: 12,
                color: '#3a3530',
                background: 'transparent',
                border: 'none',
                cursor: previewLoading ? 'default' : 'pointer',
                opacity: previewLoading ? 0.6 : 1,
                fontWeight: 400,
                fontFamily: 'DM Sans, sans-serif',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              <span style={{ fontSize: 10, color: '#c8b89a' }}>👁</span>
              <span>{previewLoading ? 'Saving changes…' : 'Preview Quote'}</span>
            </button>
            <button
              onClick={() => {
                setShowMenu(false)
                setShowTccModal(true)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                padding: '7px 14px',
                fontSize: 12,
                color: '#3a3530',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 400,
                fontFamily: 'DM Sans, sans-serif',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              <span style={{ fontSize: 10, color: '#c8b89a' }}>📋</span>
              <span>Telephone Clearance Certificate</span>
            </button>
          </div>
        )}
      </div>

      {showTccModal && (
        <TccModal
          quoteId={quoteId}
          onClose={() => setShowTccModal(false)}
        />
      )}
    </div>
  )
}
