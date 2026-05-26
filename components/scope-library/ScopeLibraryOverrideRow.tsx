'use client'

import { useState, useRef } from 'react'
import type { ScopeLibraryOverride, ScopeLibraryItem } from '@/lib/types/scope-library'

interface Props {
  override: ScopeLibraryOverride
  baseItem: ScopeLibraryItem
  tenantId: string
  onUpdate: (updated: ScopeLibraryOverride) => void
  onDelete: () => void
}

async function patchOverride(
  itemId: string,
  overrideId: string,
  payload: Partial<ScopeLibraryOverride>
): Promise<ScopeLibraryOverride | null> {
  const res = await fetch(`/api/scope-library/${itemId}/overrides/${overrideId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  return res.json() as Promise<ScopeLibraryOverride>
}

export function ScopeLibraryOverrideRow({ override, baseItem, onUpdate, onDelete }: Props) {
  const [labour, setLabour] = useState(
    override.labour_per_unit !== null ? String(override.labour_per_unit) : ''
  )
  const [materials, setMaterials] = useState(
    override.materials_per_unit !== null ? String(override.materials_per_unit) : ''
  )
  const [total, setTotal] = useState(
    override.total_per_unit !== null ? String(override.total_per_unit) : ''
  )
  const [wordingSingle, setWordingSingle] = useState(override.wording_single ?? '')
  const [wordingLabour, setWordingLabour] = useState(override.wording_labour ?? '')
  const [wordingMaterials, setWordingMaterials] = useState(override.wording_materials ?? '')
  const [split, setSplit] = useState(override.split_format)
  const [saving, setSaving] = useState(false)
  const descRef = useRef<HTMLTextAreaElement>(null)

  const insurerName = override.insurer?.trading_name ?? override.insurer?.name ?? override.insurer_id

  async function handleBlur(field: string, value: string | boolean | null) {
    if (saving) return
    setSaving(true)
    const payload: Partial<ScopeLibraryOverride> = {}

    if (field === 'labour') payload.labour_per_unit = value === '' ? null : parseFloat(value as string) || null
    else if (field === 'materials') payload.materials_per_unit = value === '' ? null : parseFloat(value as string) || null
    else if (field === 'total') payload.total_per_unit = value === '' ? null : parseFloat(value as string) || null
    else if (field === 'wording_single') payload.wording_single = (value as string) || null
    else if (field === 'wording_labour') payload.wording_labour = (value as string) || null
    else if (field === 'wording_materials') payload.wording_materials = (value as string) || null

    const updated = await patchOverride(override.scope_library_id, override.id, payload)
    if (updated) onUpdate(updated)
    setSaving(false)
  }

  async function toggleSplit() {
    const newSplit = !split
    setSplit(newSplit)
    const updated = await patchOverride(override.scope_library_id, override.id, { split_format: newSplit })
    if (updated) onUpdate(updated)
  }

  async function handleDelete() {
    const res = await fetch(`/api/scope-library/${override.scope_library_id}/overrides/${override.id}`, {
      method: 'DELETE',
    })
    if (res.ok) onDelete()
  }

  const inputClass =
    'w-full bg-transparent text-right font-mono text-sm focus:outline-none focus:bg-white focus:border-[#c9a96e] border border-transparent hover:border-[#e0dbd4] rounded px-1 py-0.5 transition-colors'

  const mainRow = (
    <div
      className="group grid items-center gap-1 px-3 py-2 hover:bg-[#f5f0e8] transition-colors"
      style={{ gridTemplateColumns: '120px 1fr 52px 68px 68px 68px 52px 56px' }}
    >
      {/* Name */}
      <div className="min-w-0">
        <div className="font-semibold text-sm text-[#1a1a1a] truncate">{insurerName}</div>
        {split && <div className="text-xs text-[#b0a898]">Labour</div>}
      </div>

      {/* Description wording */}
      <div className="min-w-0">
        <textarea
          ref={descRef}
          value={split ? wordingLabour : wordingSingle}
          placeholder={split ? 'Labour wording…' : 'Override wording…'}
          className="w-full bg-transparent text-sm text-[#1a1a1a] resize-none focus:outline-none focus:bg-white border border-transparent hover:border-[#e0dbd4] rounded px-1 py-0.5 transition-colors"
          rows={1}
          onChange={(e) => {
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
            if (split) setWordingLabour(e.target.value)
            else setWordingSingle(e.target.value)
          }}
          onBlur={() => {
            if (split) handleBlur('wording_labour', wordingLabour)
            else handleBlur('wording_single', wordingSingle)
          }}
        />
      </div>

      {/* Unit (inherit from base) */}
      <div className="text-xs text-[#b0a898] text-center">{baseItem.unit ?? '—'}</div>

      {/* Labour */}
      <input
        type="number"
        step="0.01"
        value={labour}
        onChange={(e) => setLabour(e.target.value)}
        onBlur={() => handleBlur('labour', labour)}
        className={inputClass}
        placeholder="—"
      />

      {/* Materials */}
      <input
        type="number"
        step="0.01"
        value={materials}
        onChange={(e) => setMaterials(e.target.value)}
        onBlur={() => handleBlur('materials', materials)}
        disabled={split}
        className={`${inputClass} ${split ? 'opacity-30 cursor-not-allowed' : ''}`}
        placeholder="—"
      />

      {/* Total */}
      <input
        type="number"
        step="0.01"
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        onBlur={() => handleBlur('total', total)}
        className={`${inputClass} font-semibold`}
        placeholder="—"
      />

      {/* Split toggle */}
      <div className="flex justify-center">
        <button
          onClick={toggleSplit}
          title={split ? 'Remove split' : 'Split labour / materials'}
          className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${split ? 'text-[#7c3aed]' : 'text-[#b0a898] hover:text-[#7c3aed]'}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 5h12M2 11h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={split ? '' : '3 2'}
            />
          </svg>
        </button>
      </div>

      {/* Delete */}
      <div className="flex justify-center">
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 p-1 text-[#b0a898] hover:text-red-500 rounded transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M2 3.5h10M5.5 3.5V2.5h3v1M3.5 3.5l.5 8h6l.5-8"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )

  const materialsSubRow = split ? (
    <div
      className="group grid items-center gap-1 px-3 py-1.5 border-t border-dashed border-[#e0dbd4] hover:bg-[#f5f0e8] transition-colors"
      style={{ gridTemplateColumns: '120px 1fr 52px 68px 68px 68px 52px 56px' }}
    >
      {/* Name dimmed */}
      <div className="min-w-0 opacity-35">
        <div className="font-semibold text-sm text-[#1a1a1a] truncate">{insurerName}</div>
        <div className="text-xs text-[#b0a898]">Materials</div>
      </div>

      {/* Description */}
      <div className="min-w-0">
        <textarea
          value={wordingMaterials}
          placeholder="Materials wording…"
          className="w-full bg-transparent text-sm text-[#1a1a1a] resize-none focus:outline-none focus:bg-white border border-transparent hover:border-[#e0dbd4] rounded px-1 py-0.5 transition-colors"
          rows={1}
          onChange={(e) => {
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
            setWordingMaterials(e.target.value)
          }}
          onBlur={() => handleBlur('wording_materials', wordingMaterials)}
        />
      </div>

      {/* Unit */}
      <div className="text-xs text-[#b0a898] text-center">{baseItem.unit ?? '—'}</div>

      {/* Labour disabled */}
      <div />

      {/* Materials active */}
      <input
        type="number"
        step="0.01"
        value={materials}
        onChange={(e) => setMaterials(e.target.value)}
        onBlur={() => handleBlur('materials', materials)}
        className={inputClass}
        placeholder="—"
      />

      {/* Total */}
      <input
        type="number"
        step="0.01"
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        onBlur={() => handleBlur('total', total)}
        className={`${inputClass} font-semibold`}
        placeholder="—"
      />

      <div />
      <div />
    </div>
  ) : null

  return (
    <div className="border-t border-[#e0dbd4]">
      {mainRow}
      {materialsSubRow}
    </div>
  )
}
