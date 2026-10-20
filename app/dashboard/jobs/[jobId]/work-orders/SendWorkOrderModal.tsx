'use client'

import React, { useEffect, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { type WorkOrderWithDetails } from './types'

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
  tradeName: string | null
  templateName: string
  usingBuiltInTemplate: boolean
}

// Send & Lock: Auto send emails the template as-is; Customise send opens the
// same pre-filled email for editing first. Either way the work order locks
// only once the email has gone. Backdrop, × and Escape close without sending.
export function SendWorkOrderModal({ workOrder, onSent, onClose }: SendWorkOrderModalProps) {
  const [step, setStep]       = useState<'choose' | 'customise'>('choose')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')

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
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'auto' ? { mode } : { mode, to, cc, subject, body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to send work order')
      onSent()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
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
          background: '#fff',
          border: '1px solid #ddd8d0',
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
            borderBottom: '1px solid #e8e4de',
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
                Send the <strong>{label}</strong> work order{contractor ? <> to <strong>{contractor}</strong></> : null}
                {hasEmail ? <> at <strong>{draft.to}</strong></> : null}? Once sent, the work order locks and its scope items become read-only.
              </p>
              {!hasEmail && (
                <p style={{ fontSize: 11, color: '#92400e', background: '#fef3e2', border: '1px solid #fcd38d', borderRadius: 6, padding: '8px 10px', marginBottom: 12, lineHeight: 1.5 }}>
                  This trade has no email address. Use Customise send to enter one, or add it to the trade first.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => send('auto')}
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
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{sending ? 'Sending…' : 'Auto send'}</div>
                  <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
                    Email the work order PDF to the trade using the standard template.
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
                <textarea
                  style={{ ...input, minHeight: 220, resize: 'vertical', lineHeight: 1.5 }}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  disabled={sending}
                />
              </div>
              <div>
                <label style={fieldLabel}>Attachment</label>
                <a
                  href={`/api/work-orders/${workOrder.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Preview the PDF (the DRAFT watermark is removed on the copy that is sent)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#1a1a1a', textDecoration: 'none', padding: '4px 8px', border: '1px solid #ddd8d0', borderRadius: 5, background: '#faf9f7' }}
                >
                  <Paperclip size={12} />
                  {draft.attachmentName}
                </a>
              </div>
              <p style={{ fontSize: 10, color: '#9a9590', lineHeight: 1.5 }}>
                Changes here apply to this email only. Edit the standard wording in Settings → Email Templates.
              </p>
            </div>
          )}

          {sendError && (
            <p style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 10px', marginTop: 12, lineHeight: 1.5 }}>
              {sendError}
            </p>
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
                onClick={() => send('custom')}
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
