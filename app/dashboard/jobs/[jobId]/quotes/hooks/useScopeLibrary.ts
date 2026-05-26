'use client'

import Fuse from 'fuse.js'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  trade_rate_total: number | null
  estimated_hours: number | null
  quote_ref: string | null
  job_number: string | null
  reference_date: string | null
}

interface UseScopeLibraryOptions {
  tenantId: string
  insurer?: string | null
}

export function useScopeLibrary({ tenantId, insurer }: UseScopeLibraryOptions) {
  const [items, setItems] = useState<ScopeSearchResult[]>([])
  const [ready, setReady] = useState(false)
  const libFuseRef = useRef<Fuse<ScopeSearchResult> | null>(null)
  const refFuseRef = useRef<Fuse<ScopeSearchResult> | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ tenantId })
    if (insurer) params.set('insurer', insurer)

    fetch(`/api/scope-library/search?${params}`)
      .then(r => r.json())
      .then((data: ScopeSearchResult[]) => {
        if (cancelled) return
        setItems(data)

        const libraryItems = data.filter(i => i.result_type === 'library')
        const referenceItems = data.filter(i => i.result_type === 'reference')

        libFuseRef.current = new Fuse(libraryItems, {
          keys: ['item_description', 'keyword'],
          threshold: 0.35,
          includeScore: true,
          ignoreLocation: true,
        })

        refFuseRef.current = new Fuse(referenceItems, {
          keys: ['item_description'],
          threshold: 0.35,
          includeScore: true,
          ignoreLocation: true,
        })

        setReady(true)
      })
      .catch(() => {
        setReady(false)
      })

    return () => {
      cancelled = true
    }
  }, [tenantId, insurer])

  const search = useCallback((query: string): ScopeSearchResult[] => {
    if (!query.trim()) return []

    // Library results — insurer-specific rows first within same score band
    const libResults = libFuseRef.current?.search(query, { limit: 16 }) ?? []
    libResults.sort((a, b) => {
      const scoreDiff = (a.score ?? 0) - (b.score ?? 0)
      if (Math.abs(scoreDiff) > 0.05) return scoreDiff
      const aSpec = a.item.insurer_specific != null ? 0 : 1
      const bSpec = b.item.insurer_specific != null ? 0 : 1
      return aSpec - bSpec
    })
    const topLib = libResults.slice(0, 8).map(r => r.item)

    // Reference results — scored order
    const refResults = refFuseRef.current?.search(query, { limit: 10 }) ?? []
    refResults.sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    const topRef = refResults.slice(0, 5).map(r => r.item)

    return [...topLib, ...topRef]
  }, [])

  return { items, search, ready }
}
