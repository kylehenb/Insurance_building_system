'use client'

import { CATEGORIES, nextCategory, type CardCategory } from '@/lib/actions/cards'

// The star: an email's action card shown the way Gmail shows stars. A
// coloured star per category (Invoices to pay, Attend and Submit,
// Everything else); clicking cycles through them, then takes it off.

const COLOUR: Record<CardCategory, string> = {
  invoice: '#2f9e5b',
  attend_submit: '#2f6fd6',
  other: '#f2b600',
}

export const categoryLabel = (c: CardCategory) => CATEGORIES.find(x => x.key === c)!.label

export function StarIcon({ category, size = 18 }: { category: CardCategory | null; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      <path
        d="M10 2.2l2.35 4.9 5.35.72-3.9 3.73.97 5.33L10 14.3l-4.77 2.58.97-5.33L2.3 7.82l5.35-.72z"
        fill={category ? COLOUR[category] : 'none'}
        stroke={category ? COLOUR[category] : 'currentColor'}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The star button: shows the current symbol; a click asks for the next one (null = off) */
export function StarButton({ category, onCycle, disabled, cycleOff = true, size }: {
  category: CardCategory | null
  onCycle(next: CardCategory | null): void
  disabled?: boolean
  /** false on a card: cycles the three symbols without taking the star off */
  cycleOff?: boolean
  size?: number
}) {
  const next = category && !cycleOff ? (nextCategory(category) ?? CATEGORIES[0].key) : nextCategory(category)
  const title = `${category ? categoryLabel(category) : 'Not starred'} — click for ${next ? categoryLabel(next) : 'no star'} (s)`
  return (
    <button
      type="button"
      className={`star-btn${category ? ' on' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onCycle(next) }}
    >
      <StarIcon category={category} size={size} />
      <style>{`
        .star-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: none; padding: 3px; margin: 0; cursor: pointer; color: var(--faint); border-radius: 50%; line-height: 0; }
        .star-btn:hover { background: var(--surface-2); color: var(--grey-600); }
        .star-btn:disabled { cursor: default; opacity: .6; }
      `}</style>
    </button>
  )
}
