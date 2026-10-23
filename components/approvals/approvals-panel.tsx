'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { ApprovalView } from '@/lib/approvals/service'

// Dashboard panel for the approval queue (lib/approvals): requests waiting
// on the signed-in user (Approve / Reject) or that they asked for (Cancel).
// Hidden when nothing is waiting.

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function ApprovalsPanel() {
  const [items, setItems] = useState<ApprovalView[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const fetchPending = useCallback(() =>
    fetch('/api/approvals?status=pending')
      .then(r => (r.ok ? r.json() : { approvals: [] }))
      .then((d: { approvals?: ApprovalView[] }) => setItems(d.approvals ?? []))
      .catch(() => setItems([])), [])

  useEffect(() => { void fetchPending() }, [fetchPending])

  async function decide(item: ApprovalView, decision: 'approve' | 'reject' | 'cancel') {
    let note: string | null = null
    if (decision === 'reject') {
      note = window.prompt('Reason for rejecting (optional)')
      if (note === null) return
    }
    setBusy(item.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/approvals/${item.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      })
      const d = await res.json().catch(() => ({})) as { status?: string; result?: string | null; error?: string }
      if (!res.ok) setNotice({ text: d.error ?? 'Could not record the decision', error: true })
      else if (d.status === 'failed') setNotice({ text: `Approved, but it didn't go through: ${d.result}`, error: true })
      else setNotice({ text: `${d.status === 'approved' ? 'Approved and done' : d.status === 'rejected' ? 'Rejected' : 'Cancelled'}: ${item.summary}`, error: false })
    } finally {
      setBusy(null)
      void fetchPending()
    }
  }

  if (!items.length && !notice) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="sec-label">Waiting for approval{items.length ? ` (${items.length})` : ''}</div>
      {notice && (
        <div style={{ fontSize: 13, marginBottom: 10, color: notice.error ? '#b54a3a' : 'var(--subtle-3)' }}>{notice.text}</div>
      )}
      {items.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '0.5px solid var(--line-2)', borderRadius: 10, overflow: 'hidden' }}>
          {items.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 18px', borderTop: i ? '0.5px solid var(--line-faint)' : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>{a.summary}</div>
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>
                  {a.actionLabel} · asked by {a.canCancel ? 'you' : a.requestedBy.name ?? 'someone'}{a.requestedVia === 'voice' ? ' by voice' : ''} · {when(a.createdAt)}
                  {a.jobId && <> · <Link href={`/dashboard/jobs/${a.jobId}`} style={{ color: 'var(--tan)' }}>Open job</Link></>}
                </div>
              </div>
              {a.canDecide && (
                <>
                  <button className="ai-btn ai-btn-confirm" disabled={busy === a.id} onClick={() => decide(a, 'approve')}>Approve</button>
                  <button className="ai-btn ai-btn-edit" disabled={busy === a.id} onClick={() => decide(a, 'reject')}>Reject</button>
                </>
              )}
              {a.canCancel && (
                <button className="ai-btn ai-btn-edit" disabled={busy === a.id} onClick={() => decide(a, 'cancel')}>Cancel request</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
