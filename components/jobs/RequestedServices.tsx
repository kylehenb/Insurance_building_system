'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { isPendingApproval, responseError } from '@/lib/approvals/client'
import { ApprovalNotice } from '@/components/approvals/approval-notice'
import { SERVICE_WORK_TYPES, WORK_TYPE_LABELS } from '@/lib/insurer-orders/work-order-type'
import type { ServiceFacts, ServiceStage } from '@/lib/jobs/service-stage'

// The job's requested services — a make safe, roof report, leak detection or
// specialist report the insurer asked for (lib/jobs/services.ts) — under the
// stage banner, with what each needs next. Who does it is decided here, not
// at lodge, and can change: "I'll do it" makes the draft report and invoice;
// "Send to trade" makes a work order (picked and sent on the Work Orders tab);
// once the trade's done, "Prepare report & invoice" invoices their cost plus
// margin. Each stays here until its report and invoice have gone.

interface ServiceView extends ServiceFacts {
  label: string
  stage: ServiceStage
}

type Action = 'in_house' | 'trade' | 'prepare' | 'not_needed' | 'add'

async function call(jobId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/jobs/${jobId}/services`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw responseError(data, 'Something went wrong')
  return data as { message: string; warnings: string[]; services: ServiceView[] }
}

const btn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 500, fontFamily: 'DM Sans, sans-serif',
  border: '1px solid #ddd8d0', borderRadius: 5, background: '#fff', color: '#4a3820', cursor: 'pointer',
}
const primary: React.CSSProperties = { ...btn, background: '#2a6b50', borderColor: '#2a6b50', color: '#fff' }

export default function RequestedServices({ jobId }: { jobId: string }) {
  const [services, setServices] = useState<ServiceView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  // "Not needed" reason and a trade cost asked for when it isn't on record
  const [asking, setAsking] = useState<{ serviceId: string; kind: 'not_needed' | 'cost'; value: string } | null>(null)
  const [adding, setAdding] = useState(false)

  // Loaded on open and again when the window regains focus (a work order sent from another tab)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/jobs/${jobId}/services`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data) setServices(data.services ?? []) })
      .catch(() => { /* the panel just stays as it was */ })
    return () => { cancelled = true }
  }, [jobId, reloads])
  useEffect(() => {
    const onFocus = () => setReloads(n => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  async function run(action: Action, extra: Record<string, unknown> = {}, key: string = action) {
    setBusy(key); setError(null); setPending(null); setNotice(null)
    try {
      const result = await call(jobId, { action, ...extra })
      setServices(result.services)
      setNotice({ text: result.message, warnings: result.warnings ?? [] })
      setAsking(null); setAdding(false)
    } catch (err) {
      if (isPendingApproval(err)) setPending(err.message)
      else {
        const message = err instanceof Error ? err.message : String(err)
        // The trade's cost isn't on record: ask for it
        if (action === 'prepare' && /cost isn't known/.test(message)) setAsking({ serviceId: String(extra.serviceId), kind: 'cost', value: '' })
        setError(message)
      }
    }
    setBusy(null)
  }

  if (!services) return null
  const open = services.filter(s => s.stage.open)
  if (!open.length && !adding && !notice) {
    return (
      <div style={{ margin: '8px 0 0', fontSize: 11, color: '#9e8060', fontFamily: 'DM Sans, sans-serif' }}>
        <button onClick={() => setAdding(true)} style={{ ...btn, border: 'none', background: 'transparent', padding: 0, color: '#9e8060' }}>
          + Add a make safe, roof report or other service
        </button>
      </div>
    )
  }
  const openTypes = new Set(open.map(s => s.service.service_type))

  return (
    <div style={{ margin: '10px 0 0', border: '1px solid #e8dfc8', borderRadius: 8, background: '#fffdf8', padding: '10px 12px', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9e8060' }}>
          Requested services
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ ...btn, border: 'none', background: 'transparent', padding: 0, color: '#9e8060' }}>+ Add</button>
        )}
      </div>

      {open.map(s => {
        const id = s.service.id
        const k = s.stage.key
        const inHouse = s.service.status === 'in_house'
        const reportSent = s.report?.status === 'sent'
        return (
          <div key={id} style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '7px 9px', marginBottom: 6, background: '#fff', borderRadius: 4,
            border: s.stage.urgent ? '0.5px solid var(--danger-soft, #fca5a5)' : '0.5px solid #e8dfc8',
            borderLeft: s.stage.urgent ? '2px solid #ef4444' : '2px solid var(--gold, #c9a96e)',
          }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: s.stage.urgent ? '#7f1d1d' : '#1a1a1a' }}>
                {s.label}
                <span style={{ fontWeight: 400, color: '#9e8060' }}> · {inHouse ? 'in-house' : s.service.status === 'trade' ? 'trade' : 'not arranged'}</span>
                {s.stage.urgent && <span style={{ marginLeft: 6, fontSize: 10, color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Urgent</span>}
              </div>
              <div style={{ fontSize: 11, color: '#5a5040', marginTop: 1 }}>{s.stage.text}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {k === 'unassigned' && <>
                <button style={primary} disabled={!!busy} onClick={() => run('in_house', { serviceId: id }, `${id}:in_house`)}>{busy === `${id}:in_house` ? '…' : 'I\'ll do it'}</button>
                <button style={btn} disabled={!!busy} onClick={() => run('trade', { serviceId: id }, `${id}:trade`)}>{busy === `${id}:trade` ? '…' : 'Send to trade'}</button>
              </>}
              {k === 'trade_done' && (
                <button style={primary} disabled={!!busy} onClick={() => run('prepare', { serviceId: id }, `${id}:prepare`)}>{busy === `${id}:prepare` ? '…' : 'Prepare report & invoice'}</button>
              )}
              {(k === 'wo_unsent' || k === 'with_trade') && <>
                <Link href={`/dashboard/jobs/${jobId}?tab=work-orders`} style={{ ...btn, textDecoration: 'none' }}>Work order</Link>
                <button style={btn} disabled={!!busy} onClick={() => run('in_house', { serviceId: id }, `${id}:in_house`)}>Do it in-house instead</button>
              </>}
              {inHouse && !reportSent && (
                <button style={btn} disabled={!!busy} onClick={() => run('trade', { serviceId: id }, `${id}:trade`)}>Send to trade instead</button>
              )}
              {!reportSent && k !== 'invoice_outstanding' && (
                <button style={{ ...btn, color: '#9a9590' }} disabled={!!busy} onClick={() => setAsking({ serviceId: id, kind: 'not_needed', value: '' })}>Not needed</button>
              )}
            </div>
            {asking?.serviceId === id && (
              <div style={{ flexBasis: '100%', display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input
                  autoFocus
                  value={asking.value}
                  onChange={e => setAsking({ ...asking, value: e.target.value })}
                  placeholder={asking.kind === 'cost' ? 'Trade\'s cost ex GST, e.g. 450' : 'Why isn\'t it needed?'}
                  inputMode={asking.kind === 'cost' ? 'decimal' : undefined}
                  style={{ flex: 1, fontSize: 12, padding: '5px 8px', border: '1px solid #ddd8d0', borderRadius: 5 }}
                />
                <button
                  style={primary}
                  disabled={!!busy || (asking.kind === 'cost' ? !(Number(asking.value) > 0) : asking.value.trim().length < 3)}
                  onClick={() => asking.kind === 'cost'
                    ? run('prepare', { serviceId: id, cost: Number(asking.value) }, `${id}:prepare`)
                    : run('not_needed', { serviceId: id, reason: asking.value.trim() }, `${id}:not_needed`)}
                >
                  {asking.kind === 'cost' ? 'Make invoice' : 'Mark not needed'}
                </button>
                <button style={btn} onClick={() => { setAsking(null); setError(null) }}>Cancel</button>
              </div>
            )}
          </div>
        )
      })}

      {adding && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 11, color: '#5a5040' }}>Add:</span>
          {SERVICE_WORK_TYPES.filter(t => !openTypes.has(t)).map(t => (
            <button key={t} style={btn} disabled={!!busy} onClick={() => run('add', { type: t }, `add:${t}`)}>{WORK_TYPE_LABELS[t]}</button>
          ))}
          <button style={{ ...btn, color: '#9a9590' }} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      {notice && (
        <div style={{ fontSize: 11, color: '#1e5e3c', marginTop: 6, lineHeight: 1.5 }}>
          {notice.text}
          {notice.warnings.map(w => <div key={w} style={{ color: '#92400e' }}>{w}</div>)}
        </div>
      )}
      {pending && <ApprovalNotice message={pending} style={{ marginTop: 6 }} />}
      {error && <div style={{ fontSize: 11, color: '#991b1b', marginTop: 6 }}>{error}</div>}
    </div>
  )
}
