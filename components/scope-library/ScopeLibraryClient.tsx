'use client'

import { useState, useCallback } from 'react'
import type { ScopeLibraryItem, InsurersOption, PricingTiers } from '@/lib/types/scope-library'
import { ScopeLibraryItemRow } from './ScopeLibraryItem'
import { ScopeLibraryDraftItem } from './ScopeLibraryDraftItem'
import { ScopeLibraryImportModal } from './ScopeLibraryImportModal'

interface Props {
  tenantId: string
  initialItems: ScopeLibraryItem[]
  insurers: InsurersOption[]
}

interface NewItemForm {
  trade: string
  keyword: string
  item_description: string
  unit: string
  labour_per_unit: string
  materials_per_unit: string
  total_per_unit: string
  estimated_hours: string
}

export function ScopeLibraryClient({ tenantId, initialItems, insurers }: Props) {
  const [items, setItems] = useState<ScopeLibraryItem[]>(initialItems)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState({ trade: '', search: '' })
  const [showImport, setShowImport] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const [newItem, setNewItem] = useState<NewItemForm>({
    trade: '',
    keyword: '',
    item_description: '',
    unit: '',
    labour_per_unit: '',
    materials_per_unit: '',
    total_per_unit: '',
    estimated_hours: '',
  })

  const refresh = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter.trade) params.set('trade', filter.trade)
    if (filter.search) params.set('search', filter.search)
    const res = await fetch(`/api/scope-library?${params.toString()}`)
    if (res.ok) {
      const data = await res.json() as ScopeLibraryItem[]
      setItems(data)
    }
  }, [filter])

  async function handleAddItem() {
    if (!newItem.item_description.trim()) return
    setAddingItem(true)
    try {
      const res = await fetch('/api/scope-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade: newItem.trade || null,
          keyword: newItem.keyword || null,
          item_description: newItem.item_description,
          unit: newItem.unit || null,
          labour_per_unit: newItem.labour_per_unit ? parseFloat(newItem.labour_per_unit) : null,
          materials_per_unit: newItem.materials_per_unit ? parseFloat(newItem.materials_per_unit) : null,
          total_per_unit: newItem.total_per_unit ? parseFloat(newItem.total_per_unit) : null,
          estimated_hours: newItem.estimated_hours ? parseFloat(newItem.estimated_hours) : null,
        }),
      })
      if (res.ok) {
        const created = await res.json() as ScopeLibraryItem
        setItems((prev) => [created, ...prev])
        setShowAddForm(false)
        setNewItem({ trade: '', keyword: '', item_description: '', unit: '', labour_per_unit: '', materials_per_unit: '', total_per_unit: '', estimated_hours: '' })
      }
    } finally {
      setAddingItem(false)
    }
  }

  async function handleDuplicate(item: ScopeLibraryItem) {
    const res = await fetch('/api/scope-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trade: item.trade,
        keyword: item.keyword ? `${item.keyword}-copy` : null,
        item_description: item.item_description ? `${item.item_description} (copy)` : null,
        unit: item.unit,
        labour_per_unit: item.labour_per_unit,
        materials_per_unit: item.materials_per_unit,
        total_per_unit: item.total_per_unit,
        estimated_hours: item.estimated_hours,
        site_notes: item.site_notes,
        pricing_tiers: item.pricing_tiers as PricingTiers | null,
      }),
    })
    if (res.ok) {
      const created = await res.json() as ScopeLibraryItem
      setItems((prev) => [created, ...prev])
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Unique trades from items
  const allTrades = Array.from(new Set(items.map((i) => i.trade ?? ''))).filter(Boolean).sort()

  // Apply client-side filter
  const filteredItems = items.filter((item) => {
    if (filter.trade && item.trade !== filter.trade) return false
    if (filter.search) {
      const q = filter.search.toLowerCase()
      return (
        (item.item_description ?? '').toLowerCase().includes(q) ||
        (item.keyword ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Group by trade, drafts first within each group
  const tradeGroups = new Map<string, ScopeLibraryItem[]>()
  for (const item of filteredItems) {
    const trade = item.trade ?? '(No trade)'
    const group = tradeGroups.get(trade) ?? []
    group.push(item)
    tradeGroups.set(trade, group)
  }
  const sortedTrades = Array.from(tradeGroups.keys()).sort()

  const UNITS = ['m²', 'm³', 'lm', 'ea', 'hr', 'item', 'set'] as const

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filter.trade}
          onChange={(e) => setFilter((f) => ({ ...f, trade: e.target.value }))}
          className="border border-[#e0dbd4] rounded-lg px-3 py-2 text-sm bg-white text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e]"
        >
          <option value="">All trades</option>
          {allTrades.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <input
          type="text"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search items…"
          className="flex-1 min-w-[180px] border border-[#e0dbd4] rounded-lg px-3 py-2 text-sm bg-white text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e]"
        />

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-2 text-sm text-[#3a3530] border border-[#e0dbd4] rounded-lg hover:bg-[#f5f0e8] transition-colors"
          >
            Import CSV
          </button>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="px-3 py-2 text-sm font-medium bg-[#c9a96e] text-white rounded-lg hover:bg-[#b8956a] transition-colors"
          >
            + Add Item
          </button>
        </div>
      </div>

      {/* Add item form */}
      {showAddForm && (
        <div className="border border-[#c9a96e] rounded-xl bg-[#fffdf9] p-4 space-y-3">
          <p className="text-xs font-semibold text-[#3a3530] uppercase tracking-wide">New Item</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Description *</label>
              <input
                type="text"
                value={newItem.item_description}
                onChange={(e) => setNewItem((f) => ({ ...f, item_description: e.target.value }))}
                placeholder="e.g. Remove and replace roof tile"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Trade</label>
              <input
                type="text"
                value={newItem.trade}
                onChange={(e) => setNewItem((f) => ({ ...f, trade: e.target.value }))}
                placeholder="e.g. Roofing"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Keyword</label>
              <input
                type="text"
                value={newItem.keyword}
                onChange={(e) => setNewItem((f) => ({ ...f, keyword: e.target.value }))}
                placeholder="Unique keyword"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Unit</label>
              <select
                value={newItem.unit}
                onChange={(e) => setNewItem((f) => ({ ...f, unit: e.target.value }))}
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#c9a96e]"
              >
                <option value="">—</option>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Labour/unit</label>
              <input
                type="number"
                step="0.01"
                value={newItem.labour_per_unit}
                onChange={(e) => setNewItem((f) => ({ ...f, labour_per_unit: e.target.value }))}
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-[#c9a96e]"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Materials/unit</label>
              <input
                type="number"
                step="0.01"
                value={newItem.materials_per_unit}
                onChange={(e) => setNewItem((f) => ({ ...f, materials_per_unit: e.target.value }))}
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-[#c9a96e]"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Total/unit</label>
              <input
                type="number"
                step="0.01"
                value={newItem.total_per_unit}
                onChange={(e) => setNewItem((f) => ({ ...f, total_per_unit: e.target.value }))}
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-[#c9a96e]"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Est. hours</label>
              <input
                type="number"
                step="0.25"
                value={newItem.estimated_hours}
                onChange={(e) => setNewItem((f) => ({ ...f, estimated_hours: e.target.value }))}
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-[#c9a96e]"
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowAddForm(false); setNewItem({ trade: '', keyword: '', item_description: '', unit: '', labour_per_unit: '', materials_per_unit: '', total_per_unit: '', estimated_hours: '' }) }}
              className="px-3 py-1.5 text-sm text-[#3a3530] hover:text-[#1a1a1a]"
            >
              Cancel
            </button>
            <button
              onClick={handleAddItem}
              disabled={addingItem || !newItem.item_description.trim()}
              className="px-4 py-1.5 text-sm font-medium bg-[#c9a96e] text-white rounded-lg hover:bg-[#b8956a] disabled:opacity-50 transition-colors"
            >
              {addingItem ? 'Adding…' : 'Add Item'}
            </button>
          </div>
        </div>
      )}

      {/* Column header */}
      <div
        className="grid items-center gap-1 px-3 py-1 text-xs font-medium text-[#b0a898] uppercase tracking-wide"
        style={{ gridTemplateColumns: '24px 1fr 52px 68px 68px 68px 52px 56px' }}
      >
        <div />
        <div>Description</div>
        <div className="text-center">Unit</div>
        <div className="text-right">Labour</div>
        <div className="text-right">Materials</div>
        <div className="text-right">Total</div>
        <div className="text-right">Hrs</div>
        <div />
      </div>

      {/* Items grouped by trade */}
      {sortedTrades.length === 0 && (
        <div className="text-sm text-[#b0a898] py-8 text-center">No items found.</div>
      )}

      {sortedTrades.map((trade) => {
        const tradeItems = tradeGroups.get(trade) ?? []
        // Drafts first
        const drafts = tradeItems.filter((i) => i.is_draft)
        const nonDrafts = tradeItems.filter((i) => !i.is_draft)

        return (
          <div key={trade} className="space-y-1">
            <div className="flex items-center gap-2 py-1">
              <span className="text-xs font-semibold text-[#3a3530] uppercase tracking-wide">{trade}</span>
              <span className="text-xs text-[#b0a898]">{tradeItems.length}</span>
              <div className="flex-1 h-px bg-[#e0dbd4]" />
            </div>

            {drafts.map((item) => (
              <ScopeLibraryDraftItem
                key={item.id}
                item={item}
                tenantId={tenantId}
                onApprove={() => {
                  refresh()
                }}
                onDiscard={() => {
                  setItems((prev) => prev.filter((i) => i.id !== item.id))
                }}
              />
            ))}

            {nonDrafts.map((item) => (
              <ScopeLibraryItemRow
                key={item.id}
                item={item}
                tenantId={tenantId}
                insurers={insurers}
                isExpanded={expandedIds.has(item.id)}
                onToggleExpand={() => toggleExpand(item.id)}
                onUpdate={(updated) => {
                  setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                }}
                onDelete={() => {
                  setItems((prev) => prev.filter((i) => i.id !== item.id))
                }}
                onDuplicate={() => handleDuplicate(item)}
              />
            ))}
          </div>
        )
      })}

      <ScopeLibraryImportModal
        isOpen={showImport}
        tenantId={tenantId}
        insurers={insurers}
        onClose={() => setShowImport(false)}
        onImported={refresh}
      />
    </div>
  )
}
