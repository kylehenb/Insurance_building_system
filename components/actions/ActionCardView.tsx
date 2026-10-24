'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { CardStep, CardWithContext } from '@/lib/actions/cards'
import { snoozePresets, spokenSendAt } from '@/lib/mail/schedule-rules'

// One action card: what the email says, the AI's suggested steps (each can be
// unticked, and emails edited), and Confirm / Skip / Snooze. Confirm runs the
// ticked steps through the user's own permissions (lib/actions/confirm.ts).

interface Props {
  card: CardWithContext
  /** In the conversation panel: no "open conversation" line, tighter */
  compact?: boolean
  onChanged(card: CardWithContext | null, message: string, error?: boolean): void
  onOpenConversation?(threadId: string): void
}

const STATUS_NOTE: Partial<Record<CardWithContext['status'], string>> = {
  queued: 'Waiting to be read…',
  generating: 'Reading the email and the job file…',
  running: 'Doing the steps…',
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function ActionCardView({ card, compact, onChanged, onOpenConversation }: Props) {
  const open = card.status === 'pending' || card.status === 'failed'
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(card.steps.filter(s => s.status !== 'done' && s.status !== 'skipped').map(s => s.id)))
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [editing, setEditing] = useState<string | null>(() => (card.steps.find(s => s.kind === 'email' && s.status !== 'done')?.id ?? null))
  const [showWhy, setShowWhy] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const field = (step: CardStep, key: string) => edits[step.id]?.[key] ?? str(step.args[key])
  const setField = (step: CardStep, key: string, value: string) =>
    setEdits(e => ({ ...e, [step.id]: { ...e[step.id], [key]: value } }))

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what)
    try {
      await fn()
    } catch (err) {
      onChanged(null, err instanceof Error ? err.message : 'Something went wrong', true)
    } finally {
      setBusy(null)
    }
  }

  const confirm = () => run('confirm', async () => {
    const steps = card.steps.filter(s => ticked.has(s.id) && s.status !== 'done').map(s => ({ id: s.id, args: edits[s.id] }))
    const { card: updated } = await post(`/api/actions/${card.id}/confirm`, { steps })
    const failed = (updated as CardWithContext).steps.find(s => s.status === 'failed')
    onChanged(updated, failed ? `Stopped: ${failed.summary} — ${failed.result ?? 'failed'}` : (updated as CardWithContext).outcome ?? 'Done.', !!failed)
  })
  const skip = () => run('skip', async () => {
    await post(`/api/actions/${card.id}/skip`)
    onChanged({ ...card, status: 'skipped', outcome: 'Skipped' }, 'Card skipped.')
  })
  const snooze = (until: string) => run('snooze', async () => {
    setSnoozing(false)
    await post(`/api/actions/${card.id}/snooze`, { until })
    onChanged({ ...card, status: 'snoozed', snoozed_until: until }, `Card snoozed until ${spokenSendAt(until)}.`)
  })
  const retry = () => run('retry', async () => {
    const { card: updated } = await post('/api/actions/suggest', { threadId: card.source_ref })
    onChanged(updated, 'Suggestions updated.')
  })

  const toDo = card.steps.filter(s => ticked.has(s.id) && s.status !== 'done').length
  const thinking = STATUS_NOTE[card.status]

  return (
    <article className={`ac${compact ? ' compact' : ''}${card.priority && card.priority >= 80 ? ' high' : ''} st-${card.status}`}>
      <header className="ac-head">
        <div className="ac-titles">
          <div className="ac-title">
            {card.priority && card.priority >= 80 ? <span className="ac-urgent" title="Urgent">●</span> : null}
            {thinking && card.title === 'Reading the email…' ? (card.conversation?.subject ?? 'New email') : card.title}
          </div>
          {!compact && card.conversation && (
            <button className="ac-source" onClick={() => card.source_ref && onOpenConversation?.(card.source_ref)}>
              {card.conversation.from ? `${card.conversation.from}: ` : ''}{card.conversation.subject ?? '(no subject)'}
            </button>
          )}
        </div>
        <div className="ac-meta">
          {card.job && <Link href={`/dashboard/jobs/${card.job.id}`} className="ac-job">{card.job.job_number}</Link>}
          <span className="ac-when">{ago(card.updated_at)}</span>
        </div>
      </header>

      {thinking ? (
        <div className="ac-thinking"><span className="ac-spin" aria-hidden /> {thinking}</div>
      ) : (
        <>
          {card.description && <p className="ac-summary">{card.description}</p>}
          {card.reasoning && (
            <div className="ac-why">
              <button onClick={() => setShowWhy(w => !w)}>{showWhy ? 'Hide why' : 'Why?'}</button>
              {showWhy && <p>{card.reasoning}</p>}
            </div>
          )}

          {card.steps.length > 0 && (
            <ol className="ac-steps">
              {card.steps.map(step => {
                const done = step.status === 'done'
                return (
                  <li key={step.id} className={`ac-step k-${step.kind}${step.status ? ` s-${step.status}` : ''}`}>
                    <label className="ac-step-row">
                      <input type="checkbox" disabled={!open || done} checked={done || ticked.has(step.id)}
                        onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(step.id); else n.delete(step.id); return n })} />
                      <span className="ac-step-text">{step.summary}</span>
                      {step.status && <span className="ac-step-status">{step.status === 'waiting' ? 'waiting for approval' : step.status}</span>}
                      {step.kind === 'email' && open && !done && (
                        <button type="button" className="ac-link" onClick={e => { e.preventDefault(); setEditing(x => (x === step.id ? null : step.id)) }}>
                          {editing === step.id ? 'Hide' : 'Edit'}
                        </button>
                      )}
                    </label>
                    {step.kind === 'email' && editing === step.id && open && !done && (
                      <div className="ac-email">
                        {(step.args.mode === 'new' || step.args.mode === 'forward' || str(step.args.to)) && (
                          <label>To <input value={field(step, 'to')} onChange={e => setField(step, 'to', e.target.value)} placeholder="Usual recipients" /></label>
                        )}
                        {(step.args.mode === 'new' || step.args.mode === 'forward' || str(step.args.subject)) && (
                          <label>Subject <input value={field(step, 'subject')} onChange={e => setField(step, 'subject', e.target.value)} /></label>
                        )}
                        <textarea value={field(step, 'body')} onChange={e => setField(step, 'body', e.target.value)} rows={Math.min(14, Math.max(5, field(step, 'body').split('\n').length + 1))} />
                        <div className="ac-email-note">The company signature and the email you&apos;re replying to are added when it&apos;s sent.</div>
                      </div>
                    )}
                    {step.result && (step.status === 'failed' || step.status === 'waiting' || done) && <div className="ac-result">{step.result}</div>}
                  </li>
                )
              })}
            </ol>
          )}

          {card.status === 'failed' && card.error_log && <div className="ac-error">{card.error_log}</div>}
          {(card.status === 'done' || card.status === 'skipped' || card.status === 'no_action') && card.outcome && <div className="ac-outcome">{card.outcome}</div>}
          {card.status === 'snoozed' && card.snoozed_until && <div className="ac-outcome">Snoozed until {spokenSendAt(card.snoozed_until)}</div>}

          <footer className="ac-foot">
            {open && card.steps.length > 0 && (
              <button className="ac-btn primary" disabled={!!busy || toDo === 0} onClick={confirm}>
                {busy === 'confirm' ? 'Working…' : toDo === 1 ? 'Do this step' : `Do ${toDo} steps`}
              </button>
            )}
            {open && <button className="ac-btn" disabled={!!busy} onClick={skip}>{card.steps.length ? 'Skip' : 'Done'}</button>}
            {open && (
              <span className="ac-snooze">
                <button className="ac-btn" disabled={!!busy} onClick={() => setSnoozing(s => !s)}>Snooze</button>
                {snoozing && (
                  <span className="ac-snooze-menu">
                    {snoozePresets().map(p => <button key={p.label} onClick={() => snooze(p.at)}>{p.label} <em>{spokenSendAt(p.at)}</em></button>)}
                  </span>
                )}
              </span>
            )}
            {card.source === 'email' && card.source_ref && card.status !== 'running' && (
              <button className="ac-btn ghost" disabled={!!busy} onClick={retry} title="Read the email and job file again">
                {busy === 'retry' ? 'Reading…' : card.status === 'failed' ? 'Try again' : 'Re-suggest'}
              </button>
            )}
          </footer>
        </>
      )}
      <style>{CARD_CSS}</style>
    </article>
  )
}

const CARD_CSS = `
  .ac { background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; font-size: 13px; color: var(--body); }
  .ac.high { border-left: 3px solid var(--danger); }
  .ac.compact { padding: 12px; margin-bottom: 0; }
  .ac.st-done, .ac.st-skipped, .ac.st-no_action { opacity: .75; }
  .ac-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .ac-titles { min-width: 0; }
  .ac-title { font-size: 14px; font-weight: 600; color: var(--ink); line-height: 1.35; }
  .ac.compact .ac-title { font-size: 13px; }
  .ac-urgent { color: var(--danger); margin-right: 6px; font-size: 10px; vertical-align: 2px; }
  .ac-source { display: block; max-width: 100%; font: inherit; font-size: 12px; color: var(--subtle); background: none; border: none; padding: 0; margin-top: 2px; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-source:hover { color: var(--ink); text-decoration: underline; }
  .ac-meta { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .ac-job { font-size: 11px; font-weight: 700; color: var(--teal); background: var(--success-bg-2); border: 0.5px solid #cfe5d8; border-radius: 10px; padding: 1px 8px; text-decoration: none; }
  .ac-when { font-size: 11px; color: var(--faint); }
  .ac-thinking { display: flex; align-items: center; gap: 8px; color: var(--subtle); margin-top: 10px; }
  .ac-spin { width: 12px; height: 12px; border: 2px solid var(--line); border-top-color: var(--gold); border-radius: 50%; animation: ac-spin .8s linear infinite; }
  @keyframes ac-spin { to { transform: rotate(360deg); } }
  .ac-summary { margin: 8px 0 0; line-height: 1.5; }
  .ac-why button { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; padding: 0; margin-top: 6px; cursor: pointer; text-decoration: underline; }
  .ac-why p { margin: 4px 0 0; font-size: 12px; color: var(--subtle); line-height: 1.5; }
  .ac-steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .ac-step { border: 0.5px solid var(--line-faint); border-radius: 8px; padding: 7px 10px; background: var(--surface-3); }
  .ac-step.s-done { background: var(--success-bg-2); }
  .ac-step.s-failed { background: var(--danger-bg); }
  .ac-step-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .ac-step-row input { accent-color: var(--ink); }
  .ac-step-text { flex: 1; min-width: 0; color: var(--ink); }
  .ac-step-status { font-size: 11px; color: var(--subtle); }
  .ac-link { font: inherit; font-size: 12px; color: var(--info); background: none; border: none; padding: 0; cursor: pointer; }
  .ac-email { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  .ac-email label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--subtle); }
  .ac-email input { flex: 1; font: inherit; font-size: 13px; padding: 5px 8px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); }
  .ac-email textarea { font: inherit; font-size: 13px; line-height: 1.5; padding: 8px 10px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); resize: vertical; }
  .ac-email input:focus, .ac-email textarea:focus { outline: none; border-color: var(--gold); }
  .ac-email-note { font-size: 11px; color: var(--faint); }
  .ac-result { font-size: 12px; color: var(--grey-600); margin-top: 4px; white-space: pre-wrap; }
  .ac-error { margin-top: 10px; font-size: 12px; color: var(--danger-dark); background: var(--danger-bg); border-radius: 6px; padding: 6px 10px; }
  .ac-outcome { margin-top: 10px; font-size: 12px; color: var(--subtle); }
  .ac-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
  .ac-btn { font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 16px; padding: 6px 14px; cursor: pointer; }
  .ac-btn.primary { color: var(--cream); background: var(--ink); border-color: var(--ink); font-weight: 600; }
  .ac-btn.ghost { border-color: transparent; color: var(--grey-600); margin-left: auto; }
  .ac-btn:disabled { opacity: .55; cursor: default; }
  .ac-snooze { position: relative; }
  .ac-snooze-menu { position: absolute; left: 0; top: calc(100% + 4px); z-index: 5; display: flex; flex-direction: column; min-width: 230px; background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.15); padding: 4px 0; }
  .ac-snooze-menu button { display: flex; justify-content: space-between; gap: 10px; font: inherit; font-size: 13px; background: none; border: none; padding: 7px 12px; cursor: pointer; text-align: left; }
  .ac-snooze-menu button:hover { background: var(--surface-2); }
  .ac-snooze-menu em { font-style: normal; color: var(--subtle); font-size: 12px; }
`
