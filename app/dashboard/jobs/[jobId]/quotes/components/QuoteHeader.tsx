import React, { useState, useEffect, useRef } from 'react'
import type { QuoteData } from '../hooks/useQuote'

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

interface QuoteVersion {
  id: string
  version: number
  status: string
  is_active_version: boolean
  created_at: string
  item_count: number
}

interface QuoteHeaderProps {
  quote: QuoteData
  total: number
  cashSettlementActive?: boolean
  onCashSettlementToggle?: () => void
  isLocked?: boolean
  quoteId: string
  tenantId: string
}

export function QuoteHeader({
  quote,
  total,
  cashSettlementActive,
  onCashSettlementToggle,
  isLocked,
  quoteId,
  tenantId,
}: QuoteHeaderProps) {
  const s = STATUS_STYLES[quote.status.toLowerCase()] ?? STATUS_STYLES.draft

  // Version history state
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<QuoteVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [reverting, setReverting] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch versions when dropdown opens
  useEffect(() => {
    if (showVersions) {
      setLoadingVersions(true)
      fetch(`/api/quotes/${quoteId}/versions?tenantId=${encodeURIComponent(tenantId)}`)
        .then(r => r.json())
        .then((data: QuoteVersion[]) => setVersions(data))
        .catch(() => setVersions([]))
        .finally(() => setLoadingVersions(false))
    }
  }, [showVersions, quoteId, tenantId])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showVersions) return
    function handler(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setShowVersions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showVersions])

  // Handle revert to previous version
  const handleRevert = async (versionId: string) => {
    setReverting(versionId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          targetQuoteId: versionId,
        }),
      })
      if (response.ok) {
        // Navigate to the reverted quote
        window.location.href = window.location.pathname.replace(quoteId, versionId)
      } else {
        console.error('Failed to revert quote')
        setReverting(null)
      }
    } catch (error) {
      console.error('Error reverting quote:', error)
      setReverting(null)
    }
  }

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
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowVersions(!showVersions)}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              background: '#e8f0fe',
              color: '#1a73e8',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s',
              fontFamily: 'DM Sans, sans-serif',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#d2e3fc')}
            onMouseLeave={e => (e.currentTarget.style.background = '#e8f0fe')}
          >
            V{quote.version} ▾
          </button>

          {showVersions && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                zIndex: 200,
                background: '#ffffff',
                border: '1px solid #e0dbd4',
                borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                minWidth: 280,
                padding: '4px',
              }}
            >
              {loadingVersions ? (
                <div
                  style={{
                    padding: '12px',
                    fontSize: 12,
                    color: '#9e998f',
                    textAlign: 'center',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Loading...
                </div>
              ) : versions.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    fontSize: 12,
                    color: '#9e998f',
                    textAlign: 'center',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  No versions found
                </div>
              ) : (
                versions.map(v => (
                  <div
                    key={v.id}
                    style={{
                      padding: '8px 10px',
                      borderBottom: v.id !== versions[versions.length - 1].id ? '1px solid #e8e4e0' : 'none',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#3a3530',
                        }}
                      >
                        V{v.version}
                      </span>
                      {v.is_active_version && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            color: '#2e7d32',
                            background: '#e8f5e9',
                            padding: '1px 6px',
                            borderRadius: 10,
                          }}
                        >
                          Current
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#9e998f',
                        marginBottom: 4,
                      }}
                    >
                      {v.status.replace(/_/g, ' ')} • {v.item_count} items
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: '#b0a89e',
                        marginBottom: 6,
                      }}
                    >
                      {new Date(v.created_at).toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {!v.is_active_version && (
                      <button
                        onClick={() => handleRevert(v.id)}
                        disabled={reverting === v.id}
                        style={{
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: 11,
                          fontWeight: 500,
                          color: '#ffffff',
                          background: '#2e7d32',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          cursor: reverting === v.id ? 'not-allowed' : 'pointer',
                          transition: 'background 0.15s',
                          opacity: reverting === v.id ? 0.7 : 1,
                        }}
                        onMouseEnter={e => !reverting && (e.currentTarget.style.background = '#1b5e20')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
                      >
                        {reverting === v.id ? 'Reverting...' : 'Revert to this version'}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
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
