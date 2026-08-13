'use client'

import { useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { CommsItem } from './CommsItem'
import type { Comm } from './CommsItem'
import { CommsFilterBar } from './CommsFilterBar'
import type { CommsFilters } from './CommsFilterBar'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const DEFAULT_FILTERS: CommsFilters = {
  types: [],
  contactTypes: [],
  dateFrom: '',
  dateTo: '',
}

export function CommsFeed({ jobId }: { jobId: string }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [comms, setComms] = useState<Comm[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CommsFilters>(DEFAULT_FILTERS)

  // ── Auth bootstrap ─────────────────────────────────────────────────────────
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

  // ── Fetch comms (after auth) ───────────────────────────────────────────────
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
        const data = await res.json() as Comm[]
        setComms(data)
      } catch {
        setFetchError('Failed to load communications')
      } finally {
        setLoading(false)
      }
    }

    fetchComms()
  }, [userId, tenantId, jobId])

  // ── Derived: unique contact types for filter bar ───────────────────────────
  const contactTypeOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const c of comms) {
      if (c.contact_type) seen.add(c.contact_type)
    }
    return Array.from(seen).sort()
  }, [comms])

  // ── Client-side filter application ────────────────────────────────────────
  const filtered = useMemo(() => {
    return comms.filter(c => {
      if (filters.types.length > 0 && !filters.types.includes(c.type)) return false
      if (
        filters.contactTypes.length > 0 &&
        (!c.contact_type || !filters.contactTypes.includes(c.contact_type))
      ) return false
      const dateStr = c.created_at ? c.created_at.slice(0, 10) : null
      if (filters.dateFrom && dateStr && dateStr < filters.dateFrom) return false
      if (filters.dateTo   && dateStr && dateStr > filters.dateTo)   return false
      return true
    })
  }, [comms, filters])

  return (
    <div
      style={{
        background: '#fff',
        border: '0.5px solid #e4dfd8',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '0.5px solid #e4dfd8',
        }}
      >
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: '#9e998f',
            fontWeight: 500,
          }}
        >
          Communications Feed
        </span>
        {!loading && (
          <span
            style={{
              fontSize: 10,
              color: '#c8b89a',
              fontFamily: 'DM Mono, monospace',
            }}
          >
            {filtered.length !== comms.length
              ? `${filtered.length} / ${comms.length}`
              : `${comms.length} total`}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <CommsFilterBar
        filters={filters}
        contactTypeOptions={contactTypeOptions}
        onChange={setFilters}
      />

      {/* Body */}
      {loading ? (
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            fontSize: 13,
            color: '#9e998f',
            fontWeight: 300,
          }}
        >
          Loading…
        </div>
      ) : fetchError ? (
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            fontSize: 13,
            color: '#b91c1c',
            fontWeight: 300,
          }}
        >
          {fetchError}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            fontSize: 13,
            color: '#b0a898',
            fontWeight: 300,
          }}
        >
          {comms.length === 0 ? 'No communications yet' : 'No results match the current filters'}
        </div>
      ) : (
        <div>
          {filtered.map(c => (
            <CommsItem key={c.id} comm={c} />
          ))}
        </div>
      )}
    </div>
  )
}
