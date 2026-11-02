'use client'

import { useEffect, useRef, useState } from 'react'
import { AUTO_PILE, CATEGORIES, pileOf, type CardCategory } from '@/lib/actions/cards'

// An email's place on the list (tech spec §23.11): off the list it's a hollow
// star; on it, a small tag for its pile (New work, Insurer & client, Trades,
// Reports & quotes, Money). A click opens a menu to put it on the list
// (the AI picks the pile, or pick one), move it, or take it off.

export type PilePick = CardCategory | typeof AUTO_PILE | null

export const categoryLabel = (c: CardCategory) => pileOf(c)?.label ?? c

/** The pile's colour dot (or a hollow star when off the list) */
export function StarIcon({ category, size = 18 }: { category: CardCategory | null; size?: number }) {
  if (category) {
    return <span aria-hidden style={{ display: 'inline-block', width: size * 0.6, height: size * 0.6, borderRadius: '50%', background: pileOf(category)?.colour, verticalAlign: 'middle' }} />
  }
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      <path
        d="M10 2.2l2.35 4.9 5.35.72-3.9 3.73.97 5.33L10 14.3l-4.77 2.58.97-5.33L2.3 7.82l5.35-.72z"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The pile tag on its own (no menu) */
export function PileTag({ category }: { category: CardCategory }) {
  const pile = pileOf(category)
  if (!pile) return null
  return (
    <span className="pile-tag" style={{ color: pile.colour, borderColor: pile.colour }} title={pile.label}>
      {pile.short}
      <style>{`.pile-tag { display: inline-flex; align-items: center; font-size: 10.5px; font-weight: 600; line-height: 1; padding: 3px 6px; border: 1px solid; border-radius: 9px; white-space: nowrap; background: var(--surface, #fff); }`}</style>
    </span>
  )
}

/** On a row or a card: the star or pile tag, opening a menu. onCycle gets the choice (null = off the list) */
export function StarButton({ category, onCycle, disabled, cycleOff = true, size = 18 }: {
  category: CardCategory | null
  onCycle(next: PilePick): void
  disabled?: boolean
  /** false on a card: only moves it between piles */
  cycleOff?: boolean
  size?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const pick = (next: PilePick) => { setOpen(false); onCycle(next) }
  const title = category ? `${categoryLabel(category)} — click to move or take off the list (s)` : 'Not on the list — click to add (s)'

  return (
    <span className="pile-btn-wrap" ref={ref} onClick={e => e.stopPropagation()}>
      <button type="button" className={`pile-btn${category ? ' on' : ''}`} title={title} aria-label={title} aria-haspopup="menu" disabled={disabled} onClick={() => setOpen(o => !o)}>
        {category ? <PileTag category={category} /> : <StarIcon category={null} size={size} />}
      </button>
      {open && (
        <span className="pile-menu" role="menu">
          {!category && <button type="button" role="menuitem" onClick={() => pick(AUTO_PILE)}>Add to the list <em>(AI picks the pile)</em></button>}
          {CATEGORIES.map(c => (
            <button type="button" role="menuitem" key={c.key} className={c.key === category ? 'current' : ''} onClick={() => pick(c.key)}>
              <StarIcon category={c.key} size={14} /> {c.label}
            </button>
          ))}
          {category && cycleOff && <button type="button" role="menuitem" className="off" onClick={() => pick(null)}>Take off the list (done)</button>}
        </span>
      )}
      <style>{`
        .pile-btn-wrap { position: relative; display: inline-flex; }
        .pile-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: none; padding: 3px; margin: 0; cursor: pointer; color: var(--faint); border-radius: 10px; line-height: 0; }
        .pile-btn:hover { background: var(--surface-2); color: var(--grey-600); }
        .pile-btn:disabled { cursor: default; opacity: .6; }
        .pile-menu { position: absolute; top: 100%; left: 0; z-index: 30; min-width: 190px; display: flex; flex-direction: column; background: var(--surface, #fff); border: 1px solid var(--line, #ddd); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.12); padding: 4px; }
        .pile-menu button { display: flex; align-items: center; gap: 8px; text-align: left; background: none; border: none; padding: 7px 9px; font-size: 13px; color: var(--ink, #222); border-radius: 6px; cursor: pointer; white-space: nowrap; }
        .pile-menu button:hover { background: var(--surface-2, #f3f3f3); }
        .pile-menu button.current { font-weight: 600; }
        .pile-menu button.off { color: var(--grey-600, #666); border-top: 1px solid var(--line, #eee); margin-top: 2px; }
        .pile-menu em { color: var(--faint, #999); font-style: normal; font-size: 12px; }
      `}</style>
    </span>
  )
}
