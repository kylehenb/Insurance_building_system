'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { MessageBody } from '@/components/mail/MessageBody'
import { attachmentUrl, type MailMessage } from '@/lib/mail/message'
import type { MailAddress } from '@/lib/mail/summary'

// The email a card is about, read on the card: the latest message open, the
// earlier ones in the conversation a click away. Loaded only when opened.

type Thread = { messages: MailMessage[] }

const addresses = (list: MailAddress[]) => list.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')
const when = (iso: string | null) => (iso ? format(new Date(iso), 'EEE d MMM yyyy, h:mm a') : '')

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function OriginalEmail({ threadId, onOpenConversation }: { threadId: string; onOpenConversation?(threadId: string): void }) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch(`/api/mail/threads/${threadId}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? 'Could not load the email')
        return body as Thread
      })
      .then(t => {
        if (cancelled) return
        const messages = t.messages.filter(m => !m.labelIds.includes('DRAFT'))
        setThread({ messages })
        setOpen(new Set(messages.slice(-1).map(m => m.id)))
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the email') })
    return () => { cancelled = true }
  }, [threadId])

  if (error) return <div className="oe oe-note is-error">{error}</div>
  if (!thread) return <div className="oe oe-note">Loading the email…</div>

  const toggle = (id: string) => setOpen(o => {
    const next = new Set(o)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="oe">
      {thread.messages.map(m => {
        const isOpen = open.has(m.id)
        const files = m.attachments.filter(a => !a.inline && a.attachmentId)
        return (
          <section key={m.id} className={`oe-msg${isOpen ? ' open' : ''}`}>
            <button type="button" className="oe-head" onClick={() => toggle(m.id)}>
              <span className="oe-from">
                <strong>{m.from?.name || m.from?.email || '(unknown sender)'}</strong>
                {m.from?.name && <span className="oe-email"> &lt;{m.from.email}&gt;</span>}
              </span>
              <span className="oe-date">{when(m.date)}</span>
              {isOpen ? (
                <span className="oe-to">
                  to {addresses(m.to) || '(no recipients)'}{m.cc.length > 0 && <> · cc {addresses(m.cc)}</>}
                </span>
              ) : (
                <span className="oe-snippet">{m.snippet}</span>
              )}
            </button>
            {isOpen && (
              <div className="oe-body">
                <MessageBody html={m.html} text={m.text} sender={m.from?.email ?? ''} />
                {files.length > 0 && (
                  <div className="oe-files">
                    {files.map((a, i) => (
                      <a key={i} href={attachmentUrl(m.id, a)} target="_blank" rel="noreferrer" className="oe-file">
                        📎 {a.filename} <span>{formatSize(a.size)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
      {onOpenConversation && (
        <button type="button" className="ac-link oe-open" onClick={() => onOpenConversation(threadId)}>Open in Mail →</button>
      )}
      <style>{`
        .oe { margin-top: 8px; border: 0.5px solid var(--line-2); border-radius: 8px; background: var(--paper); overflow: hidden; }
        .oe-note { padding: 10px 12px; font-size: 12px; color: var(--subtle); }
        .oe-note.is-error { color: var(--danger-dark); background: var(--danger-bg); }
        .oe-msg + .oe-msg { border-top: 0.5px solid var(--line-faint); }
        .oe-head { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; width: 100%; font: inherit; text-align: left; background: none; border: none; padding: 8px 12px; cursor: pointer; color: var(--ink); }
        .oe-head:hover { background: var(--surface-3); }
        .oe-from { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .oe-email { color: var(--subtle); font-size: 12px; }
        .oe-date { font-size: 11px; color: var(--faint); white-space: nowrap; }
        .oe-to, .oe-snippet { grid-column: 1 / -1; font-size: 12px; color: var(--subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .oe-body { padding: 0 12px 10px; }
        .oe-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .oe-file { font-size: 12px; color: var(--ink); background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 6px; padding: 4px 8px; text-decoration: none; }
        .oe-file span { color: var(--subtle); }
        .oe-open { display: block; padding: 6px 12px 8px; }
      `}</style>
    </div>
  )
}
