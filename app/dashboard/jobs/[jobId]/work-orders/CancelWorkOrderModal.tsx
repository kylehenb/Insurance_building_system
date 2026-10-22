'use client'

import React, { useEffect } from 'react'
import { type WorkOrderWithDetails } from './types'

export interface CancelWorkOrderModalProps {
  workOrder: WorkOrderWithDetails
  onConfirm: (notifyTrade: boolean) => void
  onClose:   () => void
}

// Asks how a sent work order should be cancelled. Clicking the backdrop, the
// × or pressing Escape closes without cancelling (for accidental clicks).
export function CancelWorkOrderModal({ workOrder, onConfirm, onClose }: CancelWorkOrderModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label      = workOrder.tradeTypeLabel || workOrder.work_type
  const contractor = workOrder.trade?.business_name

  const optionStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: 6,
    cursor: 'pointer',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,.38)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(1px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cancel work order"
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line-strong)',
          borderRadius: 12,
          width: 420,
          overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,.14)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--line-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>Cancel work order</span>
          <button
            onClick={onClose}
            title="Close"
            style={{
              width: 26, height: 26,
              border: '1px solid var(--line-strong)',
              borderRadius: 5,
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--subtle-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 12, color: 'var(--body-soft)', marginBottom: 14, lineHeight: 1.6 }}>
            Cancel the <strong>{label}</strong> work order{contractor ? <> sent to <strong>{contractor}</strong></> : null}?
            Gary will stop contacting the trade, and the work order will be unlocked so you can correct or reallocate it.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => onConfirm(true)}
              style={{ ...optionStyle, border: '1px solid var(--danger-dark)', background: 'var(--danger-dark)', color: 'var(--paper)' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#7f1d1d' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--danger-dark)' }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>Cancel and send cancellation email</div>
              <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>Notify the trade that this work order has been cancelled.</div>
            </button>
            <button
              onClick={() => onConfirm(false)}
              style={{ ...optionStyle, border: '1px solid var(--danger-soft)', background: 'var(--paper)', color: 'var(--danger-dark)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-bg-3)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--paper)' }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>Cancel with no notification</div>
              <div style={{ fontSize: 10, color: 'var(--body-soft)', marginTop: 2 }}>Cancel quietly — the trade is not contacted.</div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line-4)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'DM Sans, sans-serif',
              border: '1px solid var(--line-strong)',
              borderRadius: 5,
              background: 'var(--paper)',
              color: 'var(--body-soft)',
              cursor: 'pointer',
            }}
          >
            Keep work order
          </button>
        </div>
      </div>
    </div>
  )
}
