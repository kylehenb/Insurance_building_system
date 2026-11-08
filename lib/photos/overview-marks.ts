// Markup on the roof overview screenshot for the report's first page: pins
// (several per problem letter if needed), area circles, arrows and short text
// labels. Every position is a fraction of the image (0–1 across, 0–1 down) so
// the marks stay in place however big the image is drawn, and none of it ever
// crops the image. A mark with a problem letter takes that problem's colour;
// one without is white. Safe to import in the browser.

import { ISSUE_LETTERS, issueColour } from './roof-tags'

interface Base { id: string; letter: string | null }
export type OverviewMark =
  | (Base & { kind: 'pin'; x: number; y: number })
  | (Base & { kind: 'area'; x: number; y: number; rx: number; ry: number })
  | (Base & { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number })
  | (Base & { kind: 'text'; x: number; y: number; text: string })

export type MarkKind = OverviewMark['kind']

export const markColour = (letter: string | null): string => (letter ? issueColour(letter) : '#ffffff')

export const newMarkId = (): string => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const unit = (n: unknown): number | null => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null
}
const letterOf = (v: unknown): string | null => (typeof v === 'string' && (ISSUE_LETTERS as readonly string[]).includes(v) ? v : null)

/**
 * Marks from a saved draft: well-formed ones only, positions kept inside the image.
 * Also takes the first version's pins (`{ letter, x, y }`, from `overviewPins`).
 */
export function cleanMarks(value: unknown): OverviewMark[] {
  if (!Array.isArray(value)) return []
  const out: OverviewMark[] = []
  const ids = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    let id = typeof m.id === 'string' && m.id ? m.id : newMarkId()
    while (ids.has(id)) id = newMarkId()
    const letter = letterOf(m.letter)
    const kind = m.kind ?? 'pin'
    if (kind === 'pin') {
      const x = unit(m.x), y = unit(m.y)
      if (x === null || y === null || !letter) continue
      out.push({ id, kind, letter, x, y })
    } else if (kind === 'area') {
      const x = unit(m.x), y = unit(m.y), rx = unit(m.rx), ry = unit(m.ry)
      if (x === null || y === null || !rx || !ry) continue
      out.push({ id, kind, letter, x, y, rx, ry })
    } else if (kind === 'arrow') {
      const x1 = unit(m.x1), y1 = unit(m.y1), x2 = unit(m.x2), y2 = unit(m.y2)
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue
      out.push({ id, kind, letter, x1, y1, x2, y2 })
    } else if (kind === 'text') {
      const x = unit(m.x), y = unit(m.y)
      const text = typeof m.text === 'string' ? m.text.trim().slice(0, 40) : ''
      if (x === null || y === null || !text) continue
      out.push({ id, kind, letter, x, y, text })
    } else continue
    ids.add(id)
  }
  return out
}

/** A mark moved by (dx, dy), kept inside the image. */
export function moveMark(m: OverviewMark, dx: number, dy: number): OverviewMark {
  const c = (n: number) => Math.min(1, Math.max(0, n))
  if (m.kind === 'arrow') return { ...m, x1: c(m.x1 + dx), y1: c(m.y1 + dy), x2: c(m.x2 + dx), y2: c(m.y2 + dy) }
  return { ...m, x: c(m.x + dx), y: c(m.y + dy) }
}

/** Where a mark is grabbed to move it. */
export function markAnchor(m: OverviewMark): { x: number; y: number } {
  return m.kind === 'arrow' ? { x: m.x1, y: m.y1 } : { x: m.x, y: m.y }
}
