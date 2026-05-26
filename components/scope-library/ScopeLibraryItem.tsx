'use client'

import { useState, useRef } from 'react'
import type { ScopeLibraryItem, ScopeLibraryOverride, InsurersOption, PricingTiers, PricingTier } from '@/lib/types/scope-library'
import { ScopeLibraryOverrideRow } from './ScopeLibraryOverrideRow'

interface Props {
  item: ScopeLibraryItem
  tenantId: string
  insurers: InsurersOption[]
  isExpanded: boolean
  onToggleExpand: () => void
  onUpdate: (updated: ScopeLibraryItem) => void
  onDelete: () => void
  onDuplicate: () => void
}

const UNITS = ['m²', 'm³', 'lm', 'ea', 'hr', 'item', 'set'] as const

function isoToDisplay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

function displayToIso(display: string): string | null {
  const parts = display.split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yy] = parts
  const year = parseInt(yy ?? '') < 50 ? 2000 + parseInt(yy ?? '') : 1900 + parseInt(yy ?? '')
  if (isNaN(year) || isNaN(parseInt(dd ?? '')) || isNaN(parseInt(mm ?? ''))) return null
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function ageLabel(iso: string | null): string {
  if (!iso) return ''
  const now = new Date()
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 30) return `${diffDays} days ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths === 1) return '1 month ago'
  if (diffMonths < 12) return `${diffMonths} months ago`
  const diffYears = Math.floor(diffDays / 365)
  return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`
}

export function ScopeLibraryItemRow({
  item,
  tenantId,
  insurers,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onDelete,
  onDuplicate,
}: Props) {
  const [description, setDescription] = useState(item.item_description ?? '')
  const [unit, setUnit] = useState(item.unit ?? '')
  const [labour, setLabour] = useState(item.labour_per_unit !== null ? String(item.labour_per_unit) : '')
  const [materials, setMaterials] = useState(item.materials_per_unit !== null ? String(item.materials_per_unit) : '')
  const [total, setTotal] = useState(item.total_per_unit !== null ? String(item.total_per_unit) : '')
  const [estHrs, setEstHrs] = useState(item.estimated_hours !== null ? String(item.estimated_hours) : '')
  const [keyword, setKeyword] = useState(item.keyword ?? '')
  const [siteNotes, setSiteNotes] = useState(item.site_notes ?? '')
  const [priceDisplay, setPriceDisplay] = useState(isoToDisplay(item.price_updated_at))
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false)
  const [tiersExpanded, setTiersExpanded] = useState(false)
  const [pricingTiers, setPricingTiers] = useState<PricingTiers | null>(item.pricing_tiers)
  const [overrides, setOverrides] = useState<ScopeLibraryOverride[]>(item.overrides)
  const [showAddInsurer, setShowAddInsurer] = useState(false)
  const [addingInsurerId, setAddingInsurerId] = useState('')
  const descRef = useRef<HTMLTextAreaElement>(null)

  const today = new Date().toISOString().slice(0, 10)

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch(`/api/scope-library/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const updated = await res.json() as ScopeLibraryItem
      onUpdate({ ...updated, overrides })
    }
  }

  function handlePriceBlur(field: 'labour' | 'materials' | 'total', value: string) {
    const numVal = value === '' ? null : parseFloat(value) || null
    const payload: Record<string, unknown> = {}
    if (field === 'labour') payload.labour_per_unit = numVal
    else if (field === 'materials') payload.materials_per_unit = numVal
    else if (field === 'total') payload.total_per_unit = numVal

    if (!priceManuallyEdited) {
      payload.price_updated_at = today
      setPriceDisplay(isoToDisplay(today))
    }
    patch(payload)
  }

  function handleDescBlur() {
    patch({ item_description: description || null })
  }

  function handleUnitChange(val: string) {
    setUnit(val)
    patch({ unit: val || null })
  }

  function handleMetaBlur(field: 'keyword' | 'site_notes') {
    if (field === 'keyword') patch({ keyword: keyword || null })
    else if (field === 'site_notes') patch({ site_notes: siteNotes || null })
  }

  function handlePriceDateBlur() {
    const iso = displayToIso(priceDisplay)
    if (iso) {
      setPriceManuallyEdited(true)
      patch({ price_updated_at: iso })
    }
  }

  function handleEstHrsBlur() {
    patch({ estimated_hours: estHrs === '' ? null : parseFloat(estHrs) || null })
  }

  async function handleAddTier() {
    const currentTiers = pricingTiers?.tiers ?? []
    // Insert before the last open-ended tier, or just append
    const lastIdx = currentTiers.findLastIndex ? currentTiers.findLastIndex((t) => t.up_to_qty === null) : -1
    const insertAt = lastIdx >= 0 ? lastIdx : currentTiers.length
    const newTier: PricingTier = { up_to_qty: 10, rate_per_unit: 0, min_charge: null }
    const newTiers = [...currentTiers.slice(0, insertAt), newTier, ...currentTiers.slice(insertAt)]
    const newPricingTiers: PricingTiers = { tiers: newTiers }
    setPricingTiers(newPricingTiers)
    await patch({ pricing_tiers: newPricingTiers })
  }

  async function handleTierChange(idx: number, field: keyof PricingTier, value: string) {
    const currentTiers = [...(pricingTiers?.tiers ?? [])]
    const tier = { ...currentTiers[idx] } as PricingTier
    if (field === 'up_to_qty') {
      tier.up_to_qty = value === '' || value === '∞' ? null : parseFloat(value) || null
    } else if (field === 'rate_per_unit') {
      tier.rate_per_unit = parseFloat(value) || 0
    } else if (field === 'min_charge') {
      tier.min_charge = value === '' ? null : parseFloat(value) || null
    }
    currentTiers[idx] = tier
    const newPricingTiers: PricingTiers = { tiers: currentTiers }
    setPricingTiers(newPricingTiers)
    await patch({ pricing_tiers: newPricingTiers })
  }

  async function handleRemoveTier(idx: number) {
    const newTiers = (pricingTiers?.tiers ?? []).filter((_, i) => i !== idx)
    const newPricingTiers: PricingTiers = { tiers: newTiers }
    setPricingTiers(newPricingTiers)
    await patch({ pricing_tiers: newPricingTiers.tiers.length > 0 ? newPricingTiers : null })
  }

  async function handleAddInsurer() {
    if (!addingInsurerId) return
    const res = await fetch(`/api/scope-library/${item.id}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insurer_id: addingInsurerId }),
    })
    if (res.ok) {
      const newOverride = await res.json() as ScopeLibraryOverride
      setOverrides((prev) => [...prev, newOverride])
      setShowAddInsurer(false)
      setAddingInsurerId('')
    }
  }

  async function handleDeleteItem() {
    const res = await fetch(`/api/scope-library/${item.id}`, { method: 'DELETE' })
    if (res.ok) onDelete()
  }

  async function handleDuplicate() {
    onDuplicate()
  }

  const presentInsurerIds = new Set(overrides.map((o) => o.insurer_id))
  const availableInsurers = insurers.filter((ins) => !presentInsurerIds.has(ins.id))

  const inputClass =
    'w-full bg-transparent text-right font-mono text-sm focus:outline-none focus:bg-white focus:border-[#c9a96e] border border-transparent hover:border-[#e0dbd4] rounded px-1 py-0.5 transition-colors'

  const tiers = pricingTiers?.tiers ?? []

  return (
    <div className="group border border-[#e0dbd4] rounded-lg bg-white hover:shadow-sm transition-shadow mb-1">
      {/* Header row */}
      <div
        className="grid items-center gap-1 px-3 py-2 cursor-pointer"
        style={{ gridTemplateColumns: '24px 1fr 52px 68px 68px 68px 52px 56px' }}
        onClick={onToggleExpand}
      >
        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`text-[#b0a898] transition-transform duration-150 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        >
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Description */}
        <div onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={descRef}
            value={description}
            rows={1}
            className="w-full bg-transparent text-sm text-[#1a1a1a] resize-none focus:outline-none focus:bg-white border border-transparent hover:border-[#e0dbd4] rounded px-1 py-0.5 transition-colors"
            onChange={(e) => {
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
              setDescription(e.target.value)
            }}
            onBlur={handleDescBlur}
          />
        </div>

        {/* Unit */}
        <div onClick={(e) => e.stopPropagation()}>
          <select
            value={unit}
            onChange={(e) => handleUnitChange(e.target.value)}
            className="w-full text-xs bg-transparent border border-transparent hover:border-[#e0dbd4] focus:border-[#c9a96e] rounded px-1 py-0.5 focus:outline-none focus:bg-white transition-colors text-center"
          >
            <option value="">—</option>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Labour */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            step="0.01"
            value={labour}
            onChange={(e) => setLabour(e.target.value)}
            onBlur={() => handlePriceBlur('labour', labour)}
            className={inputClass}
            placeholder="—"
          />
        </div>

        {/* Materials */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            step="0.01"
            value={materials}
            onChange={(e) => setMaterials(e.target.value)}
            onBlur={() => handlePriceBlur('materials', materials)}
            className={inputClass}
            placeholder="—"
          />
        </div>

        {/* Total */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            onBlur={() => handlePriceBlur('total', total)}
            className={`${inputClass} font-semibold`}
            placeholder="—"
          />
        </div>

        {/* Est hrs */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            step="0.25"
            value={estHrs}
            onChange={(e) => setEstHrs(e.target.value)}
            onBlur={handleEstHrsBlur}
            className={`${inputClass} text-[#b0a898]`}
            placeholder="—"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleDuplicate}
            className="opacity-0 group-hover:opacity-100 p-1 text-[#b0a898] hover:text-[#3a3530] rounded transition-all"
            title="Duplicate"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 9V2h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={handleDeleteItem}
            className="opacity-0 group-hover:opacity-100 p-1 text-[#b0a898] hover:text-red-500 rounded transition-all"
            title="Archive"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2 3h9M5 3V2h3v1M3 3l.5 8h6L10 3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-[#e0dbd4] px-4 pb-4 space-y-4 pt-3">
          {/* Section 1: Meta row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Price updated</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={priceDisplay}
                  onChange={(e) => setPriceDisplay(e.target.value)}
                  onBlur={handlePriceDateBlur}
                  placeholder="dd/mm/yy"
                  className="w-24 border border-[#e0dbd4] rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-[#c9a96e]"
                />
                {item.price_updated_at && (
                  <span className="text-xs text-[#b0a898]">{ageLabel(item.price_updated_at)}</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Keyword</label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onBlur={() => handleMetaBlur('keyword')}
                placeholder="Unique keyword"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Site notes</label>
              <input
                type="text"
                value={siteNotes}
                onChange={(e) => setSiteNotes(e.target.value)}
                onBlur={() => handleMetaBlur('site_notes')}
                placeholder="Comma-separated note variants for AI matching"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
          </div>

          {/* Section 2: Tiered pricing */}
          <div className="border border-[#e0dbd4] rounded-lg overflow-hidden">
            <button
              onClick={() => setTiersExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[#faf9f7] hover:bg-[#f5f0e8] text-left transition-colors"
            >
              <span className="text-xs font-medium text-[#3a3530]">
                {tiers.length === 0 ? 'No tiers — flat rate applies' : `${tiers.length} pricing tier${tiers.length !== 1 ? 's' : ''}`}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className={`text-[#b0a898] transition-transform ${tiersExpanded ? 'rotate-180' : ''}`}
              >
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {tiersExpanded && (
              <div className="px-3 py-2 space-y-1.5">
                {tiers.length > 0 && (
                  <div className="grid gap-1 text-xs text-[#b0a898] font-medium mb-1" style={{ gridTemplateColumns: '28px 80px 80px 80px 28px' }}>
                    <div />
                    <div>Up to qty</div>
                    <div>Rate/unit</div>
                    <div>Min charge</div>
                    <div />
                  </div>
                )}
                {tiers.map((tier, idx) => (
                  <div key={idx} className="grid items-center gap-1" style={{ gridTemplateColumns: '28px 80px 80px 80px 28px' }}>
                    <div className="text-[#b0a898] cursor-grab text-center text-xs">⠿</div>
                    <input
                      type={tier.up_to_qty === null ? 'text' : 'number'}
                      value={tier.up_to_qty === null ? '∞' : String(tier.up_to_qty)}
                      readOnly={tier.up_to_qty === null}
                      onChange={(e) => handleTierChange(idx, 'up_to_qty', e.target.value)}
                      className="border border-[#e0dbd4] rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-[#c9a96e] font-mono"
                      placeholder="qty"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={String(tier.rate_per_unit)}
                      onChange={(e) => handleTierChange(idx, 'rate_per_unit', e.target.value)}
                      className="border border-[#e0dbd4] rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-[#c9a96e] font-mono"
                      placeholder="0.00"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={tier.min_charge !== null && tier.min_charge !== undefined ? String(tier.min_charge) : ''}
                      onChange={(e) => handleTierChange(idx, 'min_charge', e.target.value)}
                      className="border border-[#e0dbd4] rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-[#c9a96e] font-mono"
                      placeholder="—"
                    />
                    {tier.up_to_qty !== null && (
                      <button
                        onClick={() => handleRemoveTier(idx)}
                        className="text-[#b0a898] hover:text-red-500 transition-colors text-center"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                    {tier.up_to_qty === null && <div />}
                  </div>
                ))}
                <button
                  onClick={handleAddTier}
                  className="text-xs text-[#c9a96e] hover:text-[#b8956a] font-medium mt-1"
                >
                  + Add tier
                </button>
              </div>
            )}
          </div>

          {/* Section 3: Insurer Pricing */}
          <div className="border border-[#e0dbd4] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-[#faf9f7] border-b border-[#e0dbd4]">
              <span className="text-xs font-medium text-[#3a3530]">Insurer Pricing</span>
              {availableInsurers.length > 0 && (
                <button
                  onClick={() => setShowAddInsurer((v) => !v)}
                  className="text-xs text-[#c9a96e] hover:text-[#b8956a] font-medium"
                >
                  + Add insurer
                </button>
              )}
            </div>

            {showAddInsurer && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0dbd4] bg-[#fffdf9]">
                <select
                  value={addingInsurerId}
                  onChange={(e) => setAddingInsurerId(e.target.value)}
                  className="flex-1 border border-[#e0dbd4] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#c9a96e]"
                >
                  <option value="">Select insurer…</option>
                  {availableInsurers.map((ins) => (
                    <option key={ins.id} value={ins.id}>
                      {ins.trading_name ?? ins.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddInsurer}
                  disabled={!addingInsurerId}
                  className="px-3 py-1 text-xs font-medium bg-[#c9a96e] text-white rounded disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddInsurer(false); setAddingInsurerId('') }}
                  className="text-xs text-[#b0a898] hover:text-[#3a3530]"
                >
                  Cancel
                </button>
              </div>
            )}

            {overrides.length === 0 && !showAddInsurer && (
              <div className="px-3 py-3 text-xs text-[#b0a898]">No insurer overrides — base pricing applies.</div>
            )}

            {overrides.map((ov) => (
              <ScopeLibraryOverrideRow
                key={ov.id}
                override={ov}
                baseItem={item}
                tenantId={tenantId}
                onUpdate={(updated) => {
                  setOverrides((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
                }}
                onDelete={() => {
                  setOverrides((prev) => prev.filter((o) => o.id !== ov.id))
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
