'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { format, isThisYear, isToday } from 'date-fns'
import {
  ACTION_DONE, FOLDERS, SHOWS_RECIPIENTS, TABS,
  applyAction, inFolder, isFolderKey, isTabKey, undoAction,
  type FolderKey, type MailAction, type TabKey,
} from '@/lib/mail/folders'
import type { FolderCounts, ThreadDetail, ThreadListItem } from '@/lib/mail/list'
import type { UserLabel } from '@/lib/mail/labels'
import type { MailAddress } from '@/lib/mail/summary'
import { attachmentUrl, type MailMessage } from '@/lib/mail/message'
import { MessageBody } from '@/components/mail/MessageBody'
import { Composer, type ComposerHandle } from '@/components/mail/Composer'
import type { ComposeMode, ComposeStart } from '@/lib/mail/compose-rules'

// The mail client: the office Gmail mailbox, laid out like Gmail with no
// reading pane — a full-width list, and a conversation opens full width.
// Gmail is the source of truth: the list reads the mirror kept by
// lib/mail/sync.ts, conversations open straight from Gmail, and actions
// (archive, bin, spam, read state) are made in Gmail. The page updates
// straight away and puts things back if Gmail refuses. Writing email
// (components/mail/Composer.tsx) saves Gmail drafts; Send waits a few seconds
// so it can be undone, then sends the draft.

type MailboxInfo = { email: string; synced_at: string | null; sync_error: string | null; backfilling: boolean }

type ListResponse = {
  threads: ThreadListItem[]
  cursor: string | null
  counts: FolderCounts
  labels: Record<string, UserLabel>
  mailbox: MailboxInfo
}

type Toast = { message: string; undo?: () => void; error?: boolean }

const POLL_MS = 20_000
const TOAST_MS = 8_000
const UNDO_SEND_MS = 10_000
const EMPTY_COUNTS: FolderCounts = { inbox: 0, promotions: 0, social: 0, drafts: 0, spam: 0 }

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
  if (t.participants.length === 0) return '(unknown sender)'
  if (t.participants.length === 1) {
    const p = t.participants[0]
    return p.me ? 'me' : p.name || p.email
  }
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

/** The actions offered for conversations with these labels, in toolbar order */
function actionsFor(labelSets: string[][], folder: FolderKey): MailAction[] {
  const any = (l: string) => labelSets.some(ls => ls.includes(l))
  const every = (l: string) => labelSets.length > 0 && labelSets.every(ls => ls.includes(l))
  const out: MailAction[] = []
  if (folder === 'trash' || every('TRASH')) return ['inbox', any('UNREAD') ? 'read' : 'unread']
  if (folder === 'spam' || every('SPAM')) return ['not_spam', 'trash']
  if (any('INBOX')) out.push('archive')
  else out.push('inbox')
  out.push('spam', 'trash')
  out.push(any('UNREAD') ? 'read' : 'unread')
  return out
}

const ACTION_TITLE: Record<MailAction, string> = {
  archive: 'Archive (e)',
  inbox: 'Move to Inbox',
  trash: 'Delete (#)',
  untrash: 'Move out of Bin',
  spam: 'Report spam (!)',
  not_spam: 'Not spam',
  read: 'Mark as read (Shift+I)',
  unread: 'Mark as unread (Shift+U)',
}

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
  const initialTab = searchParams.get('tab')
  const [folder, setFolder] = useState<FolderKey>(isFolderKey(initialFolder) ? initialFolder : 'inbox')
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab) ? initialTab : 'primary')
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')

  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [counts, setCounts] = useState<FolderCounts>(EMPTY_COUNTS)
  const [labels, setLabels] = useState<Record<string, UserLabel>>({})
  const [mailbox, setMailbox] = useState<MailboxInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [focused, setFocused] = useState(0)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(searchParams.get('thread'))
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<Toast | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)
  const [composer, setComposer] = useState<{ key: string; initial: ComposeStart } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const gPressed = useRef(false)
  const requestSeq = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const pendingSends = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const activeTab = folder === 'inbox' && !query ? tab : null

  // Keep the address bar shareable: /dashboard/mail?folder=sent&thread=…
  useEffect(() => {
    const params = new URLSearchParams()
    if (folder !== 'inbox') params.set('folder', folder)
    if (folder === 'inbox' && tab !== 'primary') params.set('tab', tab)
    if (query) params.set('q', query)
    if (openId) params.set('thread', openId)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `/dashboard/mail?${qs}` : '/dashboard/mail')
  }, [folder, tab, query, openId])

  const fetchPage = useCallback(async (pageCursor: string | null): Promise<ListResponse> => {
    const params = new URLSearchParams({ folder })
    if (folder === 'inbox') params.set('tab', tab)
    if (query) params.set('q', query)
    if (pageCursor) params.set('cursor', pageCursor)
    const res = await fetch(`/api/mail/threads?${params}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? 'Could not load mail')
    return body as ListResponse
  }, [folder, tab, query])

  // First page whenever the folder, tab or search changes
  useEffect(() => {
    const seq = ++requestSeq.current
    setLoading(true)
    setListError(null)
    setThreads([])
    setChecked(new Set())
    setFocused(0)
    fetchPage(null)
      .then(page => {
        if (seq !== requestSeq.current) return
        setThreads(page.threads)
        setCursor(page.cursor)
        setCounts(page.counts)
        setLabels(page.labels)
        setMailbox(page.mailbox)
      })
      .catch(err => { if (seq === requestSeq.current) setListError(err.message) })
      .finally(() => { if (seq === requestSeq.current) setLoading(false) })
  }, [fetchPage])

  /** Re-reads the first page without disturbing what's on screen */
  const refresh = useCallback(async () => {
    const seq = requestSeq.current
    try {
      const page = await fetchPage(null)
      if (seq !== requestSeq.current) return
      setThreads(prev => {
        const fresh = new Set(page.threads.map(t => t.id))
        const oldest = page.threads[page.threads.length - 1]?.last_message_at ?? ''
        // Keep any further pages already loaded below the fresh first page
        const tail = page.cursor ? prev.filter(t => !fresh.has(t.id) && (t.last_message_at ?? '') < oldest) : []
        return [...page.threads, ...tail]
      })
      setChecked(prev => new Set([...prev].filter(id => page.threads.some(t => t.id === id))))
      setCounts(page.counts)
      setLabels(page.labels)
      setMailbox(page.mailbox)
    } catch {
      // Polling — the next one will try again
    }
  }, [fetchPage])

  // Refresh while the tab is open, so changes made in Gmail show up
  useEffect(() => {
    if (query) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh, query])

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
        const sent = d.messages.filter(m => !m.labelIds.includes('DRAFT'))
        const open = new Set<string>()
        sent.forEach((m, i) => {
          if (i === sent.length - 1 || m.labelIds.includes('UNREAD')) open.add(m.id)
        })
        setExpanded(open)
      })
      .catch(err => { if (!cancelled) setDetailError(err.message) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [openId, detailVersion])

  // ── Toast ──

  function showToast(t: Toast, ms = TOAST_MS) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  // ── Writing ──

  async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Something went wrong')
    return body as T
  }

  /** Opens the composer — one at a time; what's in an open one is saved first */
  async function startComposer(load: () => Promise<ComposeStart>) {
    if (composer) {
      try {
        await composerRef.current?.flush()
      } catch {
        return // its error is showing; don't lose it
      }
    }
    try {
      const initial = await load()
      setComposer({ key: crypto.randomUUID(), initial })
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Could not open the email', error: true })
    }
  }

  function compose(mode: ComposeMode, messageId?: string) {
    startComposer(() => fetchJson(`/api/mail/compose?mode=${mode}${messageId ? `&message=${messageId}` : ''}`))
  }

  function editDraft(draftId: string) {
    startComposer(() => fetchJson(`/api/mail/drafts/${draftId}`))
  }

  /** Send, after a few seconds in which it can be undone (the draft stays in Gmail until then) */
  function sendLater(draftId: string) {
    setComposer(null)
    const timer = setTimeout(() => sendNow(draftId), UNDO_SEND_MS)
    pendingSends.current.set(draftId, timer)
    showToast({
      message: 'Sending…',
      undo: () => {
        clearTimeout(timer)
        pendingSends.current.delete(draftId)
        setToast(null)
        editDraft(draftId)
      },
    }, UNDO_SEND_MS)
  }

  async function sendNow(draftId: string) {
    pendingSends.current.delete(draftId)
    const res = await fetch(`/api/mail/drafts/${draftId}/send`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      showToast({ message: 'Message sent.' })
    } else if (body.pendingApproval) {
      showToast({ message: body.error ?? 'Sent for approval.' })
    } else {
      showToast({ message: body.error ?? 'Could not send the email', error: true })
      editDraft(draftId)
    }
    refresh()
    setDetailVersion(v => v + 1)
  }

  // An email waiting out its undo seconds would stay a draft if the page closed
  useEffect(() => {
    function onUnload(e: BeforeUnloadEvent) {
      if (pendingSends.current.size > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  /** The message a reply or forward from the keyboard answers: the latest one sent */
  const lastMessageId = () => detail?.messages.filter(m => !m.labelIds.includes('DRAFT')).at(-1)?.id

  // ── Actions ──

  const labelsOf = (id: string): string[] =>
    threads.find(t => t.id === id)?.label_ids ?? (detail?.id === id ? detail.label_ids : [])

  async function postAction(ids: string[], action: MailAction, auto = false) {
    const res = await fetch('/api/mail/threads/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadIds: ids, action, auto }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !Array.isArray(body.done)) throw new Error(body.error ?? 'Gmail did not accept the change')
    return body as { done: string[]; failed: string[] }
  }

  /** Changes the screen first, then Gmail; puts the screen back if Gmail refuses */
  async function performAction(ids: string[], action: MailAction, { auto = false } = {}) {
    if (ids.length === 0) return
    const before = new Map(ids.map(id => [id, labelsOf(id)]))
    const snapshot = threads
    const detailSnapshot = detail
    const leavesFolder = (id: string) => !inFolder(folder, applyAction(before.get(id) ?? [], action), activeTab)

    setThreads(prev => prev.flatMap(t => {
      if (!ids.includes(t.id)) return [t]
      const next = applyAction(t.label_ids, action)
      return inFolder(folder, next, activeTab) || query ? [{ ...t, label_ids: next, unread: next.includes('UNREAD') }] : []
    }))
    setChecked(new Set())
    if (detail && ids.includes(detail.id)) {
      setDetail({ ...detail, label_ids: applyAction(detail.label_ids, action) })
      // Gmail goes back to the list once the conversation leaves the folder, or is marked unread
      if (!auto && (leavesFolder(detail.id) || action === 'unread')) setOpenId(null)
    }

    try {
      const result = await postAction(ids, action, auto)
      if (!auto) {
        const n = result.done.length
        const what = n === 1 ? 'Conversation' : `${n} conversations`
        showToast({
          message: `${what} ${ACTION_DONE[action]}${result.failed.length ? ` — ${result.failed.length} couldn't be changed` : ''}`,
          undo: () => undo(result.done, action, before),
        })
      }
      refresh()
    } catch (err) {
      setThreads(snapshot)
      setDetail(detailSnapshot)
      if (!auto) showToast({ message: err instanceof Error ? err.message : 'Could not change the mailbox', error: true })
    }
  }

  async function undo(ids: string[], action: MailAction, before: Map<string, string[]>) {
    setToast(null)
    const groups = new Map<MailAction, string[]>()
    for (const id of ids) {
      const back = undoAction(action, before.get(id) ?? [])
      groups.set(back, [...(groups.get(back) ?? []), id])
    }
    try {
      await Promise.all([...groups].map(([back, groupIds]) => postAction(groupIds, back)))
      showToast({ message: 'Action undone.' })
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Could not undo', error: true })
    }
    refresh()
  }

  /** What an action key applies to: the open conversation, else ticked ones, else the highlighted row */
  function targets(): string[] {
    if (openId) return [openId]
    if (checked.size > 0) return [...checked]
    return threads[focused] ? [threads[focused].id] : []
  }

  // ── Navigation ──

  function switchFolder(key: FolderKey) {
    setFolder(key)
    setOpenId(null)
    setQuery('')
    setSearchInput('')
  }

  async function openThread(index: number) {
    const t = threads[index]
    if (!t) return
    setFocused(index)
    // A draft on its own opens to be written, as in Gmail
    if (t.label_ids.includes('DRAFT') && t.message_count === 1 && t.participants.every(p => p.me)) {
      try {
        const d = await fetchJson<ThreadDetail>(`/api/mail/threads/${t.id}`)
        if (d.messages.every(m => m.labelIds.includes('DRAFT')) && d.drafts[0]) {
          editDraft(d.drafts[0].draftId)
          return
        }
      } catch {
        // Open it as a conversation instead
      }
    }
    setOpenId(t.id)
    // Opening marks it read, as in Gmail
    if (t.unread) performAction([t.id], 'read', { auto: true })
  }

  function toggleChecked(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Gmail keyboard shortcuts
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
      const act = (a: MailAction) => { e.preventDefault(); performAction(targets(), a) }
      const openIndex = openId ? threads.findIndex(t => t.id === openId) : -1
      switch (e.key) {
        case 'g':
          gPressed.current = true
          setTimeout(() => { gPressed.current = false }, 1000)
          break
        case 'j':
        case 'k': {
          e.preventDefault()
          const from = openId ? openIndex : focused
          const next = Math.max(0, Math.min(threads.length - 1, from + (e.key === 'j' ? 1 : -1)))
          if (openId) openThread(next)
          else setFocused(next)
          break
        }
        case 'x':
          if (!openId && threads[focused]) toggleChecked(threads[focused].id)
          break
        case 'o':
        case 'Enter':
          if (!openId) { e.preventDefault(); openThread(focused) }
          break
        case '/':
          e.preventDefault()
          searchRef.current?.focus()
          break
        case 'Escape':
        case 'u':
          if (openId) setOpenId(null)
          else setChecked(new Set())
          break
        case 'e':
          if (targets().some(id => labelsOf(id).includes('INBOX'))) act('archive')
          break
        case '#': act('trash'); break
        case '!': act(folder === 'spam' ? 'not_spam' : 'spam'); break
        case 'I': act('read'); break
        case 'U': act('unread'); break
        case 'c':
          e.preventDefault()
          compose('new')
          break
        case 'r':
        case 'a':
        case 'f': {
          const id = openId ? lastMessageId() : undefined
          if (id) { e.preventDefault(); compose(e.key === 'r' ? 'reply' : e.key === 'a' ? 'reply_all' : 'forward', id) }
          break
        }
        case 'z':
          if (toast?.undo) { e.preventDefault(); toast.undo() }
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // Keep the highlighted row in view
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${focused}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    setOpenId(null)
    setQuery(searchInput.trim())
  }

  const folderMeta = FOLDERS.find(f => f.key === folder)!
  const countFor = (key: FolderKey) => (key === 'inbox' ? counts.inbox : key === 'drafts' ? counts.drafts : key === 'spam' ? counts.spam : 0)
  const allChecked = threads.length > 0 && threads.every(t => checked.has(t.id))
  const checkedLabels = threads.filter(t => checked.has(t.id)).map(t => t.label_ids)

  return (
    <div className="mail">
      {/* ── Folders ── */}
      <nav className="mail-folders">
        <div className="mail-title">Mail</div>
        {mailbox && <div className="mail-account" title={mailbox.email}>{mailbox.email}</div>}
        <button className="mail-compose" onClick={() => compose('new')} title="Compose (c)">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.5 2.5l3 3L6 13H3v-3z" /></svg>
          Compose
        </button>
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
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>x</kbd> select · <kbd>o</kbd> open<br />
          <kbd>e</kbd> archive · <kbd>#</kbd> delete · <kbd>!</kbd> spam<br />
          <kbd>⇧I</kbd>/<kbd>⇧U</kbd> read/unread · <kbd>z</kbd> undo<br />
          <kbd>/</kbd> search · <kbd>g</kbd> <kbd>i</kbd> inbox
        </div>
      </nav>

      <main className="mail-main">
        <form className="mail-search" onSubmit={submitSearch}>
          <input
            ref={searchRef}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search mail — Gmail search works (from:, has:attachment, older_than:)"
          />
          {query && (
            <button type="button" className="mail-search-clear" onClick={() => { setQuery(''); setSearchInput('') }}>
              Clear search
            </button>
          )}
        </form>

        <div className="mail-card">
          {openId ? (
            <>
              <div className="mail-toolbar">
                <IconButton icon="back" title="Back to list (u)" onClick={() => setOpenId(null)} />
                {detail && detail.id === openId && actionsFor([detail.label_ids], folder).map(a => (
                  <IconButton key={a} icon={a} title={ACTION_TITLE[a]} onClick={() => performAction([openId], a)} />
                ))}
              </div>
              <div className="mail-thread-scroll">
                {detailLoading && !detail && <div className="mail-empty">Loading…</div>}
                {detailError && <div className="mail-empty is-error">{detailError}</div>}
                {detail && detail.id === openId && (
                  <ThreadView
                    detail={detail}
                    labels={labels}
                    onCompose={(mode, messageId) => compose(mode, messageId)}
                    onEditDraft={editDraft}
                    replying={!!composer && composer.initial.threadId === detail.id && composer.initial.mode !== 'new'}
                    composer={composer && composer.initial.threadId === detail.id && composer.initial.mode !== 'new' && (
                      <Composer
                        key={composer.key}
                        ref={composerRef}
                        initial={composer.initial}
                        variant="inline"
                        onClose={() => { setComposer(null); setDetailVersion(v => v + 1) }}
                        onDiscarded={() => { setComposer(null); setDetailVersion(v => v + 1) }}
                        onSend={sendLater}
                      />
                    )}
                    expanded={expanded}
                    onToggle={id => setExpanded(prev => {
                      const next = new Set(prev)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mail-toolbar">
                <input
                  type="checkbox"
                  className="mail-check"
                  title="Select all"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = checked.size > 0 && !allChecked }}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(threads.map(t => t.id)))}
                />
                {checked.size > 0 ? (
                  <>
                    {actionsFor(checkedLabels, folder).map(a => (
                      <IconButton key={a} icon={a} title={ACTION_TITLE[a]} onClick={() => performAction([...checked], a)} />
                    ))}
                    <span className="mail-toolbar-note">{checked.size} selected</span>
                  </>
                ) : (
                  <IconButton icon="refresh" title="Refresh" onClick={() => refresh()} />
                )}
                {query && <span className="mail-toolbar-note">Search results in {folderMeta.label}</span>}
              </div>

              {folder === 'inbox' && !query && (
                <div className="mail-tabs">
                  {TABS.map(t => {
                    const n = counts[t.key === 'primary' ? 'inbox' : t.key]
                    return (
                      <button
                        key={t.key}
                        className={`mail-tab${tab === t.key ? ' active' : ''}`}
                        onClick={() => { setTab(t.key); setOpenId(null) }}
                      >
                        {t.label}
                        {t.key !== 'primary' && n > 0 && <span className="mail-tab-new">{n} new</span>}
                      </button>
                    )
                  })}
                </div>
              )}

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
                {threads.map((t, i) => (
                  <ThreadRow
                    key={t.id}
                    index={i}
                    thread={t}
                    folder={folder}
                    labels={labels}
                    focused={focused === i}
                    checked={checked.has(t.id)}
                    onCheck={() => toggleChecked(t.id)}
                    onOpen={() => openThread(i)}
                    onAction={a => performAction([t.id], a)}
                  />
                ))}
                {cursor && !loading && (
                  <button className="mail-more" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Older'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {composer && !(openId && composer.initial.threadId === openId && composer.initial.mode !== 'new') && (
        <Composer
          key={composer.key}
          ref={composerRef}
          initial={composer.initial}
          variant="floating"
          onClose={id => { setComposer(null); if (id) showToast({ message: 'Draft saved.' }); refresh() }}
          onDiscarded={() => { setComposer(null); showToast({ message: 'Draft discarded.' }); refresh() }}
          onSend={sendLater}
        />
      )}

      {toast && (
        <div className={`mail-toast${toast.error ? ' is-error' : ''}`} role="status">
          <span>{toast.message}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
          <button className="mail-toast-x" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <style>{MAIL_CSS}</style>
    </div>
  )
}

// ── Pieces ──

const LABEL_CHIPS: Record<string, string> = { INBOX: 'Inbox', SPAM: 'Spam', TRASH: 'Bin' }

function LabelChips({ labelIds, labels, hide }: { labelIds: string[]; labels: Record<string, UserLabel>; hide?: string[] }) {
  return (
    <>
      {labelIds.filter(id => labels[id] && !hide?.includes(id)).map(id => {
        const l = labels[id]
        return (
          <span
            key={id}
            className="mail-chip"
            style={l.backgroundColor ? { background: l.backgroundColor, color: l.textColor ?? undefined, borderColor: 'transparent' } : undefined}
          >
            {l.name}
          </span>
        )
      })}
    </>
  )
}

function ThreadRow({ index, thread: t, folder, labels, focused, checked, onCheck, onOpen, onAction }: {
  index: number
  thread: ThreadListItem
  folder: FolderKey
  labels: Record<string, UserLabel>
  focused: boolean
  checked: boolean
  onCheck: () => void
  onOpen: () => void
  onAction: (a: MailAction) => void
}) {
  const isDraft = t.label_ids.includes('DRAFT')
  const hover = actionsFor([t.label_ids], folder).filter(a => a !== 'spam' && a !== 'not_spam')
  return (
    <div
      data-index={index}
      className={`mail-row${t.unread ? ' unread' : ''}${focused ? ' focused' : ''}${checked ? ' checked' : ''}`}
      onClick={onOpen}
    >
      <span className="mail-row-check" onClick={e => e.stopPropagation()}>
        <input type="checkbox" className="mail-check" checked={checked} onChange={onCheck} />
      </span>
      <span className="mail-from">
        {senderLine(t, folder)}
        {t.message_count > 1 && <span className="mail-n">{t.message_count}</span>}
        {isDraft && folder !== 'drafts' && <span className="mail-draft">Draft</span>}
      </span>
      <span className="mail-content">
        {t.job && <span className="mail-chip job">{t.job.job_number}</span>}
        <LabelChips labelIds={t.label_ids} labels={labels} />
        <span className="mail-subject">{t.subject || '(no subject)'}</span>
        {t.snippet && <span className="mail-snippet"> - {t.snippet}</span>}
      </span>
      <span className="mail-clip">{t.has_attachments && <Icon name="clip" />}</span>
      <span className="mail-date">{listDate(t.last_message_at)}</span>
      <span className="mail-row-actions" onClick={e => e.stopPropagation()}>
        {hover.map(a => <IconButton key={a} icon={a} title={ACTION_TITLE[a]} onClick={() => onAction(a)} small />)}
      </span>
    </div>
  )
}

function ThreadView({ detail, labels, expanded, onToggle, onCompose, onEditDraft, replying, composer }: {
  detail: ThreadDetail
  labels: Record<string, UserLabel>
  expanded: Set<string>
  onToggle: (id: string) => void
  onCompose: (mode: ComposeMode, messageId: string) => void
  onEditDraft: (draftId: string) => void
  replying: boolean
  composer: React.ReactNode
}) {
  const last = detail.messages.filter(m => !m.labelIds.includes('DRAFT')).at(-1)
  return (
    <div className="mail-thread">
      <div className="mail-thread-head">
        <h1 className="mail-thread-subject">{detail.subject || '(no subject)'}</h1>
        <div className="mail-thread-tags">
          {detail.label_ids.filter(l => LABEL_CHIPS[l]).map(l => (
            <span key={l} className={`mail-chip${l === 'SPAM' || l === 'TRASH' ? ' warn' : ''}`}>{LABEL_CHIPS[l]}</span>
          ))}
          <LabelChips labelIds={detail.label_ids} labels={labels} />
          {detail.job && (
            <Link href={`/dashboard/jobs/${detail.job.id}`} className="mail-chip job link">
              {detail.job.job_number}{detail.job.insured_name ? ` · ${detail.job.insured_name}` : ''} →
            </Link>
          )}
        </div>
      </div>

      {detail.messages.map(m => {
        const draft = detail.drafts.find(d => d.messageId === m.id)
        // The draft being edited shows as the composer below instead
        if (draft && replying) return null
        return (
          <MessageView
            key={m.id}
            message={m}
            open={expanded.has(m.id)}
            onToggle={() => (draft ? onEditDraft(draft.draftId) : onToggle(m.id))}
          />
        )
      })}

      {composer}
      {!replying && last && (
        <div className="mail-reply-btns">
          <button onClick={() => onCompose('reply', last.id)} title="Reply (r)">↩ Reply</button>
          {last.to.length + last.cc.length > 1 && <button onClick={() => onCompose('reply_all', last.id)} title="Reply all (a)">↩↩ Reply all</button>}
          <button onClick={() => onCompose('forward', last.id)} title="Forward (f)">↪ Forward</button>
        </div>
      )}
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
          {isDraft ? (
            <div className="mail-msg-snippet">{m.snippet || '(empty draft)'} · <span className="mail-edit">Edit</span></div>
          ) : open ? (
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

      {open && !isDraft && (
        <div className="mail-msg-body">
          <MessageBody html={m.html} text={m.text} sender={m.from?.email ?? ''} />
          {files.length > 0 && (
            <div className="mail-files">
              {files.map((a, i) => (
                <div key={i} className="mail-file">
                  <a href={attachmentUrl(m.id, a)} target="_blank" rel="noreferrer" className="mail-file-name">
                    <Icon name="clip" /> {a.filename}
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

type IconName = MailAction | 'back' | 'refresh' | 'clip'

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  back: <path d="M13 8H3m4-4L3 8l4 4" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />,
  archive: <><rect x="2" y="3" width="12" height="3" rx=".5" /><path d="M3 6v6.5h10V6M6.5 8.5h3" /></>,
  inbox: <><path d="M2 9.5V13h12V9.5M2 9.5 4 3h8l2 6.5M2 9.5h3.5l1 1.5h3l1-1.5H14" /></>,
  untrash: <><path d="M2 9.5V13h12V9.5M2 9.5 4 3h8l2 6.5M2 9.5h3.5l1 1.5h3l1-1.5H14" /></>,
  not_spam: <><path d="M2 9.5V13h12V9.5M2 9.5 4 3h8l2 6.5M2 9.5h3.5l1 1.5h3l1-1.5H14" /></>,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9" />,
  spam: <><path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5z" /><path d="M8 5v3.5M8 10.5v.5" /></>,
  read: <><path d="M2 6.5 8 3l6 3.5V13H2z" /><path d="m2 6.5 6 4 6-4" /></>,
  unread: <><rect x="2" y="3.5" width="12" height="9" rx="1" /><path d="m2.5 4.5 5.5 4.5 5.5-4.5" /></>,
  clip: <path d="M10.5 5 6 9.5a1.2 1.2 0 0 0 1.7 1.7l5-5a2.4 2.4 0 0 0-3.4-3.4l-5 5a3.6 3.6 0 0 0 5.1 5.1L13 9.3" />,
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON_PATHS[name]}
    </svg>
  )
}

function IconButton({ icon, title, onClick, small }: { icon: IconName; title: string; onClick: () => void; small?: boolean }) {
  return (
    <button type="button" className={`mail-icon-btn${small ? ' small' : ''}`} title={title} aria-label={title} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

const MAIL_CSS = `
  .mail { display: grid; grid-template-columns: 220px 1fr; height: 100vh; background: var(--surface); color: var(--body); }

  .mail-folders { padding: 22px 12px 18px 0; display: flex; flex-direction: column; gap: 1px; overflow-y: auto; }
  .mail-title { font-size: 20px; font-weight: 600; color: var(--ink); padding: 0 22px 2px; }
  .mail-account { font-size: 11px; color: var(--subtle); padding: 0 22px 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-folder { display: flex; justify-content: space-between; align-items: center; font: inherit; font-size: 14px; color: var(--body); background: none; border: none; border-radius: 0 16px 16px 0; padding: 7px 14px 7px 22px; cursor: pointer; text-align: left; }
  .mail-folder:hover { background: var(--surface-2); }
  .mail-folder.active { background: var(--cream); color: var(--ink); font-weight: 600; }
  .mail-folder.has-unread { font-weight: 600; color: var(--ink); }
  .mail-count { font-size: 12px; font-weight: 600; }
  .mail-hint { margin-top: auto; padding: 16px 12px 0 22px; font-size: 10.5px; color: var(--faint); line-height: 2; }
  .mail-hint kbd { font: inherit; font-size: 10px; border: 0.5px solid var(--line-strong); border-radius: 3px; padding: 0 4px; background: var(--paper); color: var(--grey-600); }

  .mail-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px 16px 12px 0; gap: 10px; }
  .mail-search { display: flex; gap: 8px; align-items: center; }
  .mail-search input { flex: 1; max-width: 720px; min-width: 0; font: inherit; font-size: 14px; padding: 10px 18px; border: 0.5px solid var(--line-strong); border-radius: 22px; background: var(--paper); outline: none; }
  .mail-search input:focus { border-color: var(--gold); box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .mail-search-clear { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; cursor: pointer; }

  .mail-card { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--paper); border-radius: 14px; border: 0.5px solid var(--line-2); overflow: hidden; }
  .mail-toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 12px; min-height: 46px; border-bottom: 0.5px solid var(--line-faint); }
  .mail-toolbar-note { font-size: 12px; color: var(--subtle); margin-left: 8px; }
  .mail-check { width: 15px; height: 15px; margin: 0 8px; accent-color: var(--ink); cursor: pointer; }
  .mail-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; border: none; background: none; color: var(--grey-600); cursor: pointer; }
  .mail-icon-btn:hover { background: var(--surface-2); color: var(--ink); }
  .mail-icon-btn.small { width: 30px; height: 30px; }

  .mail-tabs { display: flex; border-bottom: 0.5px solid var(--line-faint); }
  .mail-tab { flex: 0 1 240px; display: flex; align-items: center; gap: 8px; font: inherit; font-size: 14px; color: var(--grey-600); background: none; border: none; border-bottom: 3px solid transparent; padding: 13px 18px 10px; cursor: pointer; text-align: left; }
  .mail-tab:hover { background: var(--surface-3); }
  .mail-tab.active { color: var(--ink); font-weight: 600; border-bottom-color: var(--gold); }
  .mail-tab-new { font-size: 11px; font-weight: 600; color: var(--paper); background: var(--teal); border-radius: 8px; padding: 0 6px; }

  .mail-banner { font-size: 12px; color: var(--warning-dark); background: var(--warning-bg); padding: 8px 16px; border-bottom: 0.5px solid var(--line-faint); }
  .mail-banner.is-error { color: var(--danger-dark); background: var(--danger-bg); }

  .mail-list { flex: 1; overflow-y: auto; }
  .mail-empty { padding: 48px 20px; text-align: center; font-size: 13px; color: var(--subtle); }
  .mail-empty.is-error { color: var(--danger); }

  .mail-row { display: grid; grid-template-columns: 36px minmax(120px, 200px) 1fr 24px 76px; align-items: center; gap: 8px; height: 40px; padding: 0 16px 0 6px; border-bottom: 0.5px solid var(--line-faint); cursor: pointer; position: relative; background: var(--surface-3); font-size: 14px; }
  .mail-row.unread { background: var(--paper); }
  .mail-row:hover { box-shadow: inset 1px 0 0 var(--line-strong), inset -1px 0 0 var(--line-strong), 0 1px 3px rgba(60,50,40,.12); z-index: 1; }
  .mail-row.focused::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--gold); }
  .mail-row.checked { background: var(--cream); }
  .mail-row-check { display: flex; align-items: center; height: 100%; }
  .mail-from { color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-n { font-size: 12px; color: var(--subtle); margin-left: 5px; font-weight: 400; }
  .mail-content { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--body); }
  .mail-subject { color: var(--body); }
  .mail-snippet { color: var(--subtle); }
  .mail-row.unread .mail-from, .mail-row.unread .mail-subject, .mail-row.unread .mail-date { font-weight: 700; color: var(--ink); }
  .mail-clip { color: var(--subtle); display: flex; justify-content: center; }
  .mail-date { font-size: 12px; color: var(--subtle); text-align: right; white-space: nowrap; }
  .mail-row-actions { position: absolute; right: 12px; top: 0; bottom: 0; display: none; align-items: center; gap: 2px; background: inherit; padding-left: 8px; }
  .mail-row:hover .mail-row-actions { display: flex; }
  .mail-row:hover .mail-date { visibility: hidden; }

  .mail-chip { display: inline-block; vertical-align: 1px; font-size: 12px; line-height: 18px; color: var(--grey-600); background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 4px; padding: 0 6px; margin-right: 6px; font-weight: 400; text-decoration: none; }
  .mail-chip.job { color: var(--teal); background: var(--success-bg-2); border-color: #cfe5d8; font-weight: 600; }
  .mail-chip.job.link:hover { background: var(--success-bg); }
  .mail-chip.warn { color: var(--danger-dark); background: var(--danger-bg); border-color: var(--danger-soft); }
  .mail-draft { font-size: 13px; color: var(--danger); margin-left: 6px; font-weight: 400; }
  .mail-more { display: block; width: 100%; font: inherit; font-size: 13px; color: var(--grey-600); background: none; border: none; padding: 14px; cursor: pointer; }
  .mail-more:hover { background: var(--surface-3); }

  .mail-thread-scroll { flex: 1; overflow-y: auto; }
  .mail-thread { padding: 18px 28px 48px 64px; max-width: 1100px; }
  .mail-thread-head { margin-bottom: 18px; }
  .mail-thread-subject { font-size: 22px; font-weight: 400; color: var(--ink); margin: 0 0 8px; line-height: 1.3; word-wrap: break-word; }
  .mail-thread-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }

  .mail-msg { border-bottom: 0.5px solid var(--line-faint); }
  .mail-msg-head { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; cursor: pointer; }
  .mail-msg-from { font-size: 14px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-msg-email { font-size: 12px; color: var(--subtle); margin-left: 6px; }
  .mail-msg-to, .mail-msg-snippet { font-size: 12px; color: var(--subtle); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-msg-date { font-size: 12px; color: var(--subtle); flex-shrink: 0; }
  .mail-msg-body { padding: 0 0 18px; }
  .mail-files { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 0.5px solid var(--line-faint); }
  .mail-file { display: flex; gap: 10px; align-items: center; font-size: 13px; }
  .mail-file-name { display: inline-flex; align-items: center; gap: 4px; color: var(--info); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-file-name:hover { text-decoration: underline; }
  .mail-file-size { color: var(--subtle); flex-shrink: 0; }
  .mail-file-dl { color: var(--grey-600); flex-shrink: 0; }

  .mail-compose { display: inline-flex; align-items: center; gap: 10px; align-self: flex-start; margin: 0 0 14px 12px; font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); background: var(--cream); border: none; border-radius: 16px; padding: 14px 22px 14px 18px; cursor: pointer; box-shadow: 0 1px 3px rgba(60,50,40,.15); }
  .mail-compose:hover { box-shadow: 0 2px 8px rgba(60,50,40,.22); }
  .mail-reply-btns { display: flex; gap: 10px; margin: 18px 0 8px; }
  .mail-reply-btns button { font: inherit; font-size: 14px; color: var(--body); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 18px; padding: 8px 20px; cursor: pointer; }
  .mail-reply-btns button:hover { background: var(--surface-2); }
  .mail-edit { color: var(--info); }
  .mail-toast { position: fixed; left: 24px; bottom: 24px; z-index: 50; display: flex; align-items: center; gap: 16px; background: var(--ink); color: var(--cream); font-size: 14px; padding: 12px 14px 12px 20px; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .mail-toast.is-error { background: var(--danger-dark); }
  .mail-toast button { font: inherit; font-size: 14px; font-weight: 600; color: var(--gold); background: none; border: none; cursor: pointer; padding: 0; }
  .mail-toast .mail-toast-x { color: var(--faint); font-weight: 400; font-size: 12px; }
`
