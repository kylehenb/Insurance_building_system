'use client'

import React from 'react'
import { type WorkOrderWithDetails, getTradeColor, aud, woIsSent } from './types'

export interface SendAllModalProps {
  workOrders: WorkOrderWithDetails[]
  onConfirm:  () => void
  onCancel:   () => void
}

export function SendAllModal({ workOrders, onConfirm, onCancel }: SendAllModalProps) {
  const toSend = workOrders.filter(
    wo =>
      wo.placementState !== 'unplaced' &&
      !woIsSent(wo) &&
      wo.placementState !== 'placed_complete'
  )

  return (
    <div
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
          <span style={{ fontSize: 14, fontWeight: 500 }}>Send placed work orders</span>
          <button
            onClick={onCancel}
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
          <p
            style={{
              fontSize: 12,
              color: 'var(--body-soft)',
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            The following unsent work orders will be issued to trades. Allowances and trade
            selections will lock on send. Gary SMS will begin once each order is confirmed.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {toSend.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--subtle-2)', textAlign: 'center', padding: '12px 0' }}>
                No unsent placed work orders to send.
              </p>
            ) : (
              toSend.map(wo => {
                const color = getTradeColor(wo.tradeTypeLabel)
                const amount = wo.agreed_amount
                  ? aud.format(wo.agreed_amount)
                  : wo.quotedAllowance > 0
                  ? aud.format(wo.quotedAllowance)
                  : '—'
                return (
                  <div
                    key={wo.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--line-strong)',
                      borderRadius: 6,
                      background: 'var(--surface)',
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: color, flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>
                        {wo.tradeTypeLabel || wo.work_type}
                      </div>
                      <div style={{ color: 'var(--body-soft)', fontSize: 11 }}>
                        {wo.trade?.business_name ?? 'No contractor'}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: 'DM Mono, monospace',
                        fontSize: 11,
                        color: 'var(--body-soft)',
                      }}
                    >
                      {amount}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line-4)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 7,
          }}
        >
          <button
            onClick={onCancel}
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
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={toSend.length === 0}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'DM Sans, sans-serif',
              background: toSend.length === 0 ? '#e2ddd6' : 'var(--ink)',
              color: toSend.length === 0 ? 'var(--subtle-2)' : 'var(--paper)',
              border: `1px solid ${toSend.length === 0 ? 'var(--line-strong)' : 'var(--ink)'}`,
              borderRadius: 5,
              cursor: toSend.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Confirm & send all
          </button>
        </div>
      </div>
    </div>
  )
}
