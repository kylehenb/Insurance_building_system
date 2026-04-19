'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ItemType = 'provisional_sum' | 'prime_cost' | 'cash_settlement' | null

export interface ScopeItem {
  id: string
  /** Client-only stable key — set to the original temp ID and preserved through the temp→real ID swap.
   *  Undefined for items loaded from the server that were never temp. */
  _key?: string
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
  labour_total: number | null
  materials_total: number | null
  split_type: string | null
  item_type: ItemType
  approval_status: string
  is_custom: boolean
  library_writeback_approved: boolean
  preliminary_formula: string | null
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
  permit_block_dismissed: boolean
  room_order: string[] | null
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

function makeTempItem(
  quoteId: string,
  tenantId: string,
  room: string,
  overrides: Partial<ScopeItem> = {},
  sortHint = 0
): ScopeItem {
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id: tempId,
    _key: tempId,
    tenant_id: tenantId,
    quote_id: quoteId,
    scope_library_id: null,
    room,
    room_length: null,
    room_width: null,
    room_height: null,
    trade: null,
    keyword: null,
    item_description: null,
    unit: null,
    qty: null,
    rate_labour: null,
    rate_materials: null,
    rate_total: null,
    line_total: null,
    labour_total: null,
    materials_total: null,
    split_type: null,
    item_type: null,
    approval_status: 'pending',
    is_custom: true,
    library_writeback_approved: false,
    preliminary_formula: null,
    sort_order: sortHint,
    created_at: new Date().toISOString(),
    ...overrides,
  }
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
  const prevSubtotalRef = useRef<number>(0)

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

  // Flush all pending item saves when the hook unmounts (e.g. when the inline
  // editor is hidden). This prevents data loss if debounce timers are still
  // pending at the time the component tree is torn down.
  useEffect(() => {
    return () => {
      for (const timer of debounceTimers.current.values()) {
        clearTimeout(timer)
      }
      debounceTimers.current.clear()

      for (const [itemId, changes] of pendingChanges.current) {
        if (!itemId.startsWith('temp-') && Object.keys(changes).length > 0) {
          void fetch(`/api/quotes/${quoteId}/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, ...changes }),
          })
        }
      }
      pendingChanges.current.clear()
    }
  // quoteId and tenantId are stable for the lifetime of this hook instance
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flushItem = useCallback(
    async (itemId: string) => {
      const timer = debounceTimers.current.get(itemId)
      if (timer) clearTimeout(timer)
      debounceTimers.current.delete(itemId)

      const changes = pendingChanges.current.get(itemId)
      if (!changes || Object.keys(changes).length === 0) return
      pendingChanges.current.delete(itemId)

      // Don't flush temp items — they haven't been persisted yet
      if (itemId.startsWith('temp-')) return

      try {
        const res = await fetch(`/api/quotes/${quoteId}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, ...changes }),
        })
        if (!res.ok) throw new Error('Save failed')
        // Local state is already correct — do not replace with server response
        setSaveStatusTimed('saved')
      } catch {
        setSaveStatusTimed('error')
      }
    },
    [quoteId, tenantId, setSaveStatusTimed]
  )

  const scheduleItemSave = useCallback(
    (itemId: string, changes: Record<string, unknown>) => {
      // `labour_total` and `materials_total` are client-only display values
      // (qty × rate) that have no DB column. Including them in a PATCH body
      // causes Supabase to reject the entire update, silently losing all other
      // fields (rate_labour, trade, room dimensions, …) in the same batch.
      // Strip them here so they can still update local state via updateItemLocal
      // without ever reaching the server.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { labour_total: _lt, materials_total: _mt, ...persistableChanges } = changes
      if (Object.keys(persistableChanges).length === 0) return

      const existing = pendingChanges.current.get(itemId) ?? {}
      pendingChanges.current.set(itemId, { ...existing, ...persistableChanges })

      // Temp items: accumulate changes but defer flush until real ID is confirmed
      if (itemId.startsWith('temp-')) return

      const existingTimer = debounceTimers.current.get(itemId)
      if (existingTimer) clearTimeout(existingTimer)

      setSaveStatus('saving')

      const timer = setTimeout(() => flushItem(itemId), 600)
      debounceTimers.current.set(itemId, timer)
    },
    [flushItem]
  )

  // Recalculate preliminary items when subtotal changes
  const prevItemsRef = useRef<ScopeItem[]>([])
  useEffect(() => {
    if (!quote || items.length === 0) return

    // Skip if items reference hasn't changed (shallow comparison)
    if (prevItemsRef.current === items) return
    prevItemsRef.current = items

    // Calculate subtotal excluding preliminary items to avoid circular dependency
    const nonPrelimItems = items.filter(i => !i.preliminary_formula || i.room !== 'Preliminaries')
    const subtotal = nonPrelimItems.reduce((sum, i) => sum + (i.line_total ?? 0), 0)
    const prelimItems = items.filter(i => i.preliminary_formula && i.room === 'Preliminaries')

    if (prelimItems.length === 0) return

    // Only recalculate if subtotal has changed significantly (more than 0.01)
    if (Math.abs(subtotal - prevSubtotalRef.current) < 0.01) return
    prevSubtotalRef.current = subtotal

    // Calculate new amounts for each preliminary item based on its formula
    const updatedItems = items.map(item => {
      if (!item.preliminary_formula || item.room !== 'Preliminaries') return item

      let newRate = 0
      switch (item.preliminary_formula) {
        case 'hii':
          newRate = Math.max(700, subtotal * 0.012)
          break
        case 'ctf':
          newRate = subtotal * 0.002
          break
        case 'bsl':
          newRate = subtotal <= 45000 ? 61.65 : subtotal * 0.00137
          break
        case 'council':
          newRate = Math.max(110, subtotal * 0.0019)
          break
        case 'cdc':
          newRate = Math.max(1050, subtotal * 0.00165)
          break
        default:
          return item
      }

      newRate = Math.round(newRate * 100) / 100
      const newLineTotal = item.qty ? item.qty * newRate : newRate

      return {
        ...item,
        rate_materials: newRate,
        line_total: newLineTotal,
      }
    })

    // Only update if values actually changed
    const hasChanges = updatedItems.some(
      (updated, idx) => updated.rate_materials !== items[idx].rate_materials
    )

    if (hasChanges) {
      setItems(updatedItems)

      // Persist the changes to the server
      updatedItems.forEach(item => {
        if (item.preliminary_formula && !item.id.startsWith('temp-')) {
          scheduleItemSave(item.id, {
            rate_materials: item.rate_materials,
            line_total: item.line_total,
          })
        }
      })
    }
  }, [items, quote, scheduleItemSave])

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

  // Optimistic add: insert temp row immediately, persist in background
  const addItem = useCallback(
    (room: string, data: Partial<ScopeItem> = {}): ScopeItem => {
      // Calculate sort order hint from current items in this room
      const roomItems = items.filter(i => i.room === room)
      const maxSort = roomItems.reduce((m, i) => Math.max(m, i.sort_order), 0)
      const tempItem = makeTempItem(quoteId, tenantId, room, data, maxSort + 1)

      setItems(prev => [...prev, tempItem])

      // Persist in background; swap temp ID with real ID on success.
      // Send only the caller-supplied `data` overrides — NOT the full tempItem.
      // The tempItem is populated with client-side defaults (approval_status,
      // labour_total, materials_total, created_at, sort_order, …) that either
      // don't exist as DB columns or violate check constraints, causing the
      // INSERT to be rejected and the optimistic row to be silently removed.
      const tempId = tempItem.id
      // Strip any client-only / server-computed keys that may have leaked into
      // the data param (e.g. from CSV import or calcPermitItems).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, _key: _dk, room: _dr, tenant_id: _tid, quote_id: _qid,
              approval_status: _as, created_at: _ca, sort_order: _so,
              line_total: _lt, rate_total: _rt, labour_total: _labt,
              materials_total: _matt, ...safeData } = data as Record<string, unknown>
      void fetch(`/api/quotes/${quoteId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, room, ...safeData }),
      })
        .then(res => {
          if (!res.ok) throw new Error('Failed')
          return res.json() as Promise<ScopeItem>
        })
        .then(newItem => {
          // Preserve all local edits — only update the ID and server-generated fields
          setItems(prev =>
            prev.map(i =>
              i.id === tempId
                ? { ...i, id: newItem.id, sort_order: newItem.sort_order, created_at: newItem.created_at }
                : i
            )
          )
          // Transfer any edits made while item was temp, then flush immediately
          // (don't re-debounce — we've already been waiting for the POST)
          const tempPending = pendingChanges.current.get(tempId)
          pendingChanges.current.delete(tempId)
          if (tempPending && Object.keys(tempPending).length > 0) {
            pendingChanges.current.set(newItem.id, tempPending)
            void flushItem(newItem.id)
          }
        })
        .catch(() => {
          pendingChanges.current.delete(tempId)
          setItems(prev => prev.filter(i => i.id !== tempId))
        })

      return tempItem
    },
    [quoteId, tenantId, items, scheduleItemSave, flushItem]
  )

  const deleteItem = useCallback(
    async (itemId: string) => {
      const timer = debounceTimers.current.get(itemId)
      if (timer) clearTimeout(timer)
      debounceTimers.current.delete(itemId)
      pendingChanges.current.delete(itemId)

      // Capture item before removing so we can re-insert on failure
      let deletedItem: ScopeItem | undefined
      setItems(prev => {
        deletedItem = prev.find(i => i.id === itemId)
        return prev.filter(i => i.id !== itemId)
      })

      if (itemId.startsWith('temp-')) return

      const res = await fetch(`/api/quotes/${quoteId}/items/${itemId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok && deletedItem) {
        const item = deletedItem
        setItems(prev => [...prev, item].sort((a, b) => a.sort_order - b.sort_order))
        setSaveStatusTimed('error')
      }
    },
    [quoteId, tenantId, setSaveStatusTimed]
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
      const roomItems = items.filter(i => i.room === oldName && !i.id.startsWith('temp-'))
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
      changes: Partial<
        Pick<
          QuoteData,
          'markup_pct' | 'gst_pct' | 'status' | 'notes' | 'is_locked' | 'permit_block_dismissed'
        >
      >
    ) => {
      setQuote(prev => (prev ? { ...prev, ...changes } : null))
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...changes }),
      })
      if (!res.ok) setSaveStatusTimed('error')
    },
    [quoteId, tenantId, setSaveStatusTimed]
  )

  // Reorder items within a room — optimistic, then persist
  const reorderItems = useCallback(
    (room: string, orderedIds: string[]) => {
      let prevRoomItems: ScopeItem[] = []
      setItems(prev => {
        prevRoomItems = prev.filter(i => i.room === room)
        const withoutRoom = prev.filter(i => i.room !== room)
        const reordered = orderedIds
          .map((id, idx) => {
            const item = prev.find(i => i.id === id)
            return item ? { ...item, sort_order: idx } : null
          })
          .filter((i): i is ScopeItem => i !== null)
        return [...withoutRoom, ...reordered]
      })

      const realIds = orderedIds.filter(id => !id.startsWith('temp-'))
      if (realIds.length === 0) return

      void fetch(`/api/quotes/${quoteId}/items/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderedIds: realIds }),
      }).catch(() => {
        const snapshot = prevRoomItems
        setItems(prev => {
          const withoutRoom = prev.filter(i => i.room !== room)
          return [...withoutRoom, ...snapshot]
        })
        setSaveStatusTimed('error')
      })
    },
    [quoteId, tenantId, setSaveStatusTimed]
  )

  // Set item_type on all items in the quote (for Cash Settlement toggle)
  const setAllItemTypes = useCallback(
    async (type: ItemType) => {
      setItems(prev => prev.map(i => ({ ...i, item_type: type })))
      const realItems = items.filter(i => !i.id.startsWith('temp-'))
      await Promise.all(
        realItems.map(item =>
          fetch(`/api/quotes/${quoteId}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, item_type: type }),
          })
        )
      )
    },
    [items, quoteId, tenantId]
  )

  // Reorder rooms - optimistic, then persist
  const reorderRooms = useCallback(
    async (orderedRoomNames: string[]) => {
      setQuote(prev => (prev ? { ...prev, room_order: orderedRoomNames } : null))
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, room_order: orderedRoomNames }),
      })
      if (!res.ok) {
        setSaveStatusTimed('error')
        // Revert on error
        setQuote(prev => (prev ? { ...prev, room_order: prev.room_order } : null))
      }
    },
    [quoteId, tenantId, setSaveStatusTimed]
  )

  // Group items by room, respecting room_order if available; sort by sort_order within room
  const rooms: RoomGroup[] = (() => {
    const map = new Map<string, ScopeItem[]>()
    for (const item of items) {
      const room = item.room ?? ''
      if (!map.has(room)) map.set(room, [])
      map.get(room)!.push(item)
    }
    const allRooms = Array.from(map.entries()).map(([name, roomItems]) => ({
      name,
      items: [...roomItems].sort((a, b) => a.sort_order - b.sort_order),
    }))

    // If room_order is set, use it to sort rooms
    if (quote?.room_order && quote.room_order.length > 0) {
      const orderMap = new Map(quote.room_order.map((r, i) => [r, i]))
      return allRooms.sort((a, b) => {
        const aIdx = orderMap.get(a.name) ?? 999
        const bIdx = orderMap.get(b.name) ?? 999
        return aIdx - bIdx
      })
    }

    return allRooms
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
    reorderItems,
    reorderRooms,
    setAllItemTypes,
    reload: load,
  }
}
