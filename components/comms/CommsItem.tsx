'use client'

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

export function CommsItem({ comm }: { comm: Comm }) {
  const typeStyle = TYPE_STYLES[comm.type] ?? { bg: '#f5f2ee', color: '#9e998f' }
  const filenames = parseAttachments(comm.attachments)

  return (
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

        {/* requires_action badge — left-of-timestamp so timestamp stays rightmost */}
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
    </div>
  )
}
