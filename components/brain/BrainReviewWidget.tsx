'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import type { BrainEntry, BrainReviewQueue } from '@/types/brain'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

type ReviewSection = 'draft' | 'stale' | 'contradicted'

interface ReviewItem {
  entry: BrainEntry
  section: ReviewSection
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function reviewDueAt(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString()
}

const SECTION_LABEL: Record<ReviewSection, string> = {
  draft: 'DRAFT',
  stale: 'STALE',
  contradicted: 'CONTRADICTED',
}

export function BrainReviewWidget() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [queue, setQueue] = useState<BrainReviewQueue | null>(null)
  const [loading, setLoading] = useState(true)

  const [editingEntry, setEditingEntry] = useState<BrainEntry | null>(null)
  const [editSection, setEditSection] = useState<ReviewSection | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (profile) setTenantId((profile as { tenant_id: string }).tenant_id)
    }
    init()
  }, [])

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/brain/review/queue')
      if (res.ok) {
        const data = (await res.json()) as BrainReviewQueue
        setQueue(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!tenantId) return
    fetchQueue()
  }, [tenantId, fetchQueue])

  async function handleApprove(id: string) {
    await fetch('/api/brain/review/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchQueue()
  }

  async function handleDiscard(id: string) {
    if (!tenantId) return
    await supabase
      .from('brain_entries')
      .update({ status: 'deprecated' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    await fetchQueue()
  }

  async function handleStillCorrect(id: string) {
    if (!tenantId) return
    await supabase
      .from('brain_entries')
      .update({ last_reviewed_at: new Date().toISOString(), review_due_at: reviewDueAt() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    await fetchQueue()
  }

  async function handleDeprecate(id: string) {
    if (!tenantId) return
    await supabase
      .from('brain_entries')
      .update({ status: 'deprecated' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    await fetchQueue()
  }

  function startEdit(entry: BrainEntry, section: ReviewSection) {
    setEditingEntry(entry)
    setEditSection(section)
    setEditContent(entry.content)
  }

  function cancelEdit() {
    setEditingEntry(null)
    setEditSection(null)
    setEditContent('')
  }

  async function saveEdit() {
    if (!editingEntry || !tenantId) return
    setSaving(true)
    await supabase
      .from('brain_entries')
      .update({
        content: editContent,
        previous_content: editingEntry.content,
        version: editingEntry.version + 1,
        updated_by: null,
      })
      .eq('id', editingEntry.id)
      .eq('tenant_id', tenantId)
    setSaving(false)
    cancelEdit()
    await fetchQueue()
  }

  if (loading) {
    return (
      <div style={widgetWrap}>
        <div style={headerStyle}>
          <span>🧠 Brain</span>
          <span style={headerMeta}>Loading…</span>
        </div>
      </div>
    )
  }

  const total = queue?.total ?? 0

  if (!queue || total === 0) {
    return (
      <div style={widgetWrap}>
        <div style={headerStyle}>
          <span>🧠 Brain — all good</span>
        </div>
      </div>
    )
  }

  const allItems: ReviewItem[] = [
    ...queue.draft.map((e) => ({ entry: e, section: 'draft' as ReviewSection })),
    ...queue.stale.map((e) => ({ entry: e, section: 'stale' as ReviewSection })),
    ...queue.contradicted.map((e) => ({
      entry: e,
      section: 'contradicted' as ReviewSection,
    })),
  ]
  const shown = allItems.slice(0, 5)
  const moreCount = allItems.length - shown.length

  const shownBySection: Record<ReviewSection, ReviewItem[]> = {
    draft: shown.filter((i) => i.section === 'draft'),
    stale: shown.filter((i) => i.section === 'stale'),
    contradicted: shown.filter((i) => i.section === 'contradicted'),
  }

  return (
    <div style={widgetWrap}>
      <div style={headerStyle}>
        <span>🧠 Brain</span>
        <span style={badgeStyle}>{total} need review</span>
      </div>

      <div style={{ padding: '4px 0 8px' }}>
        {(['draft', 'stale', 'contradicted'] as ReviewSection[]).map((section) => {
          const items = shownBySection[section]
          if (items.length === 0) return null
          return (
            <div key={section} style={{ marginBottom: 8 }}>
              <div style={sectionLabel}>{SECTION_LABEL[section]}</div>
              {items.map(({ entry }) => {
                const isEditing = editingEntry?.id === entry.id

                return (
                  <div key={entry.id} style={entryWrap}>
                    <div style={entryTitle}>· {entry.title}</div>

                    {section === 'stale' && (
                      <div style={entryMeta}>
                        Last reviewed {daysSince(entry.last_reviewed_at)} days ago
                      </div>
                    )}
                    {section === 'contradicted' && (
                      <div style={entryMeta}>
                        Contradicted {entry.times_contradicted} times
                      </div>
                    )}

                    {isEditing ? (
                      <div style={{ marginTop: 8 }}>
                        {section === 'contradicted' && (
                          <div style={contradictionNote}>
                            This entry has been contradicted {entry.times_contradicted} times — review and correct below.
                          </div>
                        )}
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          style={editTextarea}
                          rows={4}
                        />
                        <div style={actionRow}>
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            style={{ ...actionBtn, ...confirmBtn }}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={cancelEdit} style={{ ...actionBtn, ...editBtnStyle }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={actionRow}>
                        {section === 'draft' && (
                          <>
                            <button
                              onClick={() => handleApprove(entry.id)}
                              style={{ ...actionBtn, ...confirmBtn }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => startEdit(entry, section)}
                              style={{ ...actionBtn, ...editBtnStyle }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDiscard(entry.id)}
                              style={{ ...actionBtn, ...ghostBtn }}
                            >
                              Discard
                            </button>
                          </>
                        )}
                        {section === 'stale' && (
                          <>
                            <button
                              onClick={() => handleStillCorrect(entry.id)}
                              style={{ ...actionBtn, ...confirmBtn }}
                            >
                              Still correct
                            </button>
                            <button
                              onClick={() => startEdit(entry, section)}
                              style={{ ...actionBtn, ...editBtnStyle }}
                            >
                              Edit
                            </button>
                          </>
                        )}
                        {section === 'contradicted' && (
                          <>
                            <button
                              onClick={() => startEdit(entry, section)}
                              style={{ ...actionBtn, ...confirmBtn }}
                            >
                              Review
                            </button>
                            <button
                              onClick={() => handleDeprecate(entry.id)}
                              style={{ ...actionBtn, ...ghostBtn }}
                            >
                              Deprecate
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {moreCount > 0 && (
          <a href="/dashboard/brain" style={moreLinkStyle}>
            and {moreCount} more →
          </a>
        )}
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const widgetWrap: React.CSSProperties = {
  background: '#fff',
  border: '0.5px solid #e4dfd8',
  borderRadius: 8,
  overflow: 'hidden',
  marginTop: 24,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 16px',
  borderBottom: '0.5px solid #f0ece6',
  background: '#fdfdfc',
  fontSize: 14,
  fontWeight: 500,
  color: '#1a1a1a',
}

const headerMeta: React.CSSProperties = {
  fontSize: 11,
  color: '#c8b89a',
  fontWeight: 300,
}

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#c8b89a',
  fontWeight: 600,
  background: '#faf5ee',
  border: '0.5px solid #e8ddd0',
  padding: '2px 9px',
  borderRadius: 20,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: '#b8b0a8',
  fontWeight: 500,
  padding: '8px 16px 4px',
}

const entryWrap: React.CSSProperties = {
  padding: '6px 16px 8px',
  borderBottom: '0.5px solid #f5f2ee',
}

const entryTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: '#1a1a1a',
  marginBottom: 3,
}

const entryMeta: React.CSSProperties = {
  fontSize: 11,
  color: '#9a9088',
  fontWeight: 300,
  marginBottom: 5,
}

const actionRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 6,
  flexWrap: 'wrap',
}

const actionBtn: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 12px',
  borderRadius: 20,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
  border: '1px solid transparent',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
}

const confirmBtn: React.CSSProperties = {
  background: '#2a6b50',
  color: '#fff',
  borderColor: '#2a6b50',
}

const editBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#7a6a58',
  borderColor: '#d4cfc8',
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#9a9088',
  borderColor: '#e8e3dc',
}

const editTextarea: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '8px 10px',
  border: '0.5px solid #e4dfd8',
  borderRadius: 6,
  background: '#fff',
  color: '#1a1a1a',
  fontFamily: 'inherit',
  fontWeight: 300,
  outline: 'none',
  resize: 'vertical',
  lineHeight: 1.55,
  boxSizing: 'border-box',
}

const contradictionNote: React.CSSProperties = {
  fontSize: 11,
  color: '#92400e',
  background: '#fffbeb',
  borderLeft: '2px solid #f59e0b',
  padding: '4px 8px',
  marginBottom: 6,
  borderRadius: '0 4px 4px 0',
}

const moreLinkStyle: React.CSSProperties = {
  display: 'block',
  padding: '6px 16px',
  fontSize: 11,
  color: '#c8b89a',
  textDecoration: 'none',
  fontWeight: 500,
}
