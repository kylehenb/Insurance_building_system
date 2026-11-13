// Markup drawn on a photo: the roof overview screenshot for the report's first
// page, and any other report photo (`photoMarks`, by photo). Pins (several per
// problem letter if needed), area circles, outlines (a shape tapped corner by
// corner, e.g. round a building), arrows and short text labels. Every position is a fraction of the image (0–1 across, 0–1 down) so
// the marks stay in place however big the image is drawn, and none of it ever
// crops the image. A mark with a problem letter takes that problem's colour;
// one without is white. Safe to import in the browser.

import { ISSUE_LETTERS, issueColour } from './roof-tags'

export interface Point { x: number; y: number }
interface Base { id: string; letter: string | null }
export type OverviewMark =
  | (Base & { kind: 'pin'; x: number; y: number })
  | (Base & { kind: 'area'; x: number; y: number; rx: number; ry: number })
  | (Base & { kind: 'shape'; points: Point[] })
  | (Base & { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number })
  | (Base & { kind: 'text'; x: number; y: number; text: string })

export type MarkKind = OverviewMark['kind']

/** Most corners an outline keeps */
export const MAX_SHAPE_POINTS = 40

export const markColour = (letter: string | null): string => (letter ? issueColour(letter) : '#ffffff')

export const newMarkId = (): string => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const unit = (n: unknown): number | null => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null
}
const letterOf = (v: unknown): string | null => (typeof v === 'string' && ISSUE_LETTERS.includes(v) ? v : null)

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
    } else if (kind === 'shape') {
      const points = (Array.isArray(m.points) ? m.points : []).flatMap(pt => {
        const q = pt as Record<string, unknown> | null
        const x = unit(q?.x), y = unit(q?.y)
        return x === null || y === null ? [] : [{ x, y }]
      }).slice(0, MAX_SHAPE_POINTS)
      if (points.length < 3) continue
      out.push({ id, kind, letter, points })
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

/** Each photo's markup from a saved draft (`{ [photo key]: marks }`), photos with none left out. */
export function cleanPhotoMarks(value: unknown): Record<string, OverviewMark[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, OverviewMark[]> = {}
  for (const [key, marks] of Object.entries(value as Record<string, unknown>)) {
    const clean = cleanMarks(marks)
    if (key && clean.length) out[key] = clean
  }
  return out
}

/** The middle of an outline (its centre of area), where its letter goes and where it's grabbed. */
export function shapeCentre(points: Point[]): Point {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length]
    const f = p.x * q.y - q.x * p.y
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n }
  }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

/** A mark moved by (dx, dy), kept inside the image. */
export function moveMark(m: OverviewMark, dx: number, dy: number): OverviewMark {
  const c = (n: number) => Math.min(1, Math.max(0, n))
  if (m.kind === 'shape') {
    // The whole outline moves together, stopping at the edge rather than squashing
    const xs = m.points.map(p => p.x), ys = m.points.map(p => p.y)
    const ddx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx))
    const ddy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy))
    return { ...m, points: m.points.map(p => ({ x: p.x + ddx, y: p.y + ddy })) }
  }
  if (m.kind === 'arrow') return { ...m, x1: c(m.x1 + dx), y1: c(m.y1 + dy), x2: c(m.x2 + dx), y2: c(m.y2 + dy) }
  return { ...m, x: c(m.x + dx), y: c(m.y + dy) }
}

/** Where a mark is grabbed to move it: an arrow by its middle, an outline by its centre, the rest where they sit. */
export function markAnchor(m: OverviewMark): Point {
  if (m.kind === 'arrow') return { x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 }
  if (m.kind === 'shape') return shapeCentre(m.points)
  return { x: m.x, y: m.y }
}
