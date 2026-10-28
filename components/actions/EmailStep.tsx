'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Composer, type ComposerHandle } from '@/components/mail/Composer'
import { MessageBody } from '@/components/mail/MessageBody'
import type { CardStep, CardWithContext } from '@/lib/actions/cards'
import type { ComposeStart, ComposeState } from '@/lib/mail/compose-rules'
import { spokenSendAt } from '@/lib/mail/schedule-rules'
import { SIGNATURE_LOGO_TOKEN } from '@/lib/email/rich-text'

// An email step on an action card: the email as it will go — recipients,
// subject, text and the company signature. Its recipients, subject and text
// are edited right there, saved on the step as you type (and before Do
// steps). More options opens it in the Mail page's composer (Cc/Bcc,
// attachments, formatting, signature, quoted email, schedule send); what's
// written there is a Gmail draft the step then sends as it is, and Send in
// the composer does just this step.

const str = (v: unknown) => (typeof v === 'string' ? v : '')

type Signature = { html: string | null; logo: { url: string; width: number; height: number } | null }
let signature: Promise<Signature> | null = null
function companySignature(): Promise<Signature> {
  signature ??= fetch('/api/mail/signature')
    .then(r => (r.ok ? r.json() : { html: null, logo: null }))
    .then(d => ({ html: (d.html as string | null) ?? null, logo: d.logo ?? null }))
    .catch(() => ({ html: null, logo: null }))
  return signature
}

/** An edited email's text: its signature's {logo} line as the logo */
function withLogo(html: string, logo: Signature['logo']): string {
  const img = logo ? `<img src="${logo.url}" width="${logo.width}" height="${logo.height}" alt="Logo" style="display:block;max-width:100%;margin:6px 0">` : ''
  return html.split(`<p>${SIGNATURE_LOGO_TOKEN}</p>`).join(img)
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

const WHO: Record<string, string> = { reply: 'the sender (reply)', reply_all: 'everyone on the email (reply all)' }

/** The fields edited in place, as the step's args */
type Fields = { to: string; cc: string; subject: string; body: string }
const SAVE_AFTER_MS = 700

interface Props {
  card: CardWithContext
  step: CardStep
  /** Not sent yet, on a card still to do */
  editable: boolean
  composing: boolean
  onComposing(on: boolean): void
  onCard(card: CardWithContext): void
  /** Sent (or scheduled) from the composer: the card after that step ran */
  onRan(card: CardWithContext): void
  onError(message: string): void
  /** Lets the card save what's being written before it runs its steps */
  registerFlush(stepId: string, flush: (() => Promise<void>) | null): void
}

export function EmailStep({ card, step, editable, composing, onComposing, onCard, onRan, onError, registerFlush }: Props) {
  const [sig, setSig] = useState<Signature | undefined>(undefined)
  const [start, setStart] = useState<ComposeStart | null>(null)
  const [busy, setBusy] = useState(false)
  const composerRef = useRef<ComposerHandle>(null)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const base = `/api/actions/${card.id}/steps/${step.id}`

  // Edited in place: what's typed, and what the step has saved
  const fieldsOf = (): Fields => ({ to: str(step.args.to), cc: str(step.args.cc), subject: str(step.args.subject), body: str(step.args.body) })
  const [fields, setFields] = useState<Fields>(fieldsOf)
  const saved = useRef<Fields>(fields)
  const typed = useRef<Fields>(fields)
  typed.current = fields
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | null>(null)
  const inPlace = editable && !composing && !step.draft

  const saveFields = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const now = typed.current
    const changes = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== saved.current[k as keyof Fields]))
    if (!Object.keys(changes).length) return
    setState('saving')
    saving.current = saving.current
      .catch(() => {})
      .then(() => post(base, { args: changes }))
      .then(({ card: updated }) => { saved.current = now; setState('saved'); onCard(updated) })
    await saving.current.catch(err => { setState(null); onError(err instanceof Error ? err.message : 'Could not save the email'); throw err })
  }, [base, onCard, onError])

  const edit = (k: keyof Fields, v: string) => {
    setFields(f => ({ ...f, [k]: v }))
    setState(null)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void saveFields().catch(() => {}) }, SAVE_AFTER_MS)
  }

  // Do steps saves what's typed first
  useEffect(() => {
    if (!inPlace) return
    registerFlush(step.id, saveFields)
    return () => registerFlush(step.id, null)
  }, [inPlace, step.id, registerFlush, saveFields])

  useEffect(() => {
    let cancelled = false
    companySignature().then(s => { if (!cancelled) setSig(s) })
    return () => { cancelled = true }
  }, [])

  // Open the composer: the step's draft, or the AI's email ready to edit
  useEffect(() => {
    if (!composing) { setStart(null); return }
    let cancelled = false
    saveFields().catch(() => {}).then(() => fetch(`${base}/compose`))
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? 'Could not open the email')
        return body as ComposeStart
      })
      .then(s => { if (!cancelled) setStart(s) })
      .catch(err => {
        if (cancelled) return
        onError(err instanceof Error ? err.message : 'Could not open the email')
        onComposing(false)
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reopen only when composing starts
  }, [composing, base])

  /** Keeps the composer's draft on the card, one save at a time */
  const keepDraft = useCallback((s: ComposeState) => {
    if (!s.draftId) return
    const draft = { id: s.draftId, to: s.to, cc: s.cc, bcc: s.bcc, subject: s.subject, html: s.body }
    saving.current = saving.current
      .catch(() => {})
      .then(() => post(base, { draft }))
      .then(({ card: updated }) => onCard(updated))
      .catch(err => onError(err instanceof Error ? err.message : 'Could not keep the draft on the card'))
    return saving.current
  }, [base, onCard, onError])

  useEffect(() => {
    if (!composing) return
    registerFlush(step.id, async () => {
      await composerRef.current?.flush()
      await saving.current
    })
    return () => registerFlush(step.id, null)
  }, [composing, step.id, registerFlush])

  async function runNow(args?: Record<string, unknown>) {
    setBusy(true)
    try {
      await saving.current
      const { card: updated } = await post(`/api/actions/${card.id}/confirm`, { steps: [{ id: step.id, args }], only: true })
      onComposing(false)
      onRan(updated)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  async function backToSuggestion() {
    try {
      const { card: updated } = await post(base, { draft: null })
      onCard(updated)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not change the step')
    }
    onComposing(false)
  }

  if (composing) {
    if (!start) return <div className="es-note">Opening the email…</div>
    return (
      <div className={`es-compose${busy ? ' busy' : ''}`}>
        <Composer
          ref={composerRef}
          initial={start}
          variant="inline"
          onSaved={keepDraft}
          onClose={() => onComposing(false)}
          onDiscarded={backToSuggestion}
          onSend={() => runNow()}
          onSchedule={(_draftId, sendAt) => runNow({ send_at: sendAt })}
        />
        <div className="es-note">
          Saved as a draft as you type. Send here sends just this email; the card&apos;s other steps stay. The bin goes back to the AI&apos;s email.
        </div>
        <style>{EMAIL_CSS}</style>
      </div>
    )
  }

  const a = step.args
  const d = step.draft
  const mode = str(a.mode) || 'new'
  const to = d ? d.to : str(a.to) || WHO[mode] || ''
  const cc = d ? d.cc : str(a.cc)
  const bcc = d ? d.bcc : str(a.bcc)
  const subject = d ? d.subject : str(a.subject) || (mode === 'new' ? '' : `Re: ${card.conversation?.subject ?? ''}`)
  const sendAt = str(a.send_at)
  const files = (Array.isArray(a.attach_photos) ? a.attach_photos.length : 0) + (Array.isArray(a.attach_files) ? a.attach_files.length : 0)

  if (inPlace) {
    return (
      <div className="es es-edit-in">
        <div className="es-head">
          <label className="es-row"><span>To</span><input value={fields.to} placeholder={WHO[mode] ?? 'name@example.com'} onChange={e => edit('to', e.target.value)} onBlur={() => void saveFields().catch(() => {})} /></label>
          {(fields.cc || mode === 'reply_all') && <label className="es-row"><span>Cc</span><input value={fields.cc} onChange={e => edit('cc', e.target.value)} onBlur={() => void saveFields().catch(() => {})} /></label>}
          <label className="es-row"><span>Subject</span><input value={fields.subject} placeholder={mode === 'new' ? '(no subject)' : `Re: ${card.conversation?.subject ?? ''}`} onChange={e => edit('subject', e.target.value)} onBlur={() => void saveFields().catch(() => {})} /></label>
          {sendAt && <div className="es-row"><span>Sends</span>{/[zZ]$/.test(sendAt) ? spokenSendAt(sendAt) : sendAt}</div>}
        </div>
        <div className="es-body">
          <textarea className="es-area" aria-label="The email" value={fields.body} rows={Math.max(4, fields.body.split('\n').length + 1)}
            onChange={e => edit('body', e.target.value)} onBlur={() => void saveFields().catch(() => {})} />
          {sig?.html && <div className="es-sig" title="Added when sent — change it in Settings → Email Templates" dangerouslySetInnerHTML={{ __html: sig.html }} />}
          {files > 0 && <div className="es-note">📎 {files} job photo{files === 1 ? '' : 's'} or file{files === 1 ? '' : 's'} attached</div>}
          <div className="es-foot">
            <span className="es-note">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved on the card' : 'Type to change it'}{mode !== 'new' ? ' · the email it answers is quoted underneath' : ''}</span>
            <button type="button" className="ac-link" onClick={() => onComposing(true)} title="Cc/Bcc, attachments, formatting, schedule send">More options</button>
          </div>
        </div>
        <style>{EMAIL_CSS}</style>
      </div>
    )
  }

  return (
    <div className="es">
      <div className="es-head">
        <div className="es-row"><span>To</span><b>{to || '—'}</b></div>
        {cc && <div className="es-row"><span>Cc</span>{cc}</div>}
        {bcc && <div className="es-row"><span>Bcc</span>{bcc}</div>}
        <div className="es-row"><span>Subject</span>{subject || '(no subject)'}</div>
        {sendAt && <div className="es-row"><span>Sends</span>{/[zZ]$/.test(sendAt) ? spokenSendAt(sendAt) : sendAt}</div>}
        {editable && <button type="button" className="ac-btn es-edit" onClick={() => onComposing(true)}>Edit</button>}
      </div>
      <div className="es-body">
        {d ? <MessageBody html={withLogo(d.html, sig?.logo ?? null)} text="" sender="" /> : <div className="es-text">{str(a.body)}</div>}
        {/* An edited email has the signature in its text */}
        {!d && sig?.html && <div className="es-sig" title="Added when sent — change it in Settings → Email Templates" dangerouslySetInnerHTML={{ __html: sig.html }} />}
        {!d && sig && !sig.html && <div className="es-note">No company signature set up yet.</div>}
        {files > 0 && <div className="es-note">📎 {files} job photo{files === 1 ? '' : 's'} or file{files === 1 ? '' : 's'} attached</div>}
        {mode !== 'new' && <div className="es-note">The email it answers is quoted underneath.</div>}
      </div>
      <style>{EMAIL_CSS}</style>
    </div>
  )
}

const EMAIL_CSS = `
  .es { margin-top: 8px; border: 0.5px solid var(--line-2); border-radius: 8px; background: var(--paper); }
  .es-head { position: relative; padding: 8px 12px; border-bottom: 0.5px solid var(--line-faint); display: flex; flex-direction: column; gap: 3px; }
  .es-row { display: flex; gap: 8px; font-size: 12px; color: var(--ink); padding-right: 64px; min-width: 0; overflow-wrap: anywhere; }
  .es-row span { width: 52px; flex-shrink: 0; color: var(--subtle); }
  .es-row b { font-weight: 600; }
  .es-edit { position: absolute; top: 8px; right: 10px; font-size: 12px; padding: 3px 12px; }
  .es-body { padding: 10px 12px; }
  .es-text { white-space: pre-wrap; line-height: 1.5; color: var(--ink); }
  .es-sig { margin-top: 10px; padding-top: 8px; border-top: 0.5px dashed var(--line); opacity: .85; }
  .es-sig img { max-width: 100%; height: auto; }
  .es-note { font-size: 11px; color: var(--faint); margin-top: 6px; }
  .es-edit-in .es-row { padding-right: 0; align-items: center; }
  .es-edit-in .es-row input { flex: 1; min-width: 0; font: inherit; font-size: 12px; color: var(--ink); border: 0.5px solid transparent; border-radius: 5px; padding: 3px 6px; margin: -3px 0 -3px -6px; background: none; }
  .es-edit-in .es-row input:hover { border-color: var(--line); }
  .es-edit-in .es-row input:focus, .es-area:focus { outline: none; border-color: var(--gold); background: var(--paper); }
  .es-area { display: block; width: calc(100% + 12px); margin: -4px -6px; font: inherit; font-size: 13px; line-height: 1.5; color: var(--ink); border: 0.5px solid transparent; border-radius: 6px; padding: 4px 6px; background: none; resize: vertical; }
  .es-area:hover { border-color: var(--line); }
  .es-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 6px; }
  .es-compose { margin-top: 8px; }
  .es-compose.busy { opacity: .6; pointer-events: none; }
  .es-compose .cmp-inline { margin: 0; }
`
