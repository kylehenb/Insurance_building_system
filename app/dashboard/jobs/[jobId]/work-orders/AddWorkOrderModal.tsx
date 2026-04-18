'use client'

import React from 'react'
import type { QuoteRow } from './types'

type AddContext = { type: 'quote'; quoteId: string } | { type: 'additional' }

interface OptionDef {
  label:       string
  description: string
  workType:    string
}

const ADDITIONAL_OPTS: OptionDef[] = [
  { label: 'Trade work order', description: 'Repair or installation',       workType: 'repair'       },
  { label: 'Make safe',        description: 'Emergency make safe',           workType: 'make_safe'    },
  { label: 'Roof report',      description: 'Separate chargeable report',    workType: 'investigation'},
  { label: 'Leak detection',   description: 'Plumber or specialist',         workType: 'investigation'},
  { label: 'Electrical report',description: 'Licensed electrician',          workType: 'investigation'},
  { label: 'Aircon report',    description: 'HVAC specialist',               workType: 'investigation'},
]

export interface AddWorkOrderModalProps {
  context:    AddContext
  quotes:     QuoteRow[]
  onConfirm:  (quoteId: string | null, workType: string) => void
  onCancel:   () => void
}

export function AddWorkOrderModal({
  context,
  quotes,
  onConfirm,
  onCancel,
}: AddWorkOrderModalProps) {
  const isQuote = context.type === 'quote'
  const quote = isQuote ? quotes.find(q => q.id === context.quoteId) : null

  const title = isQuote
    ? `Add to ${quote?.quote_ref ?? 'quote'}`
    : 'Add to additional works'

  const subtitle = isQuote
    ? 'A blank work order will be added, labelled as non-quoted works.'
    : 'Select a type to add.'

  function handleOpt(workType: string) {
    onConfirm(isQuote ? context.quoteId : null, workType)
  }

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
          background: '#fff',
          border: '1px solid #ddd8d0',
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
            borderBottom: '1px solid #e8e4de',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
          <button
            onClick={onCancel}
            style={{
              width: 26, height: 26,
              border: '1px solid #ddd8d0',
              borderRadius: 5,
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              color: '#9a9590',
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
          <p style={{ fontSize: 12, color: '#5a5650', marginBottom: 12 }}>{subtitle}</p>

          {isQuote ? (
            <div
              onClick={() => handleOpt('repair')}
              style={{
                padding: '9px 11px',
                border: '1px solid #ddd8d0',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                background: '#f5f2ee',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
              onMouseEnter={e => {
                const t = e.currentTarget as HTMLElement
                t.style.borderColor = '#1a1a1a'
                t.style.background  = '#fff'
              }}
              onMouseLeave={e => {
                const t = e.currentTarget as HTMLElement
                t.style.borderColor = '#ddd8d0'
                t.style.background  = '#f5f2ee'
              }}
            >
              <div>Blank work order</div>
              <small style={{ fontSize: 10, color: '#9a9590' }}>Non-quoted — manual pricing</small>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
              }}
            >
              {ADDITIONAL_OPTS.map(opt => (
                <div
                  key={opt.label}
                  onClick={() => handleOpt(opt.workType)}
                  style={{
                    padding: '9px 11px',
                    border: '1px solid #ddd8d0',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    background: '#f5f2ee',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                  onMouseEnter={e => {
                    const t = e.currentTarget as HTMLElement
                    t.style.borderColor = '#1a1a1a'
                    t.style.background  = '#fff'
                  }}
                  onMouseLeave={e => {
                    const t = e.currentTarget as HTMLElement
                    t.style.borderColor = '#ddd8d0'
                    t.style.background  = '#f5f2ee'
                  }}
                >
                  <div>{opt.label}</div>
                  <small style={{ fontSize: 10, color: '#9a9590' }}>{opt.description}</small>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #e8e4de',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'DM Sans, sans-serif',
              border: '1px solid #ddd8d0',
              borderRadius: 5,
              background: '#fff',
              color: '#5a5650',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
