'use client'

import { useState } from 'react'
import type { ScopeLibraryItem } from '@/lib/types/scope-library'

interface Props {
  item: ScopeLibraryItem
  tenantId: string
  onApprove: () => void
  onDiscard: () => void
}

export function ScopeLibraryDraftItem({ item, tenantId, onApprove, onDiscard }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [approving, setApproving] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  // Editable meta fields
  const [keyword, setKeyword] = useState(item.keyword ?? '')
  const [trade, setTrade] = useState(item.trade ?? '')

  async function handleApprove() {
    setApproving(true)
    try {
      // Save any meta edits first
      await fetch(`/api/scope-library/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword || null, trade: trade || null }),
      })
      // Then approve
      const res = await fetch(`/api/scope-library/${item.id}/approve`, { method: 'POST' })
      if (res.ok) onApprove()
    } finally {
      setApproving(false)
    }
  }

  async function handleDiscard() {
    setDiscarding(true)
    try {
      const res = await fetch(`/api/scope-library/${item.id}`, { method: 'DELETE' })
      if (res.ok) onDiscard()
    } finally {
      setDiscarding(false)
    }
  }

  return (
    <div className="border-l-4 border-[#e8c84a] bg-[#fffbf0] rounded-r-lg border border-[#e0dbd4] mb-1">
      {/* Collapsed header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`flex-shrink-0 text-[#b0a898] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-[#e8c84a] text-[#7a5c00]">
          Draft
        </span>

        {item.draft_source_job_ref && (
          <span className="text-xs text-[#b0a898]">from job {item.draft_source_job_ref}</span>
        )}

        <span className="flex-1 min-w-0 text-sm text-[#1a1a1a] truncate">{item.item_description ?? '(no description)'}</span>

        <span className="text-xs text-[#b0a898]">{item.trade ?? ''}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#f0e8c0]">
          <div className="grid grid-cols-2 gap-3 pt-3">
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Keyword</label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Unique keyword for AI matching"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm bg-white text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Trade</label>
              <input
                type="text"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                placeholder="e.g. Roofing"
                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-sm bg-white text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[#b0a898] mb-1">Labour/unit</label>
              <div className="text-sm font-mono text-[#1a1a1a]">
                {item.labour_per_unit !== null ? `$${item.labour_per_unit.toFixed(2)}` : '—'}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#b0a898] mb-1">Materials/unit</label>
              <div className="text-sm font-mono text-[#1a1a1a]">
                {item.materials_per_unit !== null ? `$${item.materials_per_unit.toFixed(2)}` : '—'}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#b0a898] mb-1">Total/unit</label>
              <div className="text-sm font-mono font-semibold text-[#1a1a1a]">
                {item.total_per_unit !== null ? `$${item.total_per_unit.toFixed(2)}` : '—'}
              </div>
            </div>
          </div>

          {/* Approve bar */}
          <div className="flex items-center justify-between bg-white border border-[#e0dbd4] rounded-lg px-4 py-3 mt-2">
            <p className="text-xs text-[#3a3530]">
              Review pricing and keyword, then approve to add to the library.
            </p>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              <button
                onClick={handleDiscard}
                disabled={discarding}
                className="px-3 py-1.5 text-xs text-[#b0a898] hover:text-red-500 disabled:opacity-50 transition-colors"
              >
                {discarding ? 'Discarding…' : 'Discard'}
              </button>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="px-3 py-1.5 text-xs font-medium bg-[#c9a96e] text-white rounded-lg hover:bg-[#b8956a] disabled:opacity-50 transition-colors"
              >
                {approving ? 'Approving…' : 'Approve item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
