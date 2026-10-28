'use client'

import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { createScopeSearch } from './search'

// The scope library a job picks from (priced for its insurer), plus lines
// marked as references on earlier quotes, for the quote editor's description
// search and the field app's scope items. Reloads when the tab comes back
// into view, so changes made in the scope library show straight away.

export interface ScopeSearchResult {
  result_type: 'library' | 'reference'
  id: string
  item_description: string | null
  unit: string | null
  rate_labour: number | null
  rate_materials: number | null
  rate_total: number | null
  trade: string | null
  keyword: string | null
  insurer_specific: string | null
  /** Saved from a quote and not yet approved in the scope library */
  pending: boolean
  trade_rate_total: number | null
  estimated_hours: number | null
  quote_ref: string | null
  job_number: string | null
  reference_date: string | null
}

interface UseScopeLibraryOptions {
  /** Prices for this job's insurer; without one, the standard items */
  jobId?: string | null
  /** Leave out the earlier-quote references (the field app only offers library items) */
  libraryOnly?: boolean
}

/**
 * A library item's own wording by id, for refilling its {QTY} placeholders
 * when a line's quantity changes (see fillQuantity).
 */
export const ScopeLibraryWording = createContext<(libraryId: string) => string | null>(() => null)

type Search = (query: string, limit?: number) => ScopeSearchResult[]

export function useScopeLibrary({ jobId, libraryOnly }: UseScopeLibraryOptions = {}) {
  const [items, setItems] = useState<ScopeSearchResult[]>([])
  const [ready, setReady] = useState(false)
  const libSearchRef = useRef<Search | null>(null)
  const refSearchRef = useRef<Search | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      const params = new URLSearchParams()
      if (jobId) params.set('jobId', jobId)
      fetch(`/api/scope-library/search?${params}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: ScopeSearchResult[]) => {
          if (cancelled) return
          setItems(data)
          libSearchRef.current = createScopeSearch(data.filter(i => i.result_type === 'library'))
          refSearchRef.current = libraryOnly ? null : createScopeSearch(data.filter(i => i.result_type === 'reference'))
          setReady(true)
        })
        // Keep what's loaded (or nothing): typing still works as custom text
        .catch(() => {})
    }
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [jobId, libraryOnly])

  const search = useCallback((query: string): ScopeSearchResult[] => {
    if (!query.trim()) return []
    const topLib = libSearchRef.current?.(query, 8) ?? []
    const topRef = refSearchRef.current?.(query, 5) ?? []
    return [...topLib, ...topRef]
  }, [])

  return { items, search, ready }
}
