'use client'

import { useCallback, useEffect, useState } from 'react'
import { CATEGORIES, type CardCategory, type CardView, type CardWithContext } from '@/lib/actions/cards'
import { ApprovalsPanel } from '@/components/approvals/approvals-panel'
import { ActionCardView } from './ActionCardView'
import { StarIcon } from './Star'
import { FollowUps } from './FollowUps'

// The Action cards view on the dashboard: everything that needs the office,
// most urgent first — the AI's suggestions for incoming email (and, later,
// texts and time rules), plus approvals waiting on the user.

const POLL_MS = 15_000
const VIEWS: { key: CardView; label: string }[] = [
  { key: 'pending', label: 'Needs action' },
  { key: 'upcoming', label: 'Follow-ups' },
  { key: 'done', label: 'Done' },
]

export function ActionsView({ onOpenConversation, onToast, onCount }: {
  onOpenConversation(threadId: string): void
  onToast(message: string, error?: boolean): void
  onCount?(pending: number): void
}) {
  const [view, setView] = useState<CardView>('pending')
  const [category, setCategory] = useState<CardCategory | null>(null)
  const [cards, setCards] = useState<CardWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (view === 'upcoming') return
    try {
      const res = await fetch(`/api/actions?view=${view}${category ? `&category=${category}` : ''}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not load action cards')
      setCards(body.cards)
      setError(null)
      onCount?.(body.pending)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load action cards')
    }
  }, [view, category, onCount])

  useEffect(() => {
    setCards(null)
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  function changed(card: CardWithContext | null, message: string, isError?: boolean) {
    onToast(message, isError)
    if (card) {
      setCards(prev => {
        if (!prev) return prev
        const stillHere = (view === 'pending' ? ['queued', 'generating', 'pending', 'running', 'failed'].includes(card.status) : true)
          && (!category || card.category === category)
        return stillHere ? prev.map(c => (c.id === card.id ? card : c)) : prev.filter(c => c.id !== card.id)
      })
    }
    void load()
  }

  return (
    <div className="av">
      <div className="mail-toolbar">
        <div className="av-tabs" role="tablist">
          {VIEWS.map(v => (
            <button key={v.key} role="tab" aria-selected={view === v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
        {view !== 'upcoming' && <div className="av-stars" role="group" aria-label="Filter by star">
          <button className={!category ? 'on' : ''} onClick={() => setCategory(null)}>All</button>
          {CATEGORIES.map(c => (
            <button key={c.key} className={category === c.key ? 'on' : ''} onClick={() => setCategory(c.key)}>
              <StarIcon category={c.key} size={14} /> {c.label}
            </button>
          ))}
        </div>}
      </div>
      <div className="av-list">
        {view === 'upcoming' && <FollowUps onMessage={onToast} />}
        {view === 'pending' && <ApprovalsPanel />}
        {view !== 'upcoming' && cards === null && !error && <div className="mail-empty">Loading…</div>}
        {error && <div className="mail-empty is-error">{error}</div>}
        {view !== 'upcoming' && cards?.length === 0 && (
          <div className="mail-empty">{view === 'pending' ? (category ? 'Nothing starred here.' : 'All caught up — nothing needs you right now.') : 'Nothing done yet.'}</div>
        )}
        {view !== 'upcoming' && cards?.map(card => (
          <ActionCardView key={`${card.id}:${card.updated_at}`} card={card} onChanged={changed} onOpenConversation={onOpenConversation} />
        ))}
      </div>
      <style>{`
        .av { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .av-list { flex: 1; overflow-y: auto; padding: 16px 20px 40px; background: var(--surface-3); }
        .av-tabs { display: inline-flex; border: 0.5px solid var(--line-strong); border-radius: 16px; overflow: hidden; }
        .av-tabs button { font: inherit; font-size: 12px; color: var(--grey-600); background: var(--paper); border: none; border-right: 0.5px solid var(--line-faint); padding: 5px 14px; cursor: pointer; }
        .av-tabs button:last-child { border-right: none; }
        .av-tabs button.on { background: var(--ink); color: var(--cream); }
        .av-stars { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 8px; }
        .av-stars button { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: 0.5px solid transparent; border-radius: 14px; padding: 4px 10px; cursor: pointer; }
        .av-stars button:hover { background: var(--surface-2); }
        .av-stars button.on { border-color: var(--line-strong); background: var(--surface-2); color: var(--ink); font-weight: 600; }
      `}</style>
    </div>
  )
}

/** The card beside an open conversation, or a button to ask for one */
export function ConversationCard({ threadId, onToast, onChanged, version }: {
  threadId: string
  onToast(message: string, error?: boolean): void
  /** Its steps ran: the conversation may have a reply or a new job */
  onChanged?(): void
  version?: number
}) {
  const [card, setCard] = useState<CardWithContext | null | undefined>(undefined)
  const [asking, setAsking] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/actions/thread/${threadId}`)
    if (res.ok) setCard((await res.json()).card)
    else setCard(null)
  }, [threadId])

  useEffect(() => { setCard(undefined) }, [threadId])
  useEffect(() => { void load() }, [load, version])

  // Still being made: check back shortly
  const making = card && (card.status === 'queued' || card.status === 'generating')
  useEffect(() => {
    if (!making) return
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [making, load])

  async function suggest() {
    setAsking(true)
    try {
      const res = await fetch('/api/actions/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not suggest steps')
      setCard(body.card)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not suggest steps', true)
    } finally {
      setAsking(false)
    }
  }

  if (card === undefined) return null
  return (
    <div className="cc">
      <div className="jp-label">Next steps</div>
      {card ? (
        <ActionCardView key={`${card.id}:${card.updated_at}`} card={card} compact onChanged={(c, m, e) => {
          onToast(m, e)
          if (c) setCard(c)
          else void load()
          if (c && !e && c.steps.some(s => s.ran_at)) onChanged?.()
        }} />
      ) : (
        <button className="jp-button" disabled={asking} onClick={suggest}>{asking ? 'Reading the email and job…' : 'Suggest next steps'}</button>
      )}
      <style>{`.cc { padding-bottom: 12px; margin-bottom: 4px; }`}</style>
    </div>
  )
}

/** One job's action cards, on the job page */
export function JobCards({ jobId }: { jobId: string }) {
  const [cards, setCards] = useState<CardWithContext[] | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/actions?job=${jobId}`)
      .then(r => (r.ok ? r.json() : { cards: [] }))
      .then(body => { if (!cancelled) setCards(body.cards) })
    return () => { cancelled = true }
  }, [jobId, version])

  return (
    <div className="jc">
      <div className="jc-head">
        <span className="jc-title">To do</span>
        {!!cards?.length && <span className="jc-n">{cards.length} on the list</span>}
        {message && <span className={`jc-msg${message.error ? ' err' : ''}`}>{message.text}</span>}
      </div>
      <FollowUps jobId={jobId} compact version={version} onMessage={(text, error) => setMessage({ text, error })} />
      {cards === null && <div className="jc-empty">Loading…</div>}
      {cards?.length === 0 && <div className="jc-empty">Nothing to do on this job — all clear.</div>}
      {cards?.map(card => (
        <ActionCardView
          key={`${card.id}:${card.updated_at}`}
          card={card}
          onChanged={(c, text, error) => {
            setMessage({ text, error })
            if (c) setCards(prev => prev?.map(x => (x.id === c.id ? c : x)) ?? null)
            setVersion(v => v + 1)
          }}
          onOpenConversation={threadId => { window.location.href = `/dashboard?thread=${threadId}` }}
        />
      ))}
      <style>{`
        .jc-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
        .jc-title { font-size: 26px; font-weight: 700; color: var(--ink); letter-spacing: -0.5px; line-height: 1; }
        .jc-n { font-size: 11px; color: var(--tan); font-weight: 600; background: #faf5ee; border: 0.5px solid var(--line-tan-5); padding: 2px 9px; border-radius: 20px; }
        .jc-msg { font-size: 12px; color: var(--subtle); }
        .jc-msg.err { color: var(--danger-dark); }
        .jc-empty { padding: 32px; text-align: center; font-size: 13px; color: var(--faint); background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 8px; }
      `}</style>
    </div>
  )
}
