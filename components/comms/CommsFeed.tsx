'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { CommsItem } from './CommsItem'
import type { Comm, DisplayItem } from './CommsItem'
import { CommsFilterBar } from './CommsFilterBar'
import type { CommsFilters } from './CommsFilterBar'
import { DEFAULT_FILTERS } from './CommsFilterBar'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── AI summary types ──────────────────────────────────────────────────────────

type AiScope = 'recent' | 'full'

interface AiSummary {
  where_its_at: string[]
  what_happened: string[]
  issues: string[]
  outstanding: string[]
}

// ── Grouping helpers ──────────────────────────────────────────────────────────

function anchorTime(item: DisplayItem): string {
  if (item.kind === 'single') return item.comm.created_at ?? ''
  if (item.kind === 'thread') return item.latest.created_at ?? ''
  return item.comms[item.comms.length - 1].created_at ?? ''
}

function minutesBetween(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60000
}

function dateStr(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

function buildDisplayItems(comms: Comm[]): DisplayItem[] {
  const items: DisplayItem[] = []
  const usedIds = new Set<string>()

  // 1. Email thread grouping by thread_id (only when 2+ messages share the same id)
  const threadMap = new Map<string, Comm[]>()
  for (const c of comms) {
    if (c.thread_id) {
      const arr = threadMap.get(c.thread_id) ?? []
      arr.push(c)
      threadMap.set(c.thread_id, arr)
    }
  }
  for (const [threadId, threadComms] of threadMap.entries()) {
    if (threadComms.length >= 2) {
      const sorted = [...threadComms].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      const latest = sorted[sorted.length - 1]
      for (const c of sorted) usedIds.add(c.id)
      items.push({ kind: 'thread', threadId, comms: sorted, latest })
    }
  }

  // 2. Portal/system grouping: consecutive entries for same work_order_id within 45 min on same day
  const singles = comms
    .filter(c => !usedIds.has(c.id))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

  let i = 0
  while (i < singles.length) {
    const c = singles[i]
    const isSysType = c.type === 'portal' || c.type === 'system'

    if (isSysType) {
      const group: Comm[] = [c]
      let j = i + 1
      while (j < singles.length) {
        const next = singles[j]
        const nextIsSys = next.type === 'portal' || next.type === 'system'
        if (
          nextIsSys &&
          next.work_order_id === c.work_order_id &&
          dateStr(next.created_at) === dateStr(c.created_at) &&
          minutesBetween(group[group.length - 1].created_at, next.created_at) <= 45
        ) {
          group.push(next)
          j++
        } else {
          break
        }
      }
      if (group.length >= 2) {
        items.push({ kind: 'sysgroup', comms: group, workOrderId: c.work_order_id })
        i = j
      } else {
        items.push({ kind: 'single', comm: c })
        i++
      }
    } else {
      items.push({ kind: 'single', comm: c })
      i++
    }
  }

  // 3. Sort all display items newest-first
  items.sort((a, b) => anchorTime(b).localeCompare(anchorTime(a)))
  return items
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function isUnreadComm(c: Comm): boolean {
  return !c.read_at && c.direction === 'inbound' && c.type !== 'portal' && c.type !== 'system'
}

function matchesSearch(c: Comm, q: string): boolean {
  const s = q.toLowerCase()
  return (
    (c.subject?.toLowerCase().includes(s) ?? false) ||
    (c.content?.toLowerCase().includes(s) ?? false) ||
    (c.contact_name?.toLowerCase().includes(s) ?? false) ||
    (c.from_email?.toLowerCase().includes(s) ?? false)
  )
}

function passesFilters(c: Comm, f: CommsFilters, search: string): boolean {
  if (f.types.length > 0 && !f.types.includes(c.type)) return false
  if (f.contactTypes.length > 0 && (!c.contact_type || !f.contactTypes.includes(c.contact_type))) return false
  if (f.starred && !c.is_starred) return false
  if (f.needsAction && !c.requires_action) return false
  if (f.unread && !isUnreadComm(c)) return false
  if (search && !matchesSearch(c, search)) return false
  return true
}

function filterItems(items: DisplayItem[], f: CommsFilters, search: string): DisplayItem[] {
  return items.filter(item => {
    if (item.kind === 'single') return passesFilters(item.comm, f, search)

    if (item.kind === 'thread') {
      if (f.types.length > 0 && !f.types.includes('email')) return false
      if (f.unread && !item.comms.some(isUnreadComm)) return false
      if (f.starred && !item.comms.some(c => c.is_starred)) return false
      if (f.needsAction && !item.comms.some(c => c.requires_action)) return false
      if (f.contactTypes.length > 0 && !item.comms.some(c => c.contact_type && f.contactTypes.includes(c.contact_type))) return false
      if (search && !item.comms.some(c => matchesSearch(c, search))) return false
      return true
    }

    // sysgroup
    if (f.unread) return false
    if (f.types.length > 0 && !f.types.some(t => item.comms.some(c => c.type === t))) return false
    if (f.starred && !item.comms.some(c => c.is_starred)) return false
    if (f.needsAction && !item.comms.some(c => c.requires_action)) return false
    if (f.contactTypes.length > 0) return false
    if (search && !item.comms.some(c => matchesSearch(c, search))) return false
    return true
  })
}

// ── Day grouping ──────────────────────────────────────────────────────────────

interface DayGroup { label: string; items: DisplayItem[] }

function groupByDay(items: DisplayItem[]): DayGroup[] {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const map = new Map<string, DayGroup>()

  for (const item of items) {
    const d = anchorTime(item).slice(0, 10) || 'unknown'
    if (!map.has(d)) {
      let label: string
      if (d === today) label = 'Today'
      else if (d === yesterday) label = 'Yesterday'
      else if (d === 'unknown') label = 'Unknown date'
      else label = new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
      map.set(d, { label, items: [] })
    }
    map.get(d)!.items.push(item)
  }

  return [...map.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([, g]) => g)
}

// ── AI summary panel ──────────────────────────────────────────────────────────

function SummaryPanel({
  summary,
  scope,
  loading,
  onClose,
  onRegenerate,
}: {
  summary: AiSummary | null
  scope: AiScope
  loading: boolean
  onClose: () => void
  onRegenerate: () => void
}) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e6dfd0',
      borderLeft: '4px solid #c9a961',
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 16,
      fontFamily: 'DM Sans, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>✦</span>
        <span style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8a6d2e', fontWeight: 700 }}>
          AI Summary
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, background: '#f8f2e3', color: '#8a6d2e', padding: '2px 8px', borderRadius: 10 }}>
          {scope === 'recent' ? 'Last 14 days' : 'Full history'}
        </span>
        <button
          onClick={onClose}
          style={{ marginLeft: 'auto', cursor: 'pointer', color: '#8a8272', fontSize: 14, background: 'none', border: 'none', padding: 0, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#8a8272', fontWeight: 300, padding: '8px 0' }}>Generating summary…</div>
      ) : summary ? (
        <>
          {([
            { key: 'where_its_at' as const, label: "Where it's at" },
            { key: 'what_happened' as const, label: "What's happened" },
            { key: 'issues' as const, label: "What's gone wrong / worth knowing" },
            { key: 'outstanding' as const, label: 'Still outstanding' },
          ] as const).map(({ key, label }) => {
            const bullets = summary[key]
            if (!bullets || bullets.length === 0) return null
            return (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8272', fontWeight: 700, marginBottom: 6 }}>
                  {label}
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {bullets.map((b, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.55, color: '#3a352c', paddingLeft: 16, position: 'relative', marginBottom: 5 }}>
                      <span style={{ position: 'absolute', left: 0, color: '#c9a961', fontWeight: 900 }}>•</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <button
            onClick={onRegenerate}
            style={{
              fontSize: 11, color: '#8a6d2e', marginTop: 4, cursor: 'pointer',
              display: 'inline-block', border: '1px solid #c9a961', padding: '4px 10px',
              borderRadius: 6, background: 'none', fontFamily: 'inherit',
            }}
          >
            ↻ Regenerate
          </button>
        </>
      ) : (
        <div style={{ fontSize: 13, color: '#c05a4a', fontWeight: 300 }}>Failed to generate summary. Please try again.</div>
      )}
    </div>
  )
}

// ── AI scope popover ──────────────────────────────────────────────────────────

function AiPopover({ onSelect, onClose }: { onSelect: (s: AiScope) => void; onClose: () => void }) {
  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [onClose])

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 36, right: 0, background: '#fff',
        border: '1px solid #e6dfd0', borderRadius: 10,
        boxShadow: '0 10px 28px rgba(0,0,0,.10)', width: 248, zIndex: 30, overflow: 'hidden',
      }}
    >
      {([
        { scope: 'recent' as const, title: 'Recent recap', desc: "What's happened in the last 14 days" },
        { scope: 'full' as const, title: 'Full job history', desc: "Everything since the job opened — status, issues, what's outstanding" },
      ]).map(({ scope, title, desc }) => (
        <div
          key={scope}
          onClick={() => onSelect(scope)}
          style={{
            padding: '12px 14px', cursor: 'pointer',
            borderBottom: scope === 'recent' ? '1px solid #e6dfd0' : 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f8f2e3')}
          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1b1712' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#8a8272', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
        </div>
      ))}
    </div>
  )
}

// ── CommsFeed ─────────────────────────────────────────────────────────────────

export function CommsFeed({ jobId }: { jobId: string }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [comms, setComms] = useState<Comm[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchRevision, setFetchRevision] = useState(0)
  const [filters, setFilters] = useState<CommsFilters>(DEFAULT_FILTERS)
  const [search, setSearch] = useState('')
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiScopeVisible, setAiScopeVisible] = useState(false)
  const [aiScope, setAiScope] = useState<AiScope>('full')
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // ── Auth bootstrap ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const { data: profile } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (!profile) return
      setTenantId((profile as { tenant_id: string }).tenant_id)
    }
    init()
  }, [])

  const refetch = useCallback(() => setFetchRevision(r => r + 1), [])

  // ── Fetch comms ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !tenantId) return
    async function fetchComms() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/communications?job_id=${encodeURIComponent(jobId)}`)
        if (!res.ok) {
          const body = await res.json() as { error?: string }
          setFetchError(body.error ?? 'Failed to load communications')
          return
        }
        setComms(await res.json() as Comm[])
      } catch {
        setFetchError('Failed to load communications')
      } finally {
        setLoading(false)
      }
    }
    fetchComms()
  }, [userId, tenantId, jobId, fetchRevision])

  // ── Optimistic read/star updates ─────────────────────────────────────────────
  const handleMarkRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const now = new Date().toISOString()
    setComms(prev => prev.map(c => ids.includes(c.id) && !c.read_at ? { ...c, read_at: now } : c))
    ids.forEach(id => {
      fetch(`/api/communications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read_at: now }),
      }).catch(err => console.error('[CommsFeed] mark-read error:', err))
    })
  }, [])

  const handleToggleStar = useCallback((id: string, starred: boolean) => {
    setComms(prev => prev.map(c => c.id === id ? { ...c, is_starred: starred } : c))
    fetch(`/api/communications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_starred: starred }),
    }).catch(err => console.error('[CommsFeed] star error:', err))
  }, [])

  // ── AI summary ───────────────────────────────────────────────────────────────
  async function generateSummary(scope: AiScope) {
    setAiScope(scope)
    setAiScopeVisible(false)
    setAiPanelOpen(true)
    setAiSummary(null)
    setAiLoading(true)
    try {
      const res = await fetch('/api/communications/summarise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, scope }),
      })
      if (!res.ok) { setAiSummary(null); return }
      setAiSummary(await res.json() as AiSummary)
    } catch {
      setAiSummary(null)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Derived display items ────────────────────────────────────────────────────
  const displayItems = useMemo(() => buildDisplayItems(comms), [comms])
  const filtered = useMemo(() => filterItems(displayItems, filters, search), [displayItems, filters, search])
  const dayGroups = useMemo(() => groupByDay(filtered), [filtered])

  const unreadCount = useMemo(() => comms.filter(isUnreadComm).length, [comms])
  const activeFilterCount =
    filters.types.length + filters.contactTypes.length +
    (filters.unread ? 1 : 0) + (filters.starred ? 1 : 0) + (filters.needsAction ? 1 : 0)

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: '.14em', fontWeight: 700, textTransform: 'uppercase', color: '#8a8272' }}>
          Communications Feed
        </span>
        {!loading && (
          <span style={{ fontSize: 12, color: '#8a8272' }}>
            {comms.length} total
            {unreadCount > 0 && (
              <span style={{ color: '#4a6fd4', fontWeight: 700, marginLeft: 6 }}>· {unreadCount} unread</span>
            )}
          </span>
        )}
      </div>

      {/* AI summary panel */}
      {aiPanelOpen && (
        <SummaryPanel
          summary={aiSummary}
          scope={aiScope}
          loading={aiLoading}
          onClose={() => setAiPanelOpen(false)}
          onRegenerate={() => generateSummary(aiScope)}
        />
      )}

      {/* Feed card */}
      <div style={{ background: '#fff', border: '1px solid #e6dfd0', borderRadius: 10, overflow: 'hidden' }}>

        {/* Toolbar: filters + AI button + search */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '0.5px solid #e6dfd0' }}>
          <div style={{ flex: 1 }}>
            <CommsFilterBar
              filters={filters}
              search={search}
              activeCount={activeFilterCount}
              onChange={setFilters}
              onSearchChange={setSearch}
            />
          </div>

          {/* AI Summarise button */}
          <div style={{ position: 'relative', flexShrink: 0, padding: '0 14px 0 4px' }}>
            <button
              onClick={e => { e.stopPropagation(); setAiScopeVisible(v => !v) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                background: '#f8f2e3', border: '1px solid #e6d6a8',
                borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                color: '#8a6d2e', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 12, color: '#b8934a' }}>✦</span>
              AI Summarise
            </button>
            {aiScopeVisible && (
              <AiPopover
                onSelect={generateSummary}
                onClose={() => setAiScopeVisible(false)}
              />
            )}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#8a8272', fontWeight: 300 }}>
            Loading…
          </div>
        ) : fetchError ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#c05a4a', fontWeight: 300 }}>
            {fetchError}
          </div>
        ) : dayGroups.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#b0a898', fontWeight: 300 }}>
            {comms.length === 0 ? 'No communications yet' : 'No results match the current filters'}
          </div>
        ) : (
          <div style={{ maxHeight: 760, overflowY: 'auto' }}>
            {dayGroups.map(group => (
              <div key={group.label}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 5,
                  background: '#efe9dd', padding: '7px 16px',
                  fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                  textTransform: 'uppercase', color: '#6b6455',
                  borderBottom: '0.5px solid #e6dfd0',
                }}>
                  {group.label}
                </div>
                {group.items.map((item, idx) => (
                  <CommsItem
                    key={item.kind === 'single' ? item.comm.id : item.kind === 'thread' ? item.threadId : `sys-${idx}`}
                    item={item}
                    onMarkRead={handleMarkRead}
                    onToggleStar={handleToggleStar}
                    onReplySent={refetch}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
