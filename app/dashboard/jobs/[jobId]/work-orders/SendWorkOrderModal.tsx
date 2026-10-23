'use client'

import React, { useEffect, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { type WorkOrderWithDetails } from './types'
import { RichTextEditor } from '@/components/email/RichTextEditor'
import { isPendingApproval, responseError } from '@/lib/approvals/client'
import { ApprovalNotice } from '@/components/approvals/approval-notice'

export interface SendWorkOrderModalProps {
  workOrder: WorkOrderWithDetails
  onSent:    () => void
  onClose:   () => void
}

interface Draft {
  to: string
  cc: string
  subject: string
  body: string
  attachmentName: string
  photos: { count: number; attachmentName: string; jobId: string } | null
  tradeName: string | null
  templateName: string
  usingBuiltInTemplate: boolean
}

// Send & Lock: Auto send emails the template as-is; Customise send opens the
// same pre-filled email for editing first. The job's photos PDF is attached by
// default (Customise send can leave it off). Either way the work order locks
// only once the email has gone. Backdrop, × and Escape close without sending.
export function SendWorkOrderModal({ workOrder, onSent, onClose }: SendWorkOrderModalProps) {
  const [step, setStep]       = useState<'choose' | 'customise'>('choose')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [includePhotos, setIncludePhotos] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/work-orders/${workOrder.id}/send`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to load email')
        return data as Draft
      })
      .then(d => {
        if (cancelled) return
        setDraft(d)
        setTo(d.to); setCc(d.cc); setSubject(d.subject); setBody(d.body)
      })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [workOrder.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  async function send(mode: 'auto' | 'custom') {
    setSending(true)
    setSendError(null)
    setPending(null)
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'auto' ? { mode } : { mode, to, cc, subject, body, includePhotos }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw responseError(data, 'Failed to send work order')
      onSent()
    } catch (err) {
      if (isPendingApproval(err)) setPending(err.message)
      else setSendError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }

  const label      = workOrder.tradeTypeLabel || workOrder.work_type
  const contractor = workOrder.trade?.business_name
  const hasEmail   = !!draft?.to

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
        zIndex: 200,
        backdropFilter: 'blur(1px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send work order"
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line-strong)',
          borderRadius: 12,
          width: step === 'customise' ? 600 : 420,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,.14)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--line-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {step === 'customise' ? 'Customise work order email' : 'Send work order'}
          </span>
          <button
            onClick={onClose}
            disabled={sending}
            title="Close"
            style={{
              width: 26, height: 26,
              border: '1px solid var(--line-strong)',
              borderRadius: 5,
              background: 'transparent',
              cursor: sending ? 'default' : 'pointer',
              fontSize: 13,
              color: 'var(--subtle-2)',
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
            <p style={{ fontSize: 12, color: 'var(--danger-dark)', lineHeight: 1.6 }}>{loadError}</p>
          ) : !draft ? (
            <p style={{ fontSize: 12, color: 'var(--subtle-2)' }}>Preparing email…</p>
          ) : step === 'choose' ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--body-soft)', marginBottom: 14, lineHeight: 1.6 }}>
                Send the <strong>{label}</strong> work order{contractor ? <> to <strong>{contractor}</strong></> : null}
                {hasEmail ? <> at <strong>{draft.to}</strong></> : null}
                {draft.photos ? <>, with the job&apos;s {draft.photos.count} photo{draft.photos.count === 1 ? '' : 's'} attached</> : null}? Once sent, the work order locks and its scope items become read-only.
              </p>
              {!hasEmail && (
                <p style={{ fontSize: 11, color: 'var(--warning-dark)', background: 'var(--warning-bg)', border: '1px solid var(--warning-soft)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, lineHeight: 1.5 }}>
                  This trade has no email address. Use Customise send to enter one, or add it to the trade first.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => send('auto')}
                  disabled={!hasEmail || sending}
                  style={{
                    ...optionStyle,
                    border: '1px solid var(--info-dark)',
                    background: 'var(--info-dark)',
                    color: 'var(--paper)',
                    opacity: !hasEmail ? 0.45 : 1,
                    cursor: !hasEmail || sending ? 'default' : 'pointer',
                  }}
                  onMouseEnter={e => { if (hasEmail && !sending) e.currentTarget.style.background = '#1d3fad' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--info-dark)' }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{sending ? 'Sending…' : 'Auto send'}</div>
                  <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
                    Email the work order PDF to the trade using the standard template.
                  </div>
                </button>
                <button
                  onClick={() => setStep('customise')}
                  disabled={sending}
                  style={{ ...optionStyle, border: '1px solid #bfdbfe', background: 'var(--paper)', color: 'var(--info-dark)' }}
                  onMouseEnter={e => { if (!sending) e.currentTarget.style.background = '#eff6ff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--paper)' }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Customise send</div>
                  <div style={{ fontSize: 10, color: 'var(--body-soft)', marginTop: 2 }}>
                    Review and edit the recipient, subject and message before sending.
                  </div>
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={fieldLabel}>To</label>
                <input style={input} value={to} onChange={e => setTo(e.target.value)} placeholder="trade@example.com" disabled={sending} />
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
                <RichTextEditor value={body} onChange={setBody} disabled={sending} minHeight={220} />
                {body.includes('{signature}') && (
                  <div style={{ fontSize: 10, color: 'var(--body-soft)', marginTop: 4 }}>
                    {'{signature}'} is replaced by your email signature when sent.
                  </div>
                )}
              </div>
              <div>
                <label style={fieldLabel}>{draft.photos ? 'Attachments' : 'Attachment'}</label>
                <a
                  href={`/api/work-orders/${workOrder.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Preview the PDF (the DRAFT watermark is removed on the copy that is sent)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink)', textDecoration: 'none', padding: '4px 8px', border: '1px solid var(--line-strong)', borderRadius: 5, background: 'var(--surface-3)' }}
                >
                  <Paperclip size={12} />
                  {draft.attachmentName}
                </a>
                {draft.photos && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={includePhotos}
                      onChange={e => setIncludePhotos(e.target.checked)}
                      disabled={sending}
                      title="Attach the job's photos"
                      style={{ margin: 0 }}
                    />
                    <a
                      href={`/api/documents/pdf?kind=photos&id=${draft.photos.jobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Preview the photos PDF"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink)', textDecoration: 'none', padding: '4px 8px', border: '1px solid var(--line-strong)', borderRadius: 5, background: 'var(--surface-3)', opacity: includePhotos ? 1 : 0.45 }}
                    >
                      <Paperclip size={12} />
                      {draft.photos.attachmentName} ({draft.photos.count} photo{draft.photos.count === 1 ? '' : 's'})
                    </a>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 10, color: 'var(--subtle-2)', lineHeight: 1.5 }}>
                Changes here apply to this email only. Edit the standard wording in Settings → Email Templates.
              </p>
            </div>
          )}

          {pending && <ApprovalNotice message={pending} style={{ marginTop: 12 }} />}
          {sendError && (
            <p style={{ fontSize: 11, color: 'var(--danger-dark)', background: 'var(--danger-bg-3)', border: '1px solid var(--danger-soft)', borderRadius: 6, padding: '8px 10px', marginTop: 12, lineHeight: 1.5 }}>
              {sendError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line-4)',
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
                onClick={() => send('custom')}
                disabled={sending || !to.trim() || !subject.trim()}
                style={{
                  ...footerBtn,
                  fontWeight: 600,
                  background: 'var(--info-dark)',
                  borderColor: 'var(--info-dark)',
                  color: 'var(--paper)',
                  opacity: !to.trim() || !subject.trim() ? 0.45 : 1,
                  cursor: sending || !to.trim() || !subject.trim() ? 'default' : 'pointer',
                }}
              >
                {sending ? 'Sending…' : 'Send & Lock'}
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
