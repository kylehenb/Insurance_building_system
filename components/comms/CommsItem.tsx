'use client'

import { useState } from 'react'
import type { Json } from '@/lib/supabase/database.types'

export type Comm = {
  id: string
  type: string
  direction: string | null
  contact_type: string | null
  contact_name: string | null
  contact_detail: string | null
  subject: string | null
  content: string | null
  attachments: Json
  requires_action: boolean | null
  created_at: string | null
  from_email: string | null
  to_email: string | null
  gmail_message_id: string | null
  persona: string | null
  source: string | null
}

const TYPE_STYLES: Record<string, { bg: string; color: string }> = {
  email:  { bg: '#e8f0fe', color: '#1a73e8' },
  sms:    { bg: '#e8f5e9', color: '#2e7d32' },
  note:   { bg: '#fff3e0', color: '#b45309' },
  system: { bg: '#f3e8ff', color: '#7c3aed' },
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  const diff = Date.now() - new Date(s).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function DirectionIcon({ direction, type }: { direction: string | null; type: string }) {
  if (type === 'note')   return <span style={{ fontSize: 12, color: '#c8b89a' }}>✎</span>
  if (type === 'system') return <span style={{ fontSize: 12, color: '#9e998f' }}>⚙</span>
  if (direction === 'inbound')  return <span style={{ fontSize: 13, color: '#2e7d32', fontWeight: 700 }} title="Inbound">↙</span>
  if (direction === 'outbound') return <span style={{ fontSize: 13, color: '#1a73e8', fontWeight: 700 }} title="Outbound">↗</span>
  return null
}

function parseAttachments(raw: Json): string[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<Record<string, unknown>>)
    .map(a =>
      typeof a.filename === 'string' ? a.filename
      : typeof a.name === 'string' ? a.name
      : null
    )
    .filter((n): n is string => n !== null)
}

// ── Reply modal ────────────────────────────────────────────────────────────

function ReplyModal({
  comm,
  onClose,
  onSent,
}: {
  comm: Comm
  onClose: () => void
  onSent: () => void
}) {
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const replySubject = comm.subject
    ? comm.subject.toLowerCase().startsWith('re:')
      ? comm.subject
      : `Re: ${comm.subject}`
    : 'Re: (no subject)'

  async function handleSend() {
    if (!replyBody.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/communications/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commId: comm.id, body: replyBody }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Send failed')
        return
      }
      onSent()
      onClose()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSending(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,12,10,0.55)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          width: 580,
          maxWidth: '92vw',
          border: '0.5px solid #e4dfd8',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '80vh',
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '0.5px solid #f0ece6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fdfdfc',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Reply</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#b0a898',
              fontSize: 20,
              lineHeight: 1,
              padding: 0,
            }}
          >
            &times;
          </button>
        </div>

        {/* To field — read-only */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '0.5px solid #f5f2ee',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: '#b0a898',
              fontWeight: 500,
              padding: '9px 14px',
              minWidth: 60,
              letterSpacing: '0.5px',
              flexShrink: 0,
              textTransform: 'uppercase',
            }}
          >
            To
          </span>
          <span
            style={{
              flex: 1,
              padding: '9px 10px 9px 0',
              fontSize: 13,
              color: '#3a3530',
              fontWeight: 300,
            }}
          >
            {comm.from_email}
          </span>
        </div>

        {/* Subject field — read-only */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '0.5px solid #f5f2ee',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: '#b0a898',
              fontWeight: 500,
              padding: '9px 14px',
              minWidth: 60,
              letterSpacing: '0.5px',
              flexShrink: 0,
              textTransform: 'uppercase',
            }}
          >
            Subject
          </span>
          <span
            style={{
              flex: 1,
              padding: '9px 10px 9px 0',
              fontSize: 13,
              color: '#3a3530',
              fontWeight: 300,
            }}
          >
            {replySubject}
          </span>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <textarea
            value={replyBody}
            onChange={e => setReplyBody(e.target.value)}
            placeholder="Write your reply…"
            style={{
              flex: 1,
              width: '100%',
              border: 'none',
              padding: '16px 20px',
              fontSize: 13,
              color: '#1a1a1a',
              fontFamily: 'DM Sans, sans-serif',
              fontWeight: 300,
              resize: 'none',
              outline: 'none',
              lineHeight: 1.75,
              minHeight: 180,
              background: '#fff',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '0.5px solid #f0ece6',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: '#fdfdfc',
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleSend}
            disabled={sending || !replyBody.trim()}
            style={{
              fontSize: 11,
              padding: '5px 18px',
              borderRadius: 20,
              cursor: sending || !replyBody.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              border: '1px solid transparent',
              background: '#2a6b50',
              color: '#fff',
              borderColor: '#2a6b50',
              opacity: sending || !replyBody.trim() ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button
            onClick={onClose}
            disabled={sending}
            style={{
              fontSize: 11,
              padding: '5px 14px',
              borderRadius: 20,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              border: '0.5px solid #d4cfc8',
              background: 'transparent',
              color: '#7a6a58',
            }}
          >
            Cancel
          </button>
          {error && (
            <span style={{ fontSize: 11, color: '#b91c1c', marginLeft: 4 }}>{error}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CommsItem ──────────────────────────────────────────────────────────────

export function CommsItem({
  comm,
  onReplySent,
}: {
  comm: Comm
  onReplySent?: () => void
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const typeStyle = TYPE_STYLES[comm.type] ?? { bg: '#f5f2ee', color: '#9e998f' }
  const filenames = parseAttachments(comm.attachments)

  return (
    <>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '0.5px solid #f0ece6',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {/* Type badge */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              background: typeStyle.bg,
              color: typeStyle.color,
              borderRadius: 4,
              padding: '2px 6px',
              flexShrink: 0,
            }}
          >
            {comm.type}
          </span>

          {/* Direction icon */}
          <DirectionIcon direction={comm.direction} type={comm.type} />

          {/* Contact name */}
          {comm.contact_name && (
            <span style={{ fontSize: 12, fontWeight: 500, color: '#3a3530' }}>
              {comm.contact_name}
            </span>
          )}

          {/* Contact type */}
          {comm.contact_type && (
            <span style={{ fontSize: 10, color: '#b0a898' }}>({comm.contact_type})</span>
          )}

          {/* requires_action badge */}
          {comm.requires_action && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                background: '#fdecea',
                color: '#b91c1c',
                borderRadius: 4,
                padding: '2px 6px',
                marginLeft: 'auto',
                flexShrink: 0,
              }}
            >
              Action needed
            </span>
          )}

          {/* Timestamp */}
          <span
            style={{
              fontSize: 10,
              color: '#c8c0b8',
              marginLeft: comm.requires_action ? 4 : 'auto',
              fontFamily: 'DM Mono, monospace',
              flexShrink: 0,
            }}
          >
            {formatDate(comm.created_at)}
          </span>
        </div>

        {/* Subject (email only) */}
        {comm.type === 'email' && comm.subject && (
          <div style={{ fontSize: 12, fontWeight: 500, color: '#1a1a1a', lineHeight: 1.3 }}>
            {comm.subject}
          </div>
        )}

        {/* Content */}
        {comm.content && (
          <div
            style={{
              fontSize: 12,
              color: '#5a534a',
              lineHeight: 1.6,
              fontWeight: 300,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {comm.content}
          </div>
        )}

        {/* Attachment filenames */}
        {filenames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {filenames.map((name, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  color: '#7a6a58',
                  background: '#f5f2ee',
                  border: '0.5px solid #e4dfd8',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontFamily: 'DM Mono, monospace',
                }}
              >
                📎 {name}
              </span>
            ))}
          </div>
        )}

        {/* Reply action — email rows only */}
        {comm.type === 'email' && comm.from_email && (
          <div style={{ marginTop: 4 }}>
            <button
              onClick={() => setReplyOpen(true)}
              style={{
                fontSize: 11,
                color: '#1a73e8',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            >
              ↩ Reply
            </button>
          </div>
        )}
      </div>

      {replyOpen && (
        <ReplyModal
          comm={comm}
          onClose={() => setReplyOpen(false)}
          onSent={() => { onReplySent?.() }}
        />
      )}
    </>
  )
}
