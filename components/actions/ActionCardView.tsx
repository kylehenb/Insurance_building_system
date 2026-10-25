'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { cardThreadId, type CardCategory, type CardWithContext } from '@/lib/actions/cards'
import { spokenDue } from '@/lib/actions/followups'
import { StarButton } from './Star'
import { EmailStep } from './EmailStep'
import { OriginalEmail } from './OriginalEmail'
import { StepPanel } from './StepPanel'
import { RemindMe } from './RemindMe'

// One action card: its star (category — click to change), what the email
// says (and the email itself, opened in place), the AI's suggested steps —
// each can be unticked, opened to see exactly what it will do, and changed;
// emails open in the Mail page's composer — and Do steps / Skip. Doing runs
// the ticked steps through the user's own permissions (lib/actions/confirm.ts).
// "Tell the AI what to change" re-suggests the steps with the office's
// instructions; Remind me sets a follow-up (lib/actions/followups.ts), and a
// follow-up that's due is a card like any other, saying what it was for.

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

/** "on 25 Oct" */
const setOn = (iso: string) => `on ${new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short' }).format(new Date(iso))}`

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

export function ActionCardView({ card: given, compact, onChanged, onOpenConversation }: Props) {
  // Step changes saved on the card (a draft, an edited note) show straight
  // away; the next refresh brings the same from the server
  const [edited, setEdited] = useState<CardWithContext | null>(null)
  useEffect(() => { setEdited(null) }, [given])
  const card = edited ?? given

  const open = card.status === 'pending' || card.status === 'failed'
  const live = open || card.status === 'queued' || card.status === 'generating'
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(card.steps.filter(s => s.status !== 'done' && s.status !== 'skipped').map(s => s.id)))
  // Opened steps; the first email to send starts open
  const [shown, setShown] = useState<Set<string>>(() => new Set(card.steps.filter(s => s.kind === 'email' && s.status !== 'done').slice(0, 1).map(s => s.id)))
  const [composing, setComposing] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [showWhy, setShowWhy] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const flushers = useRef(new Map<string, () => Promise<void>>())

  const registerFlush = useCallback((stepId: string, flush: (() => Promise<void>) | null) => {
    if (flush) flushers.current.set(stepId, flush)
    else flushers.current.delete(stepId)
  }, [])
  const markDirty = useCallback((stepId: string, on: boolean) => setDirty(d => {
    if (d.has(stepId) === on) return d
    const n = new Set(d)
    if (on) n.add(stepId)
    else n.delete(stepId)
    return n
  }), [])
  const dirtyHandlers = useRef(new Map<string, (on: boolean) => void>())
  const onDirtyFor = (stepId: string) => {
    let h = dirtyHandlers.current.get(stepId)
    if (!h) dirtyHandlers.current.set(stepId, h = (on: boolean) => markDirty(stepId, on))
    return h
  }
  const toggleShown = (id: string) => setShown(x => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const message = useCallback((text: string, error?: boolean) => onChanged(null, text, error), [onChanged])

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
    // What's being written in a composer is saved first, so it's what goes
    for (const flush of flushers.current.values()) await flush()
    const steps = card.steps.filter(s => ticked.has(s.id) && s.status !== 'done').map(s => ({ id: s.id }))
    const { card: updated } = await post(`/api/actions/${card.id}/confirm`, { steps })
    const failed = (updated as CardWithContext).steps.find(s => s.status === 'failed')
    onChanged(updated, failed ? `Stopped: ${failed.summary} — ${failed.result ?? 'failed'}` : (updated as CardWithContext).outcome ?? 'Done.', !!failed)
  })
  const skip = () => run('skip', async () => {
    await post(`/api/actions/${card.id}/skip`)
    onChanged({ ...card, status: 'skipped', outcome: 'Skipped' }, 'Card skipped.')
  })
  const recategorise = (category: CardCategory | null) => run('star', async () => {
    if (!category) return
    await post(`/api/actions/${card.id}/category`, { category })
    onChanged({ ...card, category }, 'Star changed.')
  })
  const retry = (instructions?: string) => run(instructions ? 'ask' : 'retry', async () => {
    const which = card.source === 'followup' ? { cardId: card.id } : { threadId: card.source_ref }
    const { card: updated } = await post('/api/actions/suggest', { ...which, ...(instructions ? { feedback: instructions } : {}) })
    setAsking(false)
    setFeedback('')
    onChanged(updated, instructions ? 'Steps re-suggested with your instructions.' : 'Suggestions updated.')
  })

  const toDo = card.steps.filter(s => ticked.has(s.id) && s.status !== 'done').length
  const thinking = card.source === 'followup' && card.status === 'generating' ? 'Checking where the job is at…' : STATUS_NOTE[card.status]
  const f = card.follow_up
  const thread = cardThreadId(card)
  // Email cards are remade from their conversation; a follow-up while it's on the list
  const redoable = card.source === 'email' ? !!card.source_ref : card.source === 'followup' && live

  return (
    <article className={`ac${compact ? ' compact' : ''}${card.priority && card.priority >= 80 ? ' high' : ''} st-${card.status}`}>
      <header className="ac-head">
        {live && !compact && <StarButton category={card.category} cycleOff={false} disabled={!!busy} onCycle={recategorise} />}
        <div className="ac-titles">
          <div className="ac-title">
            {card.priority && card.priority >= 80 ? <span className="ac-urgent" title="Urgent">●</span> : null}
            {thinking && card.title === 'Reading the email…' ? (card.conversation?.subject ?? 'New email') : card.title}
          </div>
          {!compact && card.conversation && (
            <button className="ac-source" onClick={() => thread && onOpenConversation?.(thread)}>
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
          {f && (
            <div className="ac-followup">
              ⏰ Follow-up you set {setOn(card.created_at)}{card.due_at ? ` for ${spokenDue(card.due_at)}` : ''}{f.who ? `, with ${f.who}` : ''}: <b>{f.note}</b>
            </div>
          )}
          {card.description && <p className="ac-summary">{card.description}</p>}
          <div className="ac-why">
            {card.reasoning && <button onClick={() => setShowWhy(w => !w)}>{showWhy ? 'Hide why' : 'Why?'}</button>}
            {!compact && thread && (
              <button onClick={() => setShowEmail(e => !e)}>{showEmail ? 'Hide the email' : 'Show the email'}</button>
            )}
            {showWhy && card.reasoning && <p>{card.reasoning}</p>}
          </div>
          {showEmail && thread && <OriginalEmail threadId={thread} onOpenConversation={onOpenConversation} />}

          {card.steps.length > 0 && (
            <ol className="ac-steps">
              {card.steps.map(step => {
                const done = step.status === 'done' || step.status === 'waiting'
                const editable = open && !done
                const isShown = shown.has(step.id) || composing === step.id
                return (
                  <li key={step.id} className={`ac-step k-${step.kind}${step.status ? ` s-${step.status}` : ''}`}>
                    <div className="ac-step-row">
                      <label className="ac-step-tick">
                        <input type="checkbox" disabled={!open || done} checked={done || ticked.has(step.id)}
                          onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(step.id); else n.delete(step.id); return n })} />
                        <span className="ac-step-text">{step.summary}</span>
                      </label>
                      {step.draft && !done && <span className="ac-step-status">edited</span>}
                      {step.status && <span className="ac-step-status">{step.status === 'waiting' ? 'waiting for approval' : step.status}</span>}
                      <span className="ac-step-btns">
                        {step.kind === 'email' && editable && composing !== step.id && (
                          <button type="button" className="ac-link" onClick={() => { setShown(x => new Set(x).add(step.id)); setComposing(step.id) }}>Edit</button>
                        )}
                        <button type="button" className="ac-link" onClick={() => { if (composing === step.id) setComposing(null); toggleShown(step.id) }}>
                          {isShown ? 'Hide' : step.kind === 'email' || !editable ? 'View' : 'Edit'}
                        </button>
                      </span>
                    </div>
                    {isShown && (step.kind === 'email' && step.tool === 'send_email' ? (
                      <EmailStep
                        card={card}
                        step={step}
                        editable={editable}
                        composing={composing === step.id}
                        onComposing={on => setComposing(on ? step.id : null)}
                        onCard={setEdited}
                        onRan={updated => onChanged(updated, updated.steps.find(s => s.id === step.id)?.result ?? 'Sent.')}
                        onError={text => message(text, true)}
                        registerFlush={registerFlush}
                      />
                    ) : (
                      <StepPanel card={card} step={step} editable={editable} onCard={setEdited} onMessage={message} onDirty={onDirtyFor(step.id)} />
                    ))}
                    {step.result && (step.status === 'failed' || done) && <div className="ac-result">{step.result}</div>}
                  </li>
                )
              })}
            </ol>
          )}

          {card.status === 'failed' && card.error_log && <div className="ac-error">{card.error_log}</div>}
          {(card.status === 'done' || card.status === 'skipped' || card.status === 'no_action') && card.outcome && <div className="ac-outcome">{card.outcome}</div>}

          {asking && (
            <div className="ac-ask">
              <textarea
                autoFocus
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && feedback.trim()) { e.preventDefault(); retry(feedback.trim()) } }}
                rows={3}
                placeholder="What should happen instead? e.g. Don't reply yet — add a note that we're waiting on the insurer's approval, and file it on IRC1042."
              />
              <div className="ac-ask-btns">
                <button className="ac-btn primary" disabled={!!busy || !feedback.trim()} onClick={() => retry(feedback.trim())}>
                  {busy === 'ask' ? 'Re-suggesting…' : 'Re-suggest with this'}
                </button>
                <button className="ac-btn" disabled={!!busy} onClick={() => setAsking(false)}>Cancel</button>
                <span className="ac-ask-note">Replaces the steps below{card.steps.some(s => s.draft) ? ', and discards emails you\'ve edited' : ''}.</span>
              </div>
            </div>
          )}

          {reminding && (
            <RemindMe
              note={f ? f.note : `Follow up: ${card.title}`}
              who={f ? f.who : card.conversation?.from ?? null}
              jobId={card.job_id}
              jobNumber={card.job?.job_number}
              threadId={thread}
              fromCardId={card.id}
              canClear={open}
              onDone={(text, cleared) => {
                setReminding(false)
                onChanged(cleared ? { ...card, status: 'done', outcome: text } : null, text)
              }}
              onError={text => message(text, true)}
              onCancel={() => setReminding(false)}
            />
          )}

          <footer className="ac-foot">
            {open && card.steps.length > 0 && (
              <button className="ac-btn primary" disabled={!!busy || toDo === 0 || dirty.size > 0} onClick={confirm}
                title={dirty.size ? 'Save or undo your changes to the steps first' : undefined}>
                {busy === 'confirm' ? 'Working…' : toDo === 1 ? 'Do this step' : `Do ${toDo} steps`}
              </button>
            )}
            {open && <button className="ac-btn" disabled={!!busy} onClick={skip}>{card.steps.length ? 'Skip' : 'Done'}</button>}
            {dirty.size > 0 && <span className="ac-dirty">Save or undo your step changes first</span>}
            {card.status !== 'running' && (
              <span className="ac-foot-right">
                {!reminding && (
                  <button className="ac-btn ghost" disabled={!!busy} onClick={() => setReminding(true)} title="Have this come back on a day, with the chase drafted">
                    ⏰ Remind me
                  </button>
                )}
                {live && !asking && redoable && (
                  <button className="ac-btn ghost" disabled={!!busy} onClick={() => setAsking(true)} title="Say what you want done, and the AI redoes the steps">
                    Tell the AI what to change
                  </button>
                )}
                {redoable && (
                  <button className="ac-btn ghost" disabled={!!busy} onClick={() => retry()} title="Read the email and job file again">
                    {busy === 'retry' ? 'Reading…' : card.status === 'failed' ? 'Try again' : 'Re-suggest'}
                  </button>
                )}
              </span>
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
  .ac-head { display: flex; gap: 8px; align-items: flex-start; }
  .ac-head > .star-btn { margin: -2px 0 0 -4px; }
  .ac-titles { min-width: 0; flex: 1; }
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
  .ac-followup { margin: 8px 0 0; font-size: 12px; color: var(--grey-600); background: var(--surface-3); border-radius: 6px; padding: 6px 10px; line-height: 1.5; }
  .ac-followup b { color: var(--ink); font-weight: 600; }
  .ac-summary { margin: 8px 0 0; line-height: 1.5; }
  .ac-why button { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; padding: 0; margin: 6px 14px 0 0; cursor: pointer; text-decoration: underline; }
  .ac-why p { margin: 4px 0 0; font-size: 12px; color: var(--subtle); line-height: 1.5; }
  .ac-steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .ac-step { border: 0.5px solid var(--line-faint); border-radius: 8px; padding: 7px 10px; background: var(--surface-3); }
  .ac-step.s-done { background: var(--success-bg-2); }
  .ac-step.s-failed { background: var(--danger-bg); }
  .ac-step-row { display: flex; align-items: center; gap: 8px; }
  .ac-step-tick { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
  .ac-step-tick input { accent-color: var(--ink); }
  .ac-step-btns { display: flex; gap: 12px; flex-shrink: 0; }
  .ac-step-text { flex: 1; min-width: 0; color: var(--ink); }
  .ac-step-status { font-size: 11px; color: var(--subtle); }
  .ac-link { font: inherit; font-size: 12px; color: var(--info); background: none; border: none; padding: 0; cursor: pointer; }
  .ac-ask { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .ac-ask textarea { font: inherit; font-size: 13px; line-height: 1.5; padding: 8px 10px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); resize: vertical; }
  .ac-ask textarea:focus { outline: none; border-color: var(--gold); }
  .ac-ask-btns { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ac-ask-note, .ac-dirty { font-size: 11px; color: var(--faint); }
  .ac-result { font-size: 12px; color: var(--grey-600); margin-top: 4px; white-space: pre-wrap; }
  .ac-error { margin-top: 10px; font-size: 12px; color: var(--danger-dark); background: var(--danger-bg); border-radius: 6px; padding: 6px 10px; }
  .ac-outcome { margin-top: 10px; font-size: 12px; color: var(--subtle); }
  .ac-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
  .ac-btn { font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 16px; padding: 6px 14px; cursor: pointer; }
  .ac-btn.primary { color: var(--cream); background: var(--ink); border-color: var(--ink); font-weight: 600; }
  .ac-btn.ghost { border-color: transparent; color: var(--grey-600); }
  .ac-foot-right { display: flex; flex-wrap: wrap; gap: 2px; margin-left: auto; }
  .ac-btn:disabled { opacity: .55; cursor: default; }
`
