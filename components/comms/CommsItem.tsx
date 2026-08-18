'use client'

import { useState } from 'react'
import type { Json } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Comm = {
  id: string
  type: string
  direction: string | null
  contact_type: string | null
  contact_name: string | null
  contact_detail: string | null
  subject: string | null
  content: string | null
  body_text: string | null
  attachments: Json | null
  requires_action: boolean | null
  action_queue_id: string | null
  created_at: string | null
  from_email: string | null
  to_email: string | null
  gmail_message_id: string | null
  thread_id: string | null
  work_order_id: string | null
  persona: string | null
  source: string | null
  read_at: string | null
  is_starred: boolean
}

export type DisplayItem =
  | { kind: 'single'; comm: Comm }
  | { kind: 'thread'; threadId: string; comms: Comm[]; latest: Comm }
  | { kind: 'sysgroup'; comms: Comm[]; workOrderId: string | null }

// ── Visual constants ──────────────────────────────────────────────────────────

const TYPE_BORDER: Record<string, string> = {
  email:  '#b9cdf3',
  sms:    '#b3ddc0',
  phone:  '#d3c3ec',
  note:   '#ecdba8',
  portal: '#e3ded1',
  system: '#e3ded1',
}

const TYPE_ICON: Record<string, string> = {
  email:  '✉',
  sms:    '💬',
  phone:  '☎',
  note:   '📝',
  portal: '⚙',
  system: '⚙',
}

const TYPE_BADGE_STYLE: Record<string, React.CSSProperties> = {
  email:  { background: '#eef1fb', color: '#4a6fd4' },
  sms:    { background: '#eaf5ee', color: '#3f8a5c' },
  phone:  { background: '#f1ecfa', color: '#7c5cbf' },
  note:   { background: '#f8f2e3', color: '#8a6d2e' },
  portal: { background: '#f7f5ee', color: '#8a8272' },
  system: { background: '#f7f5ee', color: '#8a8272' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isUnreadComm(c: Comm): boolean {
  return !c.read_at && c.direction === 'inbound' && c.type !== 'portal' && c.type !== 'system'
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function formatFullDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

type ParsedAttachment = { filename: string; storage_path: string | null }

function parseAttachments(raw: Json | null): ParsedAttachment[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<Record<string, unknown>>)
    .map(a => ({
      filename: typeof a.filename === 'string' ? a.filename : typeof a.name === 'string' ? a.name : null,
      storage_path: typeof a.storage_path === 'string' ? a.storage_path : null,
    }))
    .filter((a): a is ParsedAttachment => a.filename !== null)
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function StarBtn({ starred, onToggle }: { starred: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle() }}
      title={starred ? 'Unstar' : 'Star'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 15,
        color: starred ? '#c9973a' : '#e6dfd0',
        padding: '0 2px',
        flexShrink: 0,
        lineHeight: 1,
        order: -10,
      }}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}

function AttachmentChips({ raw, commId }: { raw: Json | null; commId: string }) {
  const [chipStates, setChipStates] = useState<Record<number, 'loading' | 'error'>>({})
  const attachments = parseAttachments(raw)
  if (attachments.length === 0) return null

  async function handleClick(att: ParsedAttachment, idx: number) {
    if (!att.storage_path || chipStates[idx] === 'loading') return
    setChipStates(prev => ({ ...prev, [idx]: 'loading' }))
    try {
      const res = await fetch('/api/communications/attachments/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ communicationId: commId, storagePath: att.storage_path }),
      })
      if (!res.ok) { setChipStates(prev => ({ ...prev, [idx]: 'error' })); return }
      const data = await res.json() as { url?: string }
      if (!data.url) { setChipStates(prev => ({ ...prev, [idx]: 'error' })); return }
      setChipStates(prev => { const n = { ...prev }; delete n[idx]; return n })
      window.open(data.url, '_blank')
    } catch {
      setChipStates(prev => ({ ...prev, [idx]: 'error' }))
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
      {attachments.map((att, i) => {
        const s = chipStates[i]
        const clickable = att.storage_path !== null && s !== 'loading'
        return (
          <button
            key={i}
            onClick={clickable ? () => handleClick(att, i) : undefined}
            disabled={!clickable}
            style={{
              fontSize: 10,
              color: s === 'error' ? '#c05a4a' : '#7a6a58',
              background: s === 'error' ? '#fbeeeb' : '#f5f2ee',
              border: `0.5px solid ${s === 'error' ? '#fca5a5' : '#e6dfd0'}`,
              borderRadius: 4,
              padding: '2px 8px',
              fontFamily: 'DM Mono, monospace',
              cursor: clickable ? 'pointer' : 'default',
              opacity: s === 'loading' ? 0.55 : 1,
              display: 'inline-block',
            }}
          >
            {s === 'loading' ? '⏳' : s === 'error' ? '⚠ ' : '📎'} {att.filename}
            {s === 'error' && <span style={{ fontSize: 9, marginLeft: 4 }}>retry</span>}
          </button>
        )
      })}
    </div>
  )
}

function ReplyModal({ comm, onClose, onSent }: { comm: Comm; onClose: () => void; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const replySubject = comm.subject
    ? comm.subject.toLowerCase().startsWith('re:') ? comm.subject : `Re: ${comm.subject}`
    : 'Re: (no subject)'

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/communications/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commId: comm.id, body }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Send failed')
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

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,12,10,.55)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 10, width: 580, maxWidth: '92vw',
        border: '0.5px solid #e6dfd0', overflow: 'hidden', display: 'flex',
        flexDirection: 'column', maxHeight: '80vh', fontFamily: 'DM Sans, sans-serif',
      }}>
        <div style={{
          padding: '14px 20px', borderBottom: '0.5px solid #f0ece6',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#fdfdfc', flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Reply</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b0a898', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        {[
          { label: 'To', value: comm.from_email ?? '' },
          { label: 'Subject', value: replySubject },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', borderBottom: '0.5px solid #f5f2ee', flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: '#b0a898', fontWeight: 500, padding: '9px 14px', minWidth: 60, letterSpacing: '.5px', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ flex: 1, padding: '9px 10px 9px 0', fontSize: 13, color: '#3a3530', fontWeight: 300 }}>{value}</span>
          </div>
        ))}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your reply…"
            style={{
              flex: 1, width: '100%', border: 'none', padding: '16px 20px',
              fontSize: 13, color: '#1a1a1a', fontFamily: 'DM Sans, sans-serif',
              fontWeight: 300, resize: 'none', outline: 'none', lineHeight: 1.75,
              minHeight: 180, background: '#fff', boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>
        <div style={{
          padding: '12px 20px', borderTop: '0.5px solid #f0ece6',
          display: 'flex', gap: 8, alignItems: 'center', background: '#fdfdfc', flexShrink: 0,
        }}>
          <button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            style={{
              fontSize: 11, padding: '5px 18px', borderRadius: 20,
              cursor: sending || !body.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontWeight: 600, border: '1px solid transparent',
              background: '#2a6b50', color: '#fff', borderColor: '#2a6b50',
              opacity: sending || !body.trim() ? 0.5 : 1,
            }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button onClick={onClose} disabled={sending} style={{ fontSize: 11, padding: '5px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, border: '0.5px solid #d4cfc8', background: 'transparent', color: '#7a6a58' }}>
            Cancel
          </button>
          {error && <span style={{ fontSize: 11, color: '#c05a4a', marginLeft: 4 }}>{error}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Collapsed row shell (shared across all item kinds) ───────────────────────

interface RowShellProps {
  type: string
  isUnread: boolean
  isStarred: boolean
  expanded: boolean
  onToggleStar: () => void
  onClick: () => void
  gistSlot: React.ReactNode
  rightSlot?: React.ReactNode
  time: string | null
}

function RowShell({ type, isUnread, isStarred, expanded, onToggleStar, onClick, gistSlot, rightSlot, time }: RowShellProps) {
  const borderColor = TYPE_BORDER[type] ?? '#e3ded1'
  const isSysStyle = type === 'portal' || type === 'system'
  const bg = (!isSysStyle && isUnread) ? '#ffffff' : '#f7f5ee'

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        borderLeft: `9px solid ${borderColor}`,
        background: bg,
        userSelect: 'none',
      }}
    >
      <StarBtn starred={isStarred} onToggle={onToggleStar} />
      <span style={{ width: 16, textAlign: 'center', fontSize: 12, flexShrink: 0, color: isSysStyle ? '#b7b0a0' : '#8a8272' }}>
        {TYPE_ICON[type] ?? '•'}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
        {gistSlot}
      </div>
      {rightSlot}
      <span style={{ width: 48, flexShrink: 0, fontSize: 11, color: isUnread ? '#8a8272' : '#b7b0a0', textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
        {formatTime(time)}
      </span>
      <span style={{
        color: '#b7b0a0', fontSize: 10, flexShrink: 0,
        transform: expanded ? 'rotate(90deg)' : 'none',
        display: 'inline-block', transition: 'transform .15s',
      }}>▶</span>
    </div>
  )
}

// ── Expanded detail shell ─────────────────────────────────────────────────────

function DetailShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 16px 16px 52px', background: '#fff' }}>
      {children}
    </div>
  )
}

function BadgeRow({ type, direction }: { type: string; direction: string | null }) {
  const style = TYPE_BADGE_STYLE[type] ?? { background: '#f5f2ee', color: '#8a8272' }
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, ...style }}>
        {label}
      </span>
      {direction && (
        <span style={{ fontSize: 11, color: '#8a8272' }}>
          {direction === 'inbound' ? '↙ Inbound' : '↗ Outbound'}
        </span>
      )}
    </div>
  )
}

// ── Single comm item ──────────────────────────────────────────────────────────

interface SingleItemProps {
  comm: Comm
  onMarkRead: (ids: string[]) => void
  onToggleStar: (id: string, starred: boolean) => void
  onReplySent: () => void
}

function SingleItem({ comm, onMarkRead, onToggleStar, onReplySent }: SingleItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const unread = isUnreadComm(comm)

  function handleExpand() {
    const next = !expanded
    setExpanded(next)
    if (next && unread) onMarkRead([comm.id])
  }

  const gist = (
    <>
      <span style={{
        fontWeight: unread ? 800 : 600,
        fontSize: 12.5,
        flexShrink: 0,
        color: unread ? '#1b1712' : '#57503f',
        whiteSpace: 'nowrap',
      }}>
        {comm.contact_name ?? comm.from_email ?? 'Unknown'}
      </span>
      <span style={{
        fontSize: 12.5,
        color: (comm.type === 'portal' || comm.type === 'system') ? '#b7b0a0' : (unread ? '#1b1712' : '#847c6a'),
        fontWeight: unread ? 600 : 400,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {comm.type === 'email' && comm.subject ? `— ${comm.subject}` : comm.content ? `— ${comm.content}` : ''}
      </span>
    </>
  )

  const rightSlot = (
    <>
      {comm.requires_action && (
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px',
          borderRadius: 10, background: '#fbeeeb', color: '#c05a4a', flexShrink: 0,
        }}>
          Needs response
        </span>
      )}
    </>
  )

  return (
    <div style={{ borderBottom: '0.5px solid #f0ece6' }}>
      <RowShell
        type={comm.type}
        isUnread={unread}
        isStarred={comm.is_starred}
        expanded={expanded}
        onToggleStar={() => onToggleStar(comm.id, !comm.is_starred)}
        onClick={handleExpand}
        gistSlot={gist}
        rightSlot={rightSlot}
        time={comm.created_at}
      />

      {expanded && (
        <DetailShell>
          {comm.requires_action && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, background: '#fbeeeb', color: '#c05a4a',
              fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 8, marginBottom: 10,
            }}>
              ⚑ Flagged for response
              {comm.action_queue_id && (
                <span style={{ marginLeft: 'auto', fontSize: 11, textDecoration: 'underline', cursor: 'pointer' }}>
                  Open action card →
                </span>
              )}
            </div>
          )}

          <BadgeRow type={comm.type} direction={comm.direction} />

          {(comm.contact_name || comm.contact_type) && (
            <div style={{ fontSize: 11.5, color: '#8a8272', marginBottom: 8 }}>
              {comm.contact_name}{comm.contact_type ? ` · ${comm.contact_type}` : ''}
            </div>
          )}

          {comm.type === 'email' && (comm.from_email || comm.to_email) && (
            <div style={{ marginBottom: 10, padding: '9px 12px', background: '#faf8f3', border: '0.5px solid #e6dfd0', borderRadius: 8, fontSize: 12, color: '#555', lineHeight: 1.8 }}>
              {comm.from_email && <div><span style={{ color: '#8a8272', display: 'inline-block', width: 60 }}>From</span>{comm.from_email}</div>}
              {comm.to_email && <div><span style={{ color: '#8a8272', display: 'inline-block', width: 60 }}>To</span>{comm.to_email}</div>}
              <div><span style={{ color: '#8a8272', display: 'inline-block', width: 60 }}>Date</span>{formatFullDate(comm.created_at)}</div>
            </div>
          )}

          {comm.type === 'email' && comm.subject && (
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#1b1712' }}>
              {comm.subject}
            </div>
          )}

          {(comm.body_text || comm.content) && (
            <div style={{ fontSize: 13, color: '#3a352c', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: 300 }}>
              {comm.body_text ?? comm.content}
            </div>
          )}

          <AttachmentChips raw={comm.attachments} commId={comm.id} />

          {comm.type === 'email' && comm.from_email && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                onClick={e => { e.stopPropagation(); setReplyOpen(true) }}
                style={{
                  fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 6,
                  cursor: 'pointer', border: '1px solid #4a6fd4', background: '#fff',
                  color: '#4a6fd4', fontFamily: 'inherit',
                }}
              >
                ↩ Reply
              </button>
            </div>
          )}
        </DetailShell>
      )}

      {replyOpen && (
        <ReplyModal comm={comm} onClose={() => setReplyOpen(false)} onSent={() => { onReplySent(); setReplyOpen(false) }} />
      )}
    </div>
  )
}

// ── Thread item ───────────────────────────────────────────────────────────────

interface ThreadItemProps {
  threadId: string
  comms: Comm[]
  latest: Comm
  onMarkRead: (ids: string[]) => void
  onToggleStar: (id: string, starred: boolean) => void
  onReplySent: () => void
}

function ThreadItem({ comms, latest, onMarkRead, onToggleStar, onReplySent }: ThreadItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const hasUnread = comms.some(isUnreadComm)
  const isStarred = comms.some(c => c.is_starred)

  function handleExpand() {
    const next = !expanded
    setExpanded(next)
    if (next && hasUnread) {
      onMarkRead(comms.filter(isUnreadComm).map(c => c.id))
    }
  }

  const gist = (
    <>
      <span style={{ fontWeight: hasUnread ? 800 : 600, fontSize: 12.5, flexShrink: 0, color: hasUnread ? '#1b1712' : '#57503f', whiteSpace: 'nowrap' }}>
        {latest.subject ? `Re: ${latest.subject.replace(/^re:\s*/i, '')}` : (latest.contact_name ?? latest.from_email ?? 'Email thread')}
      </span>
      <span style={{ fontSize: 12.5, color: hasUnread ? '#1b1712' : '#847c6a', fontWeight: hasUnread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {comms.map(c => c.content ?? '').filter(Boolean).join(' / ')}
      </span>
    </>
  )

  const rightSlot = (
    <span style={{ fontSize: 11, color: '#8a8272', background: '#faf8f3', padding: '2px 7px', borderRadius: 10, flexShrink: 0, border: '0.5px solid #e6dfd0' }}>
      {comms.length} messages
    </span>
  )

  // For starring: toggle on the latest comm
  function handleToggleStar() {
    onToggleStar(latest.id, !latest.is_starred)
  }

  return (
    <div style={{ borderBottom: '0.5px solid #f0ece6' }}>
      <RowShell
        type="email"
        isUnread={hasUnread}
        isStarred={isStarred}
        expanded={expanded}
        onToggleStar={handleToggleStar}
        onClick={handleExpand}
        gistSlot={gist}
        rightSlot={rightSlot}
        time={latest.created_at}
      />

      {expanded && (
        <DetailShell>
          <BadgeRow type="email" direction={null} />
          <div style={{ borderLeft: '2px solid #e6dfd0', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {comms.map(c => (
              <div key={c.id}>
                <div style={{ fontSize: 11, color: '#8a8272', marginBottom: 3 }}>
                  {formatFullDate(c.created_at)} · {c.from_email ?? c.contact_name ?? 'Unknown'} → {c.to_email ?? '?'}
                </div>
                {c.subject && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1b1712', marginBottom: 3 }}>{c.subject}</div>
                )}
                <div style={{ fontSize: 13, color: '#3a352c', lineHeight: 1.55, fontWeight: 300, whiteSpace: 'pre-wrap' }}>
                  {c.body_text ?? c.content}
                </div>
                <AttachmentChips raw={c.attachments} commId={c.id} />
              </div>
            ))}
          </div>
          {latest.from_email && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={e => { e.stopPropagation(); setReplyOpen(true) }}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid #4a6fd4', background: '#fff', color: '#4a6fd4', fontFamily: 'inherit' }}
              >
                ↩ Reply to thread
              </button>
            </div>
          )}
        </DetailShell>
      )}

      {replyOpen && (
        <ReplyModal comm={latest} onClose={() => setReplyOpen(false)} onSent={() => { onReplySent(); setReplyOpen(false) }} />
      )}
    </div>
  )
}

// ── SysGroup item ─────────────────────────────────────────────────────────────

function SysGroupItem({ comms }: { comms: Comm[] }) {
  const [expanded, setExpanded] = useState(false)
  const latest = comms[comms.length - 1]

  const gist = (
    <span style={{ fontSize: 12.5, color: '#b7b0a0', fontStyle: 'italic' }}>
      {comms.length} automated updates
      {comms[0].work_order_id ? ' · work order' : ''}
    </span>
  )

  return (
    <div style={{ borderBottom: '0.5px solid #f0ece6' }}>
      <RowShell
        type={comms[0].type}
        isUnread={false}
        isStarred={false}
        expanded={expanded}
        onToggleStar={() => {}}
        onClick={() => setExpanded(v => !v)}
        gistSlot={gist}
        time={latest.created_at}
      />

      {expanded && (
        <DetailShell>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {comms.map(c => (
              <div key={c.id} style={{ fontSize: 12.5, lineHeight: 1.6, color: '#57503f' }}>
                <span style={{ color: '#8a8272', fontFamily: 'DM Mono, monospace', fontSize: 11, marginRight: 8 }}>
                  {c.created_at ? new Date(c.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
                <span style={{ fontWeight: 600 }}>{c.content ?? c.type}</span>
                {c.work_order_id && <span style={{ color: '#b7b0a0', fontSize: 11, marginLeft: 8 }}>· work order</span>}
              </div>
            ))}
          </div>
        </DetailShell>
      )}
    </div>
  )
}

// ── Public export ─────────────────────────────────────────────────────────────

interface CommsItemProps {
  item: DisplayItem
  onMarkRead: (ids: string[]) => void
  onToggleStar: (id: string, starred: boolean) => void
  onReplySent: () => void
}

export function CommsItem({ item, onMarkRead, onToggleStar, onReplySent }: CommsItemProps) {
  if (item.kind === 'single') {
    return (
      <SingleItem
        comm={item.comm}
        onMarkRead={onMarkRead}
        onToggleStar={onToggleStar}
        onReplySent={onReplySent}
      />
    )
  }
  if (item.kind === 'thread') {
    return (
      <ThreadItem
        threadId={item.threadId}
        comms={item.comms}
        latest={item.latest}
        onMarkRead={onMarkRead}
        onToggleStar={onToggleStar}
        onReplySent={onReplySent}
      />
    )
  }
  return <SysGroupItem comms={item.comms} />
}
