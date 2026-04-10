'use client'

import Fuse from 'fuse.js'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface LibraryItem {
  id: string
  insurer_specific: string | null
  trade: string | null
  keyword: string | null
  item_description: string | null
  unit: string | null
  labour_per_unit: number | null
  materials_per_unit: number | null
  total_per_unit: number | null
  estimated_hours: number | null
}

interface UseScopeLibraryOptions {
  tenantId: string
  insurer?: string | null
}

export function useScopeLibrary({ tenantId, insurer }: UseScopeLibraryOptions) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [ready, setReady] = useState(false)
  const fuseRef = useRef<Fuse<LibraryItem> | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ tenantId })
    if (insurer) params.set('insurer', insurer)

    fetch(`/api/scope-library/search?${params}`)
      .then(r => r.json())
      .then((data: LibraryItem[]) => {
        if (cancelled) return
        setItems(data)
        fuseRef.current = new Fuse(data, {
          keys: ['item_description', 'keyword'],
          threshold: 0.35,
          includeScore: true,
          ignoreLocation: true,
        })
        setReady(true)
      })
      .catch(() => {
        // graceful fail — search just won't work
        setReady(false)
      })

    return () => {
      cancelled = true
    }
  }, [tenantId, insurer])

  const search = useCallback((query: string): LibraryItem[] => {
    if (!query.trim() || !fuseRef.current) return []

    const results = fuseRef.current.search(query, { limit: 16 })

    // Sort: insurer-specific rows before null (defaults) at the same score band
    results.sort((a, b) => {
      const scoreDiff = (a.score ?? 0) - (b.score ?? 0)
      if (Math.abs(scoreDiff) > 0.05) return scoreDiff
      const aSpec = a.item.insurer_specific != null ? 0 : 1
      const bSpec = b.item.insurer_specific != null ? 0 : 1
      return aSpec - bSpec
    })

    return results.slice(0, 8).map(r => r.item)
  }, [])

  return { items, search, ready }
}
