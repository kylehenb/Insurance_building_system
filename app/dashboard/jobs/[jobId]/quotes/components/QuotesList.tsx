'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface RoomSummary {
  count: number
  subtotal: number
}

interface QuoteListItem {
  id: string
  quote_ref: string | null
  status: string
  version: number
  total_amount: number | null
  markup_pct: number
  gst_pct: number
  is_locked: boolean
  created_at: string
  item_count: number
  room_summary: Record<string, RoomSummary>
}

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

interface QuotesListProps {
  jobId: string
  tenantId: string
  insurer: string | null
}

export function QuotesList({ jobId, tenantId, insurer }: QuotesListProps) {
  const router = useRouter()
  const [quotes, setQuotes] = useState<QuoteListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes?jobId=${jobId}&tenantId=${tenantId}`)
      if (res.ok) {
        const data: QuoteListItem[] = await res.json()
        setQuotes(data)
      }
    } finally {
      setLoading(false)
    }
  }, [jobId, tenantId])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, tenantId, quoteType: 'additional_works' }),
      })
      if (!res.ok) throw new Error('Failed')
      const q: QuoteListItem = await res.json()
      router.push(`/dashboard/jobs/${jobId}/quotes/${q.id}`)
    } catch {
      alert('Failed to create quote. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId, router])

  const handleDelete = useCallback(
    async (quoteId: string, quoteRef: string | null) => {
      if (!window.confirm(`Delete quote ${quoteRef ?? 'this quote'}? This cannot be undone.`))
        return
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (res.ok) {
        setQuotes(prev => prev.filter(q => q.id !== quoteId))
        if (expandedId === quoteId) setExpandedId(null)
      }
    },
    [tenantId, expandedId]
  )

  if (loading) {
    return (
      <div
        style={{
          padding: '32px 0',
          textAlign: 'center',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading…
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '0 0 12px',
        }}
      >
        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            color: '#ffffff',
            background: '#3a3530',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            cursor: creating ? 'default' : 'pointer',
            opacity: creating ? 0.7 : 1,
          }}
        >
          {creating ? 'Creating…' : '+ Quote'}
        </button>
      </div>

      {/* Empty state */}
      {quotes.length === 0 && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: 8,
            padding: '40px 20px',
            textAlign: 'center',
            border: '1px solid #e0dbd4',
          }}
        >
          <p style={{ fontSize: 13, color: '#9e998f', marginBottom: 12 }}>
            No quotes yet for this job
          </p>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 12,
              color: '#9e998f',
              background: 'none',
              border: '1px dashed #d8d0c8',
              borderRadius: 6,
              padding: '6px 16px',
              cursor: 'pointer',
            }}
          >
            Create first quote
          </button>
        </div>
      )}

      {/* Quote rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {quotes.map(q => {
          const s = STATUS_STYLES[q.status.toLowerCase()] ?? STATUS_STYLES.draft
          const isExpanded = expandedId === q.id
          const subtotal = q.total_amount ?? 0
          // We display total_amount as the "inc GST" figure from DB, or recalc
          const displayTotal = q.total_amount

          const roomEntries = Object.entries(q.room_summary ?? {})

          return (
            <div
              key={q.id}
              style={{
                background: '#ffffff',
                borderRadius: 8,
                border: '1px solid #e0dbd4',
                overflow: 'hidden',
              }}
            >
              {/* Summary row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  gap: 12,
                  cursor: 'pointer',
                }}
                onClick={() => setExpandedId(isExpanded ? null : q.id)}
              >
                {/* Quote ref */}
                <a
                  href={`/dashboard/jobs/${jobId}/quotes/${q.id}`}
                  onClick={e => e.stopPropagation()}
                  style={{
                    fontFamily: 'DM Mono, monospace',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#c8b89a',
                    textDecoration: 'none',
                    minWidth: 120,
                  }}
                >
                  {q.quote_ref ?? '—'}
                </a>

                {/* Amount */}
                <span style={{ fontSize: 13, color: '#3a3530', fontWeight: 500 }}>
                  {displayTotal != null ? `${fmt(displayTotal)} inc GST` : '—'}
                </span>

                {/* Item count */}
                <span style={{ fontSize: 12, color: '#9e998f' }}>
                  {q.item_count} {q.item_count === 1 ? 'item' : 'items'}
                </span>

                {/* Status */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 9px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'capitalize',
                    background: s.bg,
                    color: s.text,
                  }}
                >
                  {q.status.replace(/_/g, ' ')}
                </span>

                {/* Insurer */}
                {insurer && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 9px',
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 500,
                      background: '#f5f2ee',
                      color: '#9e998f',
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: '#c8b89a',
                        flexShrink: 0,
                      }}
                    />
                    {insurer}
                  </span>
                )}

                {/* Version badge */}
                {q.version > 1 && (
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: '#e8f0fe',
                      color: '#1a73e8',
                    }}
                  >
                    V{q.version}
                  </span>
                )}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Delete */}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    handleDelete(q.id, q.quote_ref)
                  }}
                  title="Delete quote"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#c0bab3',
                    fontSize: 14,
                    padding: '2px 5px',
                    borderRadius: 3,
                    lineHeight: 1,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#c5221f')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#c0bab3')}
                >
                  🗑
                </button>

                {/* Expand chevron */}
                <span
                  style={{
                    color: '#9e998f',
                    fontSize: 11,
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s ease',
                    userSelect: 'none',
                  }}
                >
                  ▼
                </span>
              </div>

              {/* Expanded room summary */}
              {isExpanded && (
                <div
                  style={{
                    borderTop: '1px solid #f0ece6',
                    background: '#fafaf8',
                    padding: '10px 16px 12px',
                  }}
                >
                  {roomEntries.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#9e998f', margin: 0 }}>No items yet</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Room', 'Items', 'Subtotal'].map((h, i) => (
                            <th
                              key={h}
                              style={{
                                fontFamily: 'DM Sans, sans-serif',
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.07em',
                                textTransform: 'uppercase',
                                color: '#9e998f',
                                textAlign: i === 0 ? 'left' : 'right',
                                padding: '0 0 6px',
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {roomEntries.map(([room, data]) => (
                          <tr key={room}>
                            <td
                              style={{
                                fontFamily: 'DM Sans, sans-serif',
                                fontSize: 12,
                                color: '#3a3530',
                                padding: '3px 0',
                                textTransform: 'capitalize',
                              }}
                            >
                              {room}
                            </td>
                            <td
                              style={{
                                fontFamily: 'DM Sans, sans-serif',
                                fontSize: 12,
                                color: '#9e998f',
                                textAlign: 'right',
                                padding: '3px 0',
                              }}
                            >
                              {data.count}
                            </td>
                            <td
                              style={{
                                fontFamily: 'DM Mono, monospace',
                                fontSize: 12,
                                color: '#3a3530',
                                textAlign: 'right',
                                padding: '3px 0',
                              }}
                            >
                              {fmt(data.subtotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <a
                      href={`/dashboard/jobs/${jobId}/quotes/${q.id}`}
                      style={{
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 12,
                        color: '#c8b89a',
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      Open editor →
                    </a>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
