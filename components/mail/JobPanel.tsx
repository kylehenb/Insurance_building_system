'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { ThreadDetail } from '@/lib/mail/list'
import type { JobHit, JobPanel as JobPanelData } from '@/lib/mail/job-context'

// Beside an open conversation: the job it's on (details, stage and next
// step, who to email), or — when it isn't on one — the matcher's
// suggestions, a job search, Admin, and Create order.

interface Props {
  detail: ThreadDetail
  /** Filed or moved: reload the conversation and list */
  onChanged(message: string): void
  onError(message: string): void
  /** New email about the job, optionally to someone */
  onEmail(jobId: string, to?: string): void
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

export function JobPanel({ detail, onChanged, onError, onEmail }: Props) {
  const [job, setJob] = useState<JobPanelData | null>(null)
  const [loadingJob, setLoadingJob] = useState(false)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const jobId = detail.job?.id ?? null

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    setLoadingJob(true)
    fetch(`/api/mail/jobs/${jobId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setJob(d) })
      .finally(() => { if (!cancelled) setLoadingJob(false) })
    return () => { cancelled = true }
  }, [jobId])

  async function file(body: { jobId: string } | { filing: 'admin' | 'to_file' }, done: string) {
    setBusy(true)
    try {
      await postJson(`/api/mail/threads/${detail.id}/file`, body)
      setMoving(false)
      onChanged(done)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not file the email')
    } finally {
      setBusy(false)
    }
  }

  async function createOrder() {
    const incoming = detail.messages.filter(m => !m.labelIds.includes('SENT') && !m.labelIds.includes('DRAFT'))
    const messageId = incoming[0]?.id
    if (!messageId) { onError('There\'s no incoming email to read an order from'); return }
    setBusy(true)
    try {
      const r = await postJson(`/api/mail/threads/${detail.id}/order`, { messageId })
      onChanged(r.existing ? 'That email is already an order.' : 'Order created — check it on Insurer Orders, then lodge it.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="jp">
      {jobId ? (
        <>
          <div className="jp-head">
            <Link href={`/dashboard/jobs/${jobId}`} className="jp-number">{detail.job?.job_number} →</Link>
            <button className="jp-link" onClick={() => setMoving(m => !m)}>{moving ? 'Cancel' : 'Move'}</button>
          </div>
          {moving && <JobSearch busy={busy} onPick={j => file({ jobId: j.id }, `Moved to ${j.job_number}.`)} />}
          {loadingJob && !job && <div className="jp-muted">Loading job…</div>}
          {job && (
            <>
              <div className="jp-block">
                {job.insured_name && <div className="jp-strong">{job.insured_name}</div>}
                {job.property_address && <div>{job.property_address}</div>}
                {job.insured_phone && <div className="jp-muted">{job.insured_phone}</div>}
                {(job.insurer || job.claim_number) && <div className="jp-muted">{[job.insurer, job.claim_number && `Claim ${job.claim_number}`].filter(Boolean).join(' · ')}</div>}
              </div>
              {job.stage && (
                <div className="jp-block">
                  <div className="jp-label">Stage</div>
                  <div className="jp-strong">{job.stage.label}</div>
                  {job.stage.next && <div className="jp-next">Next: {job.stage.next}</div>}
                  {job.stage.warning && <div className="jp-warn">{job.stage.warning}</div>}
                </div>
              )}
              <div className="jp-block">
                <div className="jp-label">Email about this job</div>
                {job.contacts.map(c => (
                  <button key={c.email} className="jp-contact" onClick={() => onEmail(jobId, c.name ? `${c.name} <${c.email}>` : c.email)} title={`New email to ${c.email}`}>
                    <span>{c.label}{c.name ? ` · ${c.name}` : ''}</span>
                    <span className="jp-muted">{c.email}</span>
                  </button>
                ))}
                {job.contacts.length === 0 && <div className="jp-muted">No email addresses on the job.</div>}
                <button className="jp-button" onClick={() => onEmail(jobId)}>New email about {job.job_number}</button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="jp-head">
            <span className="jp-strong">{detail.filing === 'admin' ? 'Filed as admin' : 'Not on a job'}</span>
          </div>
          {detail.candidates.length > 0 && (
            <div className="jp-block">
              <div className="jp-label">Suggested jobs</div>
              {detail.candidates.map(c => (
                <button key={c.job_id} className="jp-contact" disabled={busy} onClick={() => file({ jobId: c.job_id }, `Filed on ${c.job_number}.`)}>
                  <span><strong>{c.job_number}</strong> {c.insured_name ?? c.property_address ?? ''}{c.confidence === 'high' ? ' · likely' : ''}</span>
                  <span className="jp-muted">matched on {c.matched_on.join(', ')}</span>
                </button>
              ))}
            </div>
          )}
          <div className="jp-block">
            <div className="jp-label">File on a job</div>
            <JobSearch busy={busy} onPick={j => file({ jobId: j.id }, `Filed on ${j.job_number}.`)} />
          </div>
          <div className="jp-block jp-row">
            {detail.filing === 'admin'
              ? <button className="jp-button ghost" disabled={busy} onClick={() => file({ filing: 'to_file' }, 'Moved back to To file.')}>Not admin</button>
              : <button className="jp-button ghost" disabled={busy} onClick={() => file({ filing: 'admin' }, 'Filed as admin.')} title="Not job related — notifications, suppliers, accounts">Mark as admin</button>}
            {detail.orderId
              ? <Link href="/dashboard/insurer-orders" className="jp-button ghost">Open the order →</Link>
              : <button className="jp-button ghost" disabled={busy} onClick={createOrder} title="An insurer's order the auto lodger missed">Create order</button>}
          </div>
        </>
      )}
      <style>{JOB_PANEL_CSS}</style>
    </aside>
  )
}

function JobSearch({ busy, onPick }: { busy: boolean; onPick(job: JobHit): void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<JobHit[]>([])
  const seq = useRef(0)
  const searching = q.trim().length >= 2

  useEffect(() => {
    if (!searching) return
    const n = ++seq.current
    const t = setTimeout(async () => {
      const res = await fetch(`/api/mail/jobs?q=${encodeURIComponent(q.trim())}`)
      if (res.ok && n === seq.current) setHits(await res.json())
    }, 250)
    return () => clearTimeout(t)
  }, [q, searching])

  return (
    <div>
      <input className="jp-input" placeholder="Job, claim, name or address" value={q} onChange={e => setQ(e.target.value)} />
      {searching && hits.map(j => (
        <button key={j.id} className="jp-contact" disabled={busy} onClick={() => onPick(j)}>
          <span><strong>{j.job_number}</strong> {j.insured_name ?? ''}</span>
          <span className="jp-muted">{j.property_address ?? j.claim_number ?? ''}</span>
        </button>
      ))}
    </div>
  )
}

const JOB_PANEL_CSS = `
  .jp { width: 300px; flex-shrink: 0; border-left: 0.5px solid var(--line-faint); padding: 18px 16px 32px; overflow-y: auto; font-size: 13px; color: var(--body); background: var(--surface-3); }
  .jp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .jp-number { font-size: 15px; font-weight: 700; color: var(--teal); text-decoration: none; }
  .jp-number:hover { text-decoration: underline; }
  .jp-block { padding: 12px 0; border-top: 0.5px solid var(--line-faint); display: flex; flex-direction: column; gap: 3px; }
  .jp-row { flex-direction: row; flex-wrap: wrap; gap: 8px; }
  .jp-label { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--subtle); font-weight: 700; margin-bottom: 4px; }
  .jp-strong { font-weight: 600; color: var(--ink); }
  .jp-muted { color: var(--subtle); font-size: 12px; }
  .jp-next { color: var(--teal); font-weight: 600; }
  .jp-warn { color: var(--warning-dark); font-size: 12px; }
  .jp-link { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; cursor: pointer; padding: 0; }
  .jp-link:hover { text-decoration: underline; }
  .jp-contact { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; font: inherit; font-size: 13px; text-align: left; background: none; border: none; border-radius: 6px; padding: 6px 8px; margin: 0 -8px; cursor: pointer; color: var(--ink); }
  .jp-contact:hover { background: var(--paper); }
  .jp-contact:disabled { opacity: .6; cursor: default; }
  .jp-button { display: inline-block; font: inherit; font-size: 13px; font-weight: 600; color: var(--cream); background: var(--ink); border: none; border-radius: 16px; padding: 7px 14px; cursor: pointer; text-decoration: none; margin-top: 6px; align-self: flex-start; }
  .jp-button.ghost { color: var(--ink); background: var(--paper); border: 0.5px solid var(--line-strong); font-weight: 500; margin-top: 0; }
  .jp-button:disabled { opacity: .6; cursor: default; }
  .jp-input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; padding: 7px 10px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); outline: none; margin-bottom: 4px; }
  .jp-input:focus { border-color: var(--gold); }
`
