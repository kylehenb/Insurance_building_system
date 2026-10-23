'use client'

import React, { useEffect, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import type { DocumentRef } from '@/lib/documents/send/documents'
import { RichTextEditor } from '@/components/email/RichTextEditor'

// Send a document (quote, report, invoice, TCC, photos) by email from the
// job. Auto send emails the standard template as-is; Customise send opens the
// same pre-filled email to edit, and can attach more of the job's documents.
// Mark as sent records it as sent without emailing (sent some other way).
// The documents only change status once the email has gone. Backdrop, × and
// Escape close without sending. Same look as the work order send dialog.

export interface DocumentSendOutcome {
  emailed: boolean
  statusChanges: { description: string }[]
}

export interface SendDocumentModalProps {
  /** The main document first: it picks the email template and recipients */
  documents: DocumentRef[]
  /** Dialog title, e.g. "Send quote" */
  title: string
  /** Offer "Mark as sent without emailing" (what the old Send button did) */
  allowMarkSent?: boolean
  /** What Mark as sent does, shown under the option */
  markSentDescription?: string
  onDone: (outcome: DocumentSendOutcome) => void
  onClose: () => void
}

interface Attachment {
  ref: DocumentRef
  filename: string
  title: string
}

interface Draft {
  to: string
  cc: string
  subject: string
  body: string
  attachments: Attachment[]
  audience: 'insurer' | 'insured'
  templateName: string
  usingBuiltInTemplate: boolean
  warnings: string[]
  otherDocuments: Attachment[]
}

/** The emailed PDF, rendered live, for the attachment link. */
export function documentPdfUrl(ref: DocumentRef): string {
  const q = new URLSearchParams({ kind: ref.kind, id: ref.id })
  if (ref.tcc) for (const [k, v] of Object.entries(ref.tcc)) q.set(k, v)
  if (ref.photoIds?.length) q.set('ids', ref.photoIds.join(','))
  return `/api/documents/pdf?${q.toString()}`
}

const refKey = (ref: DocumentRef) => `${ref.kind}:${ref.id}`

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/documents/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

export function SendDocumentModal({ documents, title, allowMarkSent, markSentDescription, onDone, onClose }: SendDocumentModalProps) {
  const [step, setStep]       = useState<'choose' | 'customise'>('choose')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy]       = useState<null | 'auto' | 'custom' | 'mark_sent'>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])

  // The documents prop is usually built inline; key the load on its contents
  const docsKey = JSON.stringify(documents)
  useEffect(() => {
    let cancelled = false
    post({ mode: 'draft', documents: JSON.parse(docsKey) })
      .then((d: Draft) => {
        if (cancelled) return
        setDraft(d)
        setTo(d.to); setCc(d.cc); setSubject(d.subject); setBody(d.body)
        setAttachments(d.attachments)
      })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [docsKey])

  const sending = busy !== null
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  async function run(mode: 'auto' | 'custom' | 'mark_sent') {
    setBusy(mode)
    setSendError(null)
    try {
      const refs = mode === 'custom' ? attachments.map(a => a.ref) : documents
      const result = await post(mode === 'custom'
        ? { mode, documents: refs, to, cc, subject, body }
        : { mode, documents: refs })
      onDone({ emailed: mode !== 'mark_sent', statusChanges: result.statusChanges ?? [] })
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const hasEmail = !!draft?.to
  const recipientLabel = draft?.audience === 'insured' ? 'the insured' : 'the insurer'
  const attachable = (draft?.otherDocuments ?? []).filter(o => !attachments.some(a => refKey(a.ref) === refKey(o.ref)))

  const optionStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: 6,
    cursor: 'pointer',
  }
  const fieldLabel: React.CSSProperties = {
    display: 'block',
    fontSize: 9,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: '#9a9590',
    marginBottom: 3,
  }
  const input: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 12,
    padding: '6px 8px',
    border: '1px solid #ddd8d0',
    borderRadius: 5,
    background: '#fff',
    color: '#1a1a1a',
  }
  const footerBtn: React.CSSProperties = {
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 500,
    fontFamily: 'DM Sans, sans-serif',
    border: '1px solid #ddd8d0',
    borderRadius: 5,
    background: '#fff',
    color: '#5a5650',
    cursor: 'pointer',
  }
  const chip: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: '#1a1a1a',
    textDecoration: 'none',
    padding: '4px 8px',
    border: '1px solid #ddd8d0',
    borderRadius: 5,
    background: '#faf9f7',
  }

  return (
    <div
      onClick={() => { if (!sending) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,.38)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9600,
        backdropFilter: 'blur(1px)',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: '#fff',
          border: '1px solid #ddd8d0',
          borderRadius: 12,
          width: step === 'customise' ? 600 : 440,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,.14)',
          color: '#1a1a1a',
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
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {step === 'customise' ? `${title} — customise email` : title}
          </span>
          <button
            onClick={onClose}
            disabled={sending}
            title="Close"
            style={{
              width: 26, height: 26,
              border: '1px solid #ddd8d0',
              borderRadius: 5,
              background: 'transparent',
              cursor: sending ? 'default' : 'pointer',
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
        <div style={{ padding: '16px 18px', overflowY: 'auto' }}>
          {loadError ? (
            <p style={{ fontSize: 12, color: '#991b1b', lineHeight: 1.6 }}>{loadError}</p>
          ) : !draft ? (
            <p style={{ fontSize: 12, color: '#9a9590' }}>Preparing email…</p>
          ) : step === 'choose' ? (
            <>
              <p style={{ fontSize: 12, color: '#5a5650', marginBottom: 14, lineHeight: 1.6 }}>
                Email <strong>{draft.attachments.map(a => a.title).join(', ')}</strong> to {recipientLabel}
                {hasEmail ? <> at <strong>{draft.to}</strong></> : null}
                {draft.cc ? <> (cc {draft.cc})</> : null}?
              </p>
              {draft.warnings.length > 0 && (
                <div style={{ fontSize: 11, color: '#92400e', background: '#fef3e2', border: '1px solid #fcd38d', borderRadius: 6, padding: '8px 10px', marginBottom: 12, lineHeight: 1.5 }}>
                  {draft.warnings.map(w => <div key={w}>{w}</div>)}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => run('auto')}
                  disabled={!hasEmail || sending}
                  style={{
                    ...optionStyle,
                    border: '1px solid #1e40af',
                    background: '#1e40af',
                    color: '#fff',
                    opacity: !hasEmail ? 0.45 : 1,
                    cursor: !hasEmail || sending ? 'default' : 'pointer',
                  }}
                  onMouseEnter={e => { if (hasEmail && !sending) e.currentTarget.style.background = '#1d3fad' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1e40af' }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{busy === 'auto' ? 'Sending…' : 'Auto send'}</div>
                  <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
                    Email the PDF using the standard template.
                  </div>
                </button>
                <button
                  onClick={() => setStep('customise')}
                  disabled={sending}
                  style={{ ...optionStyle, border: '1px solid #bfdbfe', background: '#fff', color: '#1e40af' }}
                  onMouseEnter={e => { if (!sending) e.currentTarget.style.background = '#eff6ff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Customise send</div>
                  <div style={{ fontSize: 10, color: '#5a5650', marginTop: 2 }}>
                    Review and edit the recipients, subject and message, or attach more documents, before sending.
                  </div>
                </button>
                {allowMarkSent && (
                  <button
                    onClick={() => run('mark_sent')}
                    disabled={sending}
                    style={{ ...optionStyle, border: '1px solid #ddd8d0', background: '#fff', color: '#3a3530' }}
                    onMouseEnter={e => { if (!sending) e.currentTarget.style.background = '#faf9f7' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{busy === 'mark_sent' ? 'Saving…' : 'Mark as sent without emailing'}</div>
                    <div style={{ fontSize: 10, color: '#5a5650', marginTop: 2 }}>
                      {markSentDescription ?? 'Already sent another way (e.g. the print page or an insurer portal).'}
                    </div>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={fieldLabel}>To</label>
                <input style={input} value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com" disabled={sending} />
              </div>
              <div>
                <label style={fieldLabel}>Cc</label>
                <input style={input} value={cc} onChange={e => setCc(e.target.value)} placeholder="Optional — separate with commas" disabled={sending} />
              </div>
              <div>
                <label style={fieldLabel}>Subject</label>
                <input style={input} value={subject} onChange={e => setSubject(e.target.value)} disabled={sending} />
              </div>
              <div>
                <label style={fieldLabel}>Message</label>
                <RichTextEditor value={body} onChange={setBody} disabled={sending} minHeight={200} />
                {body.includes('{signature}') && (
                  <div style={{ fontSize: 10, color: 'var(--body-soft)', marginTop: 4 }}>
                    {'{signature}'} is replaced by your email signature when sent.
                  </div>
                )}
              </div>
              <div>
                <label style={fieldLabel}>Attachments</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {attachments.map((a, i) => (
                    <span key={refKey(a.ref)} style={{ ...chip, paddingRight: i === 0 ? 8 : 4 }}>
                      <a
                        href={documentPdfUrl(a.ref)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Preview the PDF exactly as it will be sent"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none' }}
                      >
                        <Paperclip size={12} />
                        {a.filename || a.title}
                      </a>
                      {i > 0 && (
                        <button
                          onClick={() => setAttachments(list => list.filter(x => refKey(x.ref) !== refKey(a.ref)))}
                          disabled={sending}
                          title="Remove"
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9a9590', display: 'flex', padding: 0 }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {attachable.length > 0 && (
                  <select
                    value=""
                    onChange={e => {
                      const pick = attachable.find(o => refKey(o.ref) === e.target.value)
                      if (pick) setAttachments(list => [...list, pick])
                    }}
                    disabled={sending}
                    style={{ ...input, width: 'auto', marginTop: 6, fontSize: 11, padding: '4px 6px', color: '#5a5650' }}
                  >
                    <option value="">+ Attach another document…</option>
                    {attachable.map(o => <option key={refKey(o.ref)} value={refKey(o.ref)}>{o.title}</option>)}
                  </select>
                )}
              </div>
              <p style={{ fontSize: 10, color: '#9a9590', lineHeight: 1.5 }}>
                Changes here apply to this email only. Edit the standard wording in Settings → Email Templates
                {draft.usingBuiltInTemplate ? ' (this is the built-in default until you save one)' : ` (${draft.templateName})`}.
              </p>
            </div>
          )}

          {sendError && (
            <p style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 10px', marginTop: 12, lineHeight: 1.5 }}>
              {sendError}
            </p>
          )}
          {busy && busy !== 'mark_sent' && (
            <p style={{ fontSize: 10, color: '#9a9590', marginTop: 10 }}>Creating the PDF and sending — this can take a few seconds.</p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #e8e4de',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          {step === 'customise' ? (
            <>
              <button onClick={() => { setStep('choose'); setSendError(null) }} disabled={sending} style={footerBtn}>
                Back
              </button>
              <button
                onClick={() => run('custom')}
                disabled={sending || !to.trim() || !subject.trim()}
                style={{
                  ...footerBtn,
                  fontWeight: 600,
                  background: '#1e40af',
                  borderColor: '#1e40af',
                  color: '#fff',
                  opacity: !to.trim() || !subject.trim() ? 0.45 : 1,
                  cursor: sending || !to.trim() || !subject.trim() ? 'default' : 'pointer',
                }}
              >
                {busy === 'custom' ? 'Sending…' : 'Send'}
              </button>
            </>
          ) : (
            <button onClick={onClose} disabled={sending} style={footerBtn}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
