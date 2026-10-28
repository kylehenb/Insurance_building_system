'use client'

import { useRef, useState } from 'react'
import { displayWording } from '@/lib/scope-library/pricing'
import type { ScopeSearchResult } from '@/lib/scope-library/useScopeLibrary'

// One scope item in the field app: a description that searches the scope
// library as you type, and a quantity. Picking a result fills the description
// and jumps to the quantity; Return on the description (a custom item) also
// jumps to the quantity; Return on the quantity starts the next item.

export interface FieldScopeItemState {
  id: string
  text: string
  qty: string
  /** The scope library item picked from the search; cleared by typing over it */
  libraryId: string | null
  /** The picked item's keyword, shown under the (cut-off) description */
  keyword: string | null
  unit: string | null
}

const MAX_RESULTS = 6

export function ScopeItemRow({
  item,
  search,
  onChange,
  onPick,
  onRemove,
  onQtyEnter,
}: {
  item: FieldScopeItemState
  search: (query: string) => ScopeSearchResult[]
  onChange: (changes: Partial<FieldScopeItemState>) => void
  onPick: (result: ScopeSearchResult) => void
  onRemove: () => void
  /** Return on the quantity: on to the next item */
  onQtyEnter: () => void
}) {
  const [results, setResults] = useState<ScopeSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const qtyRef = useRef<HTMLInputElement>(null)

  const focusQty = () => {
    qtyRef.current?.focus()
    // Not every browser lets a number box be selected
    try { qtyRef.current?.select() } catch {}
  }

  const pick = (result: ScopeSearchResult) => {
    setOpen(false)
    setResults([])
    onPick(result)
    // In the same tap, so the phone keeps its keyboard up (number pad on the quantity)
    focusQty()
  }

  return (
    <div className="fa-scope-row">
      <div className="fa-scope-desc">
        <input
          className={`fa-scope-input${item.libraryId ? ' picked' : ''}`}
          type="text"
          placeholder="Scope item — type to search"
          value={item.text}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="next"
          onChange={e => {
            const text = e.target.value
            // Typing over a pick makes it a custom item
            onChange({ text, libraryId: null, keyword: null, unit: null })
            const found = text.trim().length >= 2 ? search(text).slice(0, MAX_RESULTS) : []
            setResults(found)
            setOpen(found.length > 0)
          }}
          onFocus={() => { if (results.length) setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              setOpen(false)
              focusQty()
            }
          }}
        />
        {item.libraryId && <div className="fa-scope-lib-tag">{[item.keyword || 'Library item', item.unit].filter(Boolean).join(' · ')}</div>}
        {open && (
          <div className="fa-scope-results" role="listbox">
            {results.map(r => (
              <button
                key={r.id}
                type="button"
                className="fa-scope-result"
                // Keep focus in the input until the tap lands, so the keyboard stays up
                onPointerDown={e => e.preventDefault()}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(r)}
              >
                <span className="fa-scope-result-desc">{displayWording(r.item_description ?? '')}</span>
                <span className="fa-scope-result-meta">
                  {/* Keyword and rate tell apart items with the same wording (e.g. one-off vs bulk rates) */}
                  {[r.trade, r.keyword, r.rate_total != null ? `$${r.rate_total}${r.unit ? `/${r.unit}` : ''}` : r.unit, r.insurer_specific].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        ref={qtyRef}
        className="fa-scope-qty"
        // type="number" without inputMode: iOS opens the full keyboard on its numbers
        // layer, which has a Return key (inputMode="decimal" gives a pad without one)
        type="number"
        step="any"
        min="0"
        placeholder="Qty"
        value={item.qty}
        enterKeyHint="next"
        onChange={e => onChange({ qty: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onQtyEnter()
          }
        }}
      />
      <button className="fa-scope-del" onClick={onRemove} aria-label="Remove item">×</button>
    </div>
  )
}
