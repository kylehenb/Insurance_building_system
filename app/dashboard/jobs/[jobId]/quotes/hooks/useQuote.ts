'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ScopeItem {
  id: string
  tenant_id: string
  quote_id: string
  scope_library_id: string | null
  room: string | null
  room_length: number | null
  room_width: number | null
  room_height: number | null
  trade: string | null
  keyword: string | null
  item_description: string | null
  unit: string | null
  qty: number | null
  rate_labour: number | null
  rate_materials: number | null
  rate_total: number | null
  line_total: number | null
  split_type: string | null
  approval_status: string
  is_custom: boolean
  library_writeback_approved: boolean
  sort_order: number
  created_at: string
}

export interface QuoteData {
  id: string
  tenant_id: string
  job_id: string
  quote_ref: string | null
  quote_type: string | null
  version: number
  is_active_version: boolean
  is_locked: boolean
  status: string
  total_amount: number | null
  markup_pct: number
  gst_pct: number
  notes: string | null
  created_at: string
}

export interface RoomGroup {
  name: string
  items: ScopeItem[]
}

interface UseQuoteOptions {
  quoteId: string
  tenantId: string
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function calcLineTotal(
  qty: number | null,
  rateLabour: number | null,
  rateMaterials: number | null
): number | null {
  if (qty == null) return null
  if (rateLabour == null && rateMaterials == null) return null
  return qty * ((rateLabour ?? 0) + (rateMaterials ?? 0))
}

export function useQuote({ quoteId, tenantId }: UseQuoteOptions) {
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [items, setItems] = useState<ScopeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingChanges = useRef<Map<string, Record<string, unknown>>>(new Map())
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setSaveStatusTimed = useCallback((status: SaveStatus) => {
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current)
    setSaveStatus(status)
    if (status === 'saved' || status === 'error') {
      saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 2500)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${quoteId}?tenantId=${tenantId}`)
      if (!res.ok) throw new Error('Failed to load quote')
      const data: QuoteData & { items: ScopeItem[] } = await res.json()
      const { items: rawItems, ...quoteData } = data
      setQuote(quoteData)
      setItems(rawItems)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [quoteId, tenantId])

  useEffect(() => {
    load()
  }, [load])

  const flushItem = useCallback(
    async (itemId: string) => {
      const timer = debounceTimers.current.get(itemId)
      if (timer) clearTimeout(timer)
      debounceTimers.current.delete(itemId)

      const changes = pendingChanges.current.get(itemId)
      if (!changes || Object.keys(changes).length === 0) return
      pendingChanges.current.delete(itemId)

      try {
        const res = await fetch(`/api/quotes/${quoteId}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, ...changes }),
        })
        if (!res.ok) throw new Error('Save failed')
        const updated: ScopeItem = await res.json()
        setItems(prev => prev.map(i => (i.id === itemId ? updated : i)))
        setSaveStatusTimed('saved')
      } catch {
        setSaveStatusTimed('error')
        // Reload to recover
        load()
      }
    },
    [quoteId, tenantId, load, setSaveStatusTimed]
  )

  const scheduleItemSave = useCallback(
    (itemId: string, changes: Record<string, unknown>) => {
      const existing = pendingChanges.current.get(itemId) ?? {}
      pendingChanges.current.set(itemId, { ...existing, ...changes })

      const existingTimer = debounceTimers.current.get(itemId)
      if (existingTimer) clearTimeout(existingTimer)

      setSaveStatus('saving')

      const timer = setTimeout(() => flushItem(itemId), 600)
      debounceTimers.current.set(itemId, timer)
    },
    [flushItem]
  )

  const updateItemLocal = useCallback(
    (itemId: string, changes: Record<string, unknown>) => {
      setItems(prev =>
        prev.map(item => {
          if (item.id !== itemId) return item
          const merged = { ...item, ...changes }
          const qty = 'qty' in changes ? (changes.qty as number | null) : item.qty
          const rL =
            'rate_labour' in changes ? (changes.rate_labour as number | null) : item.rate_labour
          const rM =
            'rate_materials' in changes
              ? (changes.rate_materials as number | null)
              : item.rate_materials
          merged.line_total = calcLineTotal(qty, rL, rM)
          return merged
        })
      )
      scheduleItemSave(itemId, changes)
    },
    [scheduleItemSave]
  )

  const addItem = useCallback(
    async (room: string, data: Partial<ScopeItem> = {}) => {
      const res = await fetch(`/api/quotes/${quoteId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, room, ...data }),
      })
      if (!res.ok) return null
      const newItem: ScopeItem = await res.json()
      setItems(prev => [...prev, newItem])
      return newItem
    },
    [quoteId, tenantId]
  )

  const deleteItem = useCallback(
    async (itemId: string) => {
      const timer = debounceTimers.current.get(itemId)
      if (timer) clearTimeout(timer)
      debounceTimers.current.delete(itemId)
      pendingChanges.current.delete(itemId)

      // Optimistic
      setItems(prev => prev.filter(i => i.id !== itemId))

      const res = await fetch(`/api/quotes/${quoteId}/items/${itemId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) {
        load()
      }
    },
    [quoteId, tenantId, load]
  )

  const updateRoomDimensions = useCallback(
    (
      room: string,
      dims: {
        room_length?: number | null
        room_width?: number | null
        room_height?: number | null
      }
    ) => {
      setItems(prev => prev.map(item => (item.room === room ? { ...item, ...dims } : item)))
      const roomItems = items.filter(i => i.room === room)
      for (const item of roomItems) {
        scheduleItemSave(item.id, dims as Record<string, unknown>)
      }
    },
    [items, scheduleItemSave]
  )

  const renameRoom = useCallback(
    async (oldName: string, newName: string) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === oldName) return
      setItems(prev => prev.map(item => (item.room === oldName ? { ...item, room: trimmed } : item)))
      const roomItems = items.filter(i => i.room === oldName)
      await Promise.all(
        roomItems.map(item =>
          fetch(`/api/quotes/${quoteId}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, room: trimmed }),
          })
        )
      )
    },
    [items, quoteId, tenantId]
  )

  const updateQuoteMeta = useCallback(
    async (
      changes: Partial<Pick<QuoteData, 'markup_pct' | 'gst_pct' | 'status' | 'notes'>>
    ) => {
      setQuote(prev => (prev ? { ...prev, ...changes } : null))
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...changes }),
      })
      if (!res.ok) load()
    },
    [quoteId, tenantId, load]
  )

  // Group items by room, preserving insertion order
  const rooms: RoomGroup[] = (() => {
    const map = new Map<string, ScopeItem[]>()
    for (const item of items) {
      const room = item.room ?? ''
      if (!map.has(room)) map.set(room, [])
      map.get(room)!.push(item)
    }
    return Array.from(map.entries()).map(([name, roomItems]) => ({ name, items: roomItems }))
  })()

  const subtotal = items.reduce((sum, i) => sum + (i.line_total ?? 0), 0)
  const markup = subtotal * (quote?.markup_pct ?? 0.19)
  const gst = (subtotal + markup) * (quote?.gst_pct ?? 0.1)
  const total = subtotal + markup + gst

  return {
    quote,
    items,
    rooms,
    loading,
    error,
    saveStatus,
    subtotal,
    markup,
    gst,
    total,
    updateItemLocal,
    addItem,
    deleteItem,
    updateRoomDimensions,
    renameRoom,
    updateQuoteMeta,
    reload: load,
  }
}
