'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { format, isThisYear, isToday } from 'date-fns'
import { FOLDERS, SHOWS_RECIPIENTS, type FolderKey, isFolderKey } from '@/lib/mail/folders'
import type { FolderCounts, ThreadDetail, ThreadListItem } from '@/lib/mail/list'
import type { MailAddress } from '@/lib/mail/summary'
import { attachmentUrl, type MailMessage } from '@/lib/mail/message'
import { MessageBody } from '@/components/mail/MessageBody'

// The mail client: the office Gmail mailbox, folder by folder. Gmail is the
// source of truth — this page reads the mirror kept by lib/mail/sync.ts and
// opens conversations straight from Gmail. Read-only for now.

type MailboxInfo = { email: string; synced_at: string | null; sync_error: string | null; backfilling: boolean }

type ListResponse = {
  threads: ThreadListItem[]
  cursor: string | null
  counts: FolderCounts
  mailbox: MailboxInfo
}

const POLL_MS = 20_000

function listDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'h:mm a').toLowerCase()
  if (isThisYear(d)) return format(d, 'd MMM')
  return format(d, 'd/MM/yy')
}

function fullDate(iso: string | null): string {
  return iso ? format(new Date(iso), 'EEE d MMM yyyy, h:mm a') : ''
}

const shortName = (a: MailAddress) => (a.name ? a.name.split(/\s+/)[0] : a.email.split('@')[0])

function senderLine(t: ThreadListItem, folder: FolderKey): string {
  if (SHOWS_RECIPIENTS.includes(folder)) {
    if (t.recipients.length === 0) return '(no recipients)'
    return 'To: ' + t.recipients.slice(0, 3).map(shortName).join(', ')
  }
  const names = t.participants.map(p => (p.me ? 'me' : p.name || p.email))
  if (names.length === 0) return '(unknown sender)'
  if (names.length === 1) return names[0]
  const short = t.participants.map(p => (p.me ? 'me' : shortName(p)))
  return short.length > 3 ? `${short[0]} .. ${short.slice(-2).join(', ')}` : short.join(', ')
}

function addressText(list: MailAddress[]): string {
  return list.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

export default function MailPage() {
  return (
    <Suspense fallback={null}>
      <Mail />
    </Suspense>
  )
}

function Mail() {
  const searchParams = useSearchParams()
  const initialFolder = searchParams.get('folder')
  const [folder, setFolder] = useState<FolderKey>(isFolderKey(initialFolder) ? initialFolder : 'inbox')
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')

  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [counts, setCounts] = useState<FolderCounts>({ inbox: 0, drafts: 0, spam: 0 })
  const [mailbox, setMailbox] = useState<MailboxInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [selected, setSelected] = useState(0)
  const [openId, setOpenId] = useState<string | null>(searchParams.get('thread'))
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const gPressed = useRef(false)
  const requestSeq = useRef(0)

  // Keep the address bar shareable: /dashboard/mail?folder=sent&thread=…
  useEffect(() => {
    const params = new URLSearchParams()
    if (folder !== 'inbox') params.set('folder', folder)
    if (query) params.set('q', query)
    if (openId) params.set('thread', openId)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `/dashboard/mail?${qs}` : '/dashboard/mail')
  }, [folder, query, openId])

  const fetchPage = useCallback(async (pageCursor: string | null): Promise<ListResponse> => {
    const params = new URLSearchParams({ folder })
    if (query) params.set('q', query)
    if (pageCursor) params.set('cursor', pageCursor)
    const res = await fetch(`/api/mail/threads?${params}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? 'Could not load mail')
    return body as ListResponse
  }, [folder, query])

  // First page whenever the folder or search changes
  useEffect(() => {
    const seq = ++requestSeq.current
    setLoading(true)
    setListError(null)
    setThreads([])
    setSelected(0)
    fetchPage(null)
      .then(page => {
        if (seq !== requestSeq.current) return
        setThreads(page.threads)
        setCursor(page.cursor)
        setCounts(page.counts)
        setMailbox(page.mailbox)
      })
      .catch(err => { if (seq === requestSeq.current) setListError(err.message) })
      .finally(() => { if (seq === requestSeq.current) setLoading(false) })
  }, [fetchPage])

  // Refresh the first page while the tab is open, so changes made in Gmail show up
  useEffect(() => {
    if (query) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const seq = requestSeq.current
      fetchPage(null)
        .then(page => {
          if (seq !== requestSeq.current) return
          setThreads(prev => {
            const fresh = new Set(page.threads.map(t => t.id))
            const oldest = page.threads[page.threads.length - 1]?.last_message_at ?? ''
            // Keep any further pages already loaded below the fresh first page
            const tail = page.cursor ? prev.filter(t => !fresh.has(t.id) && (t.last_message_at ?? '') < oldest) : []
            return [...page.threads, ...tail]
          })
          setCounts(page.counts)
          setMailbox(page.mailbox)
        })
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [fetchPage, query])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    const seq = requestSeq.current
    try {
      const page = await fetchPage(cursor)
      if (seq !== requestSeq.current) return
      setThreads(prev => [...prev, ...page.threads.filter(t => !prev.some(p => p.id === t.id))])
      setCursor(page.cursor)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load more')
    } finally {
      setLoadingMore(false)
    }
  }

  // Open conversation
  useEffect(() => {
    if (!openId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    fetch(`/api/mail/threads/${openId}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Could not load conversation')
        return body as ThreadDetail
      })
      .then(d => {
        if (cancelled) return
        setDetail(d)
        // Gmail opens the latest message and any unread ones; earlier ones fold away
        const open = new Set<string>()
        d.messages.forEach((m, i) => {
          if (i === d.messages.length - 1 || m.labelIds.includes('UNREAD')) open.add(m.id)
        })
        setExpanded(open)
      })
      .catch(err => { if (!cancelled) setDetailError(err.message) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [openId])

  function switchFolder(key: FolderKey) {
    setFolder(key)
    setOpenId(null)
    setQuery('')
    setSearchInput('')
  }

  function openThread(index: number) {
    const t = threads[index]
    if (!t) return
    setSelected(index)
    setOpenId(t.id)
  }

  // Gmail keyboard shortcuts: j/k next/previous, o or Enter open, / search,
  // Esc close, g then i/s/d/a/! to jump folders
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (gPressed.current) {
        gPressed.current = false
        const jump: Record<string, FolderKey> = { i: 'inbox', s: 'sent', d: 'drafts', a: 'all', '!': 'spam', t: 'trash' }
        if (jump[e.key]) { e.preventDefault(); switchFolder(jump[e.key]) }
        return
      }
      switch (e.key) {
        case 'g':
          gPressed.current = true
          setTimeout(() => { gPressed.current = false }, 1000)
          break
        case 'j':
        case 'k': {
          e.preventDefault()
          const next = Math.max(0, Math.min(threads.length - 1, selected + (e.key === 'j' ? 1 : -1)))
          if (openId) openThread(next)
          else setSelected(next)
          break
        }
        case 'o':
        case 'Enter':
          e.preventDefault()
          openThread(selected)
          break
        case '/':
          e.preventDefault()
          searchRef.current?.focus()
          break
        case 'Escape':
        case 'u':
          setOpenId(null)
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // Keep the selected row in view
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    setOpenId(null)
    setQuery(searchInput.trim())
  }

  const folderMeta = FOLDERS.find(f => f.key === folder)!
  const countFor = (key: FolderKey) => (key === 'inbox' ? counts.inbox : key === 'drafts' ? counts.drafts : key === 'spam' ? counts.spam : 0)

  return (
    <div className="mail">
      {/* ── Folders ── */}
      <nav className="mail-folders">
        <div className="mail-title">Mail</div>
        {mailbox && <div className="mail-account" title={mailbox.email}>{mailbox.email}</div>}
        {FOLDERS.map(f => {
          const n = countFor(f.key)
          return (
            <button
              key={f.key}
              className={`mail-folder${folder === f.key ? ' active' : ''}${n > 0 && f.key !== 'drafts' ? ' has-unread' : ''}`}
              onClick={() => switchFolder(f.key)}
            >
              <span>{f.label}</span>
              {n > 0 && <span className="mail-count">{n}</span>}
            </button>
          )
        })}
        <div className="mail-hint">
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>o</kbd> open · <kbd>/</kbd> search · <kbd>g</kbd> <kbd>i</kbd> inbox
        </div>
      </nav>

      {/* ── Conversation list ── */}
      <section className="mail-list-col">
        <form className="mail-search" onSubmit={submitSearch}>
          <input
            ref={searchRef}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={`Search ${folderMeta.label.toLowerCase()} — Gmail search works (from:, has:attachment, older_than:)`}
          />
          {query && (
            <button type="button" className="mail-search-clear" onClick={() => { setQuery(''); setSearchInput('') }}>
              Clear
            </button>
          )}
        </form>

        {mailbox?.backfilling && (
          <div className="mail-banner">Copying your mailbox from Gmail for the first time — folders fill in over the next few minutes.</div>
        )}
        {mailbox?.sync_error && (
          <div className="mail-banner is-error">Last sync with Gmail failed: {mailbox.sync_error}</div>
        )}

        <div className="mail-list" ref={listRef}>
          {loading && <div className="mail-empty">Loading…</div>}
          {!loading && listError && <div className="mail-empty is-error">{listError}</div>}
          {!loading && !listError && threads.length === 0 && (
            <div className="mail-empty">{query ? 'No conversations match your search.' : `Nothing in ${folderMeta.label}.`}</div>
          )}
          {threads.map((t, i) => {
            const isDraft = t.label_ids.includes('DRAFT')
            return (
              <div
                key={t.id}
                data-index={i}
                className={`mail-row${t.unread ? ' unread' : ''}${openId === t.id ? ' open' : ''}${selected === i ? ' selected' : ''}`}
                onClick={() => openThread(i)}
              >
                <div className="mail-row-top">
                  <span className="mail-from">
                    {senderLine(t, folder)}
                    {t.message_count > 1 && <span className="mail-n">{t.message_count}</span>}
                  </span>
                  <span className="mail-date">{listDate(t.last_message_at)}</span>
                </div>
                <div className="mail-subject">
                  {isDraft && folder !== 'drafts' && <span className="mail-draft">Draft</span>}
                  {t.subject || '(no subject)'}
                </div>
                <div className="mail-snippet">{t.snippet}</div>
                {(t.job || t.has_attachments) && (
                  <div className="mail-row-tags">
                    {t.job && <span className="mail-job">{t.job.job_number}{t.job.insured_name ? ` · ${t.job.insured_name}` : ''}</span>}
                    {t.has_attachments && <span className="mail-clip" title="Has attachments">📎</span>}
                  </div>
                )}
              </div>
            )
          })}
          {cursor && !loading && (
            <button className="mail-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Older'}
            </button>
          )}
        </div>
      </section>

      {/* ── Reading pane ── */}
      <section className="mail-reader">
        {!openId && <div className="mail-reader-empty">Select a conversation to read it</div>}
        {openId && detailLoading && !detail && <div className="mail-reader-empty">Loading…</div>}
        {openId && detailError && <div className="mail-reader-empty is-error">{detailError}</div>}
        {openId && detail && detail.id === openId && (
          <ThreadView
            detail={detail}
            expanded={expanded}
            onToggle={id => setExpanded(prev => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })}
            onClose={() => setOpenId(null)}
          />
        )}
      </section>

      <style>{MAIL_CSS}</style>
    </div>
  )
}

const LABEL_CHIPS: Record<string, string> = { INBOX: 'Inbox', SPAM: 'Spam', TRASH: 'Bin', DRAFT: 'Draft' }

function ThreadView({ detail, expanded, onToggle, onClose }: {
  detail: ThreadDetail
  expanded: Set<string>
  onToggle: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="mail-thread">
      <div className="mail-thread-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="mail-thread-subject">{detail.subject || '(no subject)'}</h1>
          <div className="mail-thread-tags">
            {detail.label_ids.filter(l => LABEL_CHIPS[l]).map(l => (
              <span key={l} className={`mail-label${l === 'SPAM' || l === 'TRASH' ? ' warn' : ''}`}>{LABEL_CHIPS[l]}</span>
            ))}
            {detail.job && (
              <Link href={`/dashboard/jobs/${detail.job.id}`} className="mail-job link">
                {detail.job.job_number}{detail.job.insured_name ? ` · ${detail.job.insured_name}` : ''} →
              </Link>
            )}
          </div>
        </div>
        <button className="mail-close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>

      {detail.messages.map(m => (
        <MessageView key={m.id} message={m} open={expanded.has(m.id)} onToggle={() => onToggle(m.id)} />
      ))}
    </div>
  )
}

function MessageView({ message: m, open, onToggle }: { message: MailMessage; open: boolean; onToggle: () => void }) {
  const files = m.attachments.filter(a => !a.inline && a.attachmentId)
  const isDraft = m.labelIds.includes('DRAFT')

  return (
    <article className={`mail-msg${open ? ' open' : ''}`}>
      <header className="mail-msg-head" onClick={onToggle}>
        <div style={{ minWidth: 0 }}>
          <div className="mail-msg-from">
            {isDraft && <span className="mail-draft">Draft</span>}
            <strong>{m.from?.name || m.from?.email || '(unknown sender)'}</strong>
            {m.from?.name && <span className="mail-msg-email">&lt;{m.from.email}&gt;</span>}
          </div>
          {open ? (
            <div className="mail-msg-to">
              to {addressText(m.to) || '(no recipients)'}
              {m.cc.length > 0 && <> · cc {addressText(m.cc)}</>}
            </div>
          ) : (
            <div className="mail-msg-snippet">{m.snippet}</div>
          )}
        </div>
        <span className="mail-msg-date">{fullDate(m.date)}</span>
      </header>

      {open && (
        <div className="mail-msg-body">
          <MessageBody html={m.html} text={m.text} sender={m.from?.email ?? ''} />
          {files.length > 0 && (
            <div className="mail-files">
              {files.map((a, i) => (
                <div key={i} className="mail-file">
                  <a href={attachmentUrl(m.id, a)} target="_blank" rel="noreferrer" className="mail-file-name">
                    📎 {a.filename}
                  </a>
                  <span className="mail-file-size">{formatSize(a.size)}</span>
                  <a href={attachmentUrl(m.id, a, true)} className="mail-file-dl">Download</a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

const MAIL_CSS = `
  .mail { display: grid; grid-template-columns: 200px minmax(320px, 420px) 1fr; height: 100vh; background: var(--surface); color: var(--body); }

  .mail-folders { padding: 22px 12px; border-right: 0.5px solid var(--line-2); display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
  .mail-title { font-size: 20px; font-weight: 600; color: var(--ink); padding: 0 10px 2px; }
  .mail-account { font-size: 11px; color: var(--subtle); padding: 0 10px 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-folder { display: flex; justify-content: space-between; align-items: center; font: inherit; font-size: 13px; color: var(--body); background: none; border: none; border-radius: 0 16px 16px 0; padding: 7px 10px; cursor: pointer; text-align: left; }
  .mail-folder:hover { background: var(--surface-2); }
  .mail-folder.active { background: var(--cream); color: var(--ink); font-weight: 600; }
  .mail-folder.has-unread { font-weight: 600; color: var(--ink); }
  .mail-count { font-size: 11px; font-weight: 600; }
  .mail-hint { margin-top: auto; padding: 16px 10px 0; font-size: 10.5px; color: var(--faint); line-height: 1.9; }
  .mail-hint kbd { font: inherit; font-size: 10px; border: 0.5px solid var(--line-strong); border-radius: 3px; padding: 0 4px; background: var(--paper); color: var(--grey-600); }

  .mail-list-col { display: flex; flex-direction: column; min-height: 0; border-right: 0.5px solid var(--line-2); background: var(--paper); }
  .mail-search { display: flex; gap: 6px; padding: 12px; border-bottom: 0.5px solid var(--line-faint); }
  .mail-search input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 8px 12px; border: 0.5px solid var(--line-strong); border-radius: 18px; background: var(--surface-3); outline: none; }
  .mail-search input:focus { border-color: var(--gold); background: var(--paper); }
  .mail-search-clear { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; cursor: pointer; }
  .mail-banner { font-size: 12px; color: var(--warning-dark); background: var(--warning-bg); padding: 8px 14px; border-bottom: 0.5px solid var(--line-faint); }
  .mail-banner.is-error { color: var(--danger-dark); background: var(--danger-bg); }

  .mail-list { flex: 1; overflow-y: auto; }
  .mail-empty { padding: 40px 20px; text-align: center; font-size: 13px; color: var(--subtle); }
  .mail-empty.is-error, .mail-reader-empty.is-error { color: var(--danger); }
  .mail-row { padding: 10px 14px 10px 16px; border-bottom: 0.5px solid var(--line-faint); cursor: pointer; position: relative; }
  .mail-row:hover { background: var(--surface-3); }
  .mail-row.selected::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--gold); }
  .mail-row.open { background: var(--cream); }
  .mail-row-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .mail-from { font-size: 13px; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-n { font-size: 11px; color: var(--subtle); margin-left: 5px; font-weight: 400; }
  .mail-date { font-size: 11px; color: var(--subtle); flex-shrink: 0; }
  .mail-subject { font-size: 13px; color: var(--body); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-snippet { font-size: 12px; color: var(--subtle); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-row.unread .mail-from, .mail-row.unread .mail-subject, .mail-row.unread .mail-date { font-weight: 700; color: var(--ink); }
  .mail-row-tags { display: flex; gap: 6px; align-items: center; margin-top: 5px; }
  .mail-job { font-size: 11px; font-weight: 600; color: var(--teal); background: var(--success-bg-2); border: 0.5px solid #cfe5d8; border-radius: 10px; padding: 1px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; text-decoration: none; }
  .mail-job.link:hover { background: var(--success-bg); }
  .mail-clip { font-size: 11px; }
  .mail-draft { font-size: 11px; font-weight: 600; color: var(--danger); margin-right: 6px; }
  .mail-more { display: block; width: 100%; font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; padding: 14px; cursor: pointer; }
  .mail-more:hover { background: var(--surface-3); }

  .mail-reader { overflow-y: auto; min-width: 0; }
  .mail-reader-empty { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 13px; color: var(--faint); }
  .mail-thread { padding: 22px 28px 48px; max-width: 980px; }
  .mail-thread-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
  .mail-thread-subject { font-size: 20px; font-weight: 500; color: var(--ink); margin: 0 0 6px; line-height: 1.3; word-wrap: break-word; }
  .mail-thread-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mail-label { font-size: 11px; color: var(--grey-600); background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 4px; padding: 1px 6px; }
  .mail-label.warn { color: var(--danger-dark); background: var(--danger-bg); border-color: var(--danger-soft); }
  .mail-close { font-size: 14px; color: var(--subtle); background: none; border: none; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
  .mail-close:hover { background: var(--surface-2); color: var(--ink); }

  .mail-msg { background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 8px; margin-bottom: 8px; }
  .mail-msg-head { display: flex; justify-content: space-between; gap: 12px; padding: 12px 16px; cursor: pointer; }
  .mail-msg-from { font-size: 13px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-msg-email { font-size: 12px; color: var(--subtle); margin-left: 6px; }
  .mail-msg-to, .mail-msg-snippet { font-size: 12px; color: var(--subtle); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-msg-date { font-size: 11px; color: var(--subtle); flex-shrink: 0; }
  .mail-msg-body { padding: 0 16px 16px; }
  .mail-files { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 0.5px solid var(--line-faint); }
  .mail-file { display: flex; gap: 10px; align-items: baseline; font-size: 12px; }
  .mail-file-name { color: var(--info); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-file-name:hover { text-decoration: underline; }
  .mail-file-size { color: var(--subtle); flex-shrink: 0; }
  .mail-file-dl { color: var(--grey-600); flex-shrink: 0; }
`
