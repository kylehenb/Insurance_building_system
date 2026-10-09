'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

type InsurerOrder = Database['public']['Tables']['insurer_orders']['Row']
type JobHit = {
  id: string
  job_number: string
  insured_name: string | null
  property_address: string | null
  claim_number: string | null
}
type Sheet = 'lodge' | 'reject' | 'link' | null

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const C = {
  bg: '#f5f2ee',
  card: '#ffffff',
  border: '#e4dfd8',
  text: '#1a1a1a',
  body: '#3a3530',
  muted: '#9a9080',
  accent: '#c8b89a',
  green: '#2a6b50',
  greenBg: '#eaf3f0',
  red: '#b91c1c',
  redBg: '#fdecea',
  amber: '#92400e',
  amberBg: '#fef3c7',
}

const font = "'DM Sans', sans-serif"
const mono = "'DM Mono', monospace"

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: `0.5px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, color: C.text, lineHeight: 1.35, wordBreak: 'break-word' }}>{children ?? '—'}</div>
    </div>
  )
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '6px 16px 8px', marginBottom: 12 }}>
      {title && (
        <h2 style={{ fontSize: 12, fontWeight: 600, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 0 2px' }}>
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

const bigBtn: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 56, borderRadius: 12, fontSize: 17, fontWeight: 600,
  fontFamily: font, cursor: 'pointer', border: 'none', WebkitTapHighlightColor: 'transparent',
}
const primaryBtn: React.CSSProperties = { ...bigBtn, background: C.green, color: '#ffffff' }
const secondaryBtn: React.CSSProperties = { ...bigBtn, background: C.card, color: C.body, border: `1.5px solid ${C.border}` }
const dangerBtn: React.CSSProperties = { ...bigBtn, background: C.card, color: C.red, border: `1.5px solid #f0b4b4` }

export default function MobileOrderReview({
  initialOrder,
  initialJobNumber,
}: {
  initialOrder: InsurerOrder
  initialJobNumber: string | null
}) {
  const [order, setOrder] = useState(initialOrder)
  const [jobNumber, setJobNumber] = useState(initialJobNumber)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<JobHit[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLinked = !!order.job_id
  const isRejected = order.status === 'rejected'
  const isLodged = order.status === 'lodged'
  const canAct = !isRejected && !isLodged
  const visibleResults = linkSearch.trim() ? linkResults : []

  // Debounced link-job search
  useEffect(() => {
    if (sheet !== 'link' || !linkSearch.trim()) return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const term = linkSearch.trim()
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('jobs').select('id, job_number, insured_name, property_address, claim_number')
        .eq('tenant_id', order.tenant_id)
        .or(`job_number.ilike.%${term}%,claim_number.ilike.%${term}%`)
        .limit(8)
      setLinkResults((data as JobHit[]) ?? [])
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [linkSearch, sheet, order.tenant_id])

  function openSheet(next: Sheet) {
    setError(null)
    setRejectReason('')
    setLinkSearch(next === 'link' ? (order.claim_number ?? '') : '')
    setSheet(next)
  }

  function closeSheet() {
    if (busy) return
    setSheet(null)
  }

  async function handleLodge() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/insurer-orders/lodge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Lodge failed'); setBusy(false); return }
      const { jobNumber: newJobNumber, jobId } = json as { jobNumber: string; jobId: string }
      setOrder(o => ({ ...o, job_id: jobId, status: 'lodged' }))
      setJobNumber(newJobNumber)
      setSheet(null)
    } catch {
      setError('Network error — please try again')
    }
    setBusy(false)
  }

  async function handleReject() {
    setBusy(true); setError(null)
    const reason = rejectReason.trim()
    const updatedNotes = order.notes
      ? `${order.notes}\n\nRejected: ${reason}`
      : `Rejected: ${reason}`
    const { error: updateError } = await supabase.from('insurer_orders')
      .update({ status: 'rejected', notes: updatedNotes }).eq('id', order.id)
    if (updateError) {
      setError(updateError.message)
    } else {
      setOrder(o => ({ ...o, status: 'rejected', notes: updatedNotes }))
      setSheet(null)
    }
    setBusy(false)
  }

  async function handleLinkJob(job: JobHit) {
    setBusy(true); setError(null)
    const { error: updateError } = await supabase.from('insurer_orders')
      .update({ job_id: job.id, status: 'lodged' }).eq('id', order.id)
    if (updateError) {
      setError(updateError.message)
    } else {
      setOrder(o => ({ ...o, job_id: job.id, status: 'lodged' }))
      setJobNumber(job.job_number)
      setSheet(null)
    }
    setBusy(false)
  }

  const mapsHref = order.property_address
    ? `https://maps.apple.com/?q=${encodeURIComponent(order.property_address)}`
    : null

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: font, color: C.text }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10, background: C.text, color: '#f5f2ee',
        padding: 'calc(env(safe-area-inset-top) + 12px) 16px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Insurer Order</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {order.claim_number || order.order_ref || 'No claim number'}
          </div>
        </div>
        <Link
          href={`/dashboard/insurer-orders?open=${order.id}&desktop=1`}
          style={{ fontSize: 13, color: C.accent, textDecoration: 'none', whiteSpace: 'nowrap', padding: '8px 0' }}
        >
          Full view →
        </Link>
      </header>

      <main style={{ padding: '14px 14px 24px', maxWidth: 560, margin: '0 auto' }}>
        {/* Status banners */}
        {isLodged && (
          <div style={{ background: C.greenBg, color: C.green, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>✓ Lodged{jobNumber ? ` as ${jobNumber}` : ''}</div>
            {order.job_id && (
              <Link href={`/dashboard/jobs/${order.job_id}`} style={{ display: 'inline-block', marginTop: 6, fontSize: 15, color: C.green, fontWeight: 600 }}>
                Open job →
              </Link>
            )}
          </div>
        )}
        {isRejected && (
          <div style={{ background: C.redBg, color: C.red, borderRadius: 12, padding: '14px 16px', marginBottom: 12, fontSize: 17, fontWeight: 600 }}>
            ✗ Rejected
          </div>
        )}
        {canAct && order.parse_status === 'needs_review' && (
          <div style={{ background: C.amberBg, color: C.amber, borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 14, lineHeight: 1.4 }}>
            <strong>Needs review.</strong> Some details may be missing or uncertain — check them before lodging, or use Full view to edit.
          </div>
        )}
        {canAct && isLinked && (
          <div style={{ background: C.greenBg, color: C.green, borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 14 }}>
            Already linked to {jobNumber ?? 'a job'}.
          </div>
        )}

        <Card title="Claim">
          <Row label="Insurer">{order.insurer}</Row>
          <Row label="Work order type">{order.wo_type}</Row>
          <Row label="Claim number"><span style={{ fontFamily: mono }}>{order.claim_number || '—'}</span></Row>
          <Row label="Loss">{[order.loss_type, order.date_of_loss ? formatDate(order.date_of_loss) : null].filter(Boolean).join(' · ') || '—'}</Row>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Row label="Sum insured">{formatCurrency(order.sum_insured_building)}</Row>
            <Row label="Excess">{formatCurrency(order.excess_building)}</Row>
          </div>
        </Card>

        <Card title="Insured & property">
          <Row label="Insured">{order.insured_name}</Row>
          {order.insured_phone && (
            <Row label="Phone">
              <a href={`tel:${order.insured_phone.replace(/\s+/g, '')}`} style={{ color: C.green, fontWeight: 600 }}>{order.insured_phone}</a>
            </Row>
          )}
          {order.insured_email && (
            <Row label="Email">
              <a href={`mailto:${order.insured_email}`} style={{ color: C.green }}>{order.insured_email}</a>
            </Row>
          )}
          <Row label="Address">
            {mapsHref ? <a href={mapsHref} style={{ color: C.green }}>{order.property_address}</a> : '—'}
          </Row>
        </Card>

        {(order.claim_description || order.special_instructions) && (
          <Card title="Details">
            {order.claim_description && (
              <Row label="Description"><span style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>{order.claim_description}</span></Row>
            )}
            {order.special_instructions && (
              <Row label="Special instructions"><span style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>{order.special_instructions}</span></Row>
            )}
          </Card>
        )}

        <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 4 }}>
          Received {formatDate(order.created_at)}{order.order_sender_name ? ` from ${order.order_sender_name}` : ''}
        </div>

        {/* Spacer so content isn't hidden behind the action bar */}
        {canAct && <div style={{ height: isLinked ? 90 : 220 }} />}
      </main>

      {/* Sticky action bar */}
      {canAct && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          background: 'rgba(245, 242, 238, 0.96)', borderTop: `0.5px solid ${C.border}`,
          padding: '12px 14px calc(env(safe-area-inset-bottom) + 12px)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560, margin: '0 auto' }}>
            {!isLinked && <button style={primaryBtn} onClick={() => openSheet('lodge')}>Lodge Order</button>}
            {!isLinked && <button style={secondaryBtn} onClick={() => openSheet('link')}>Link to Existing Job</button>}
            <button style={dangerBtn} onClick={() => openSheet('reject')}>Reject</button>
          </div>
        </div>
      )}

      {/* Bottom sheet */}
      {sheet && (
        <div
          onClick={closeSheet}
          style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560, margin: '0 auto', background: C.card,
              borderRadius: '16px 16px 0 0', maxHeight: '85dvh', overflowY: 'auto',
              padding: '18px 16px calc(env(safe-area-inset-bottom) + 16px)',
            }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, margin: '0 auto 14px' }} />

            {sheet === 'lodge' && (
              <>
                <h3 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>Lodge this order?</h3>
                <p style={{ fontSize: 15, color: C.body, margin: '0 0 18px', lineHeight: 1.4 }}>
                  A new job will be created for {order.insured_name || 'this insured'}
                  {order.property_address ? ` at ${order.property_address}` : ''}.
                </p>
                <button style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={handleLodge}>
                  {busy ? 'Lodging…' : 'Confirm Lodge'}
                </button>
              </>
            )}

            {sheet === 'reject' && (
              <>
                <h3 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 10px' }}>Reject this order?</h3>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Reason (optional)"
                  style={{
                    width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '12px', fontSize: 16, fontFamily: font, color: C.body, resize: 'vertical', marginBottom: 14,
                  }}
                />
                <button style={{ ...bigBtn, background: C.red, color: '#ffffff', opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={handleReject}>
                  {busy ? 'Rejecting…' : 'Confirm Reject'}
                </button>
              </>
            )}

            {sheet === 'link' && (
              <>
                <h3 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 10px' }}>Link to existing job</h3>
                <input
                  type="search"
                  value={linkSearch}
                  onChange={e => setLinkSearch(e.target.value)}
                  placeholder="Job number or claim number"
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '12px', fontSize: 16, fontFamily: font, color: C.body, marginBottom: 10,
                  }}
                />
                {linkSearch.trim() && visibleResults.length === 0 && (
                  <div style={{ fontSize: 14, color: C.muted, padding: '8px 2px' }}>No matching jobs</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibleResults.map(job => (
                    <button
                      key={job.id}
                      disabled={busy}
                      onClick={() => handleLinkJob(job)}
                      style={{
                        textAlign: 'left', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
                        padding: '12px 14px', fontFamily: font, cursor: 'pointer', opacity: busy ? 0.6 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, color: C.green }}>{job.job_number}</span>
                        <span style={{ fontFamily: mono, fontSize: 13, color: C.muted }}>{job.claim_number ?? ''}</span>
                      </div>
                      <div style={{ fontSize: 15, color: C.text, marginTop: 2 }}>{job.insured_name ?? '—'}</div>
                      {job.property_address && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{job.property_address}</div>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && <div style={{ marginTop: 12, fontSize: 14, color: C.red }}>{error}</div>}

            <button style={{ ...bigBtn, background: 'transparent', color: C.muted, marginTop: 8 }} disabled={busy} onClick={closeSheet}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
