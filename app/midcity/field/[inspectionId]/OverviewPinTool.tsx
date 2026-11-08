'use client'

import { useRef, useState } from 'react'
import { issueColour } from '@/lib/photos/roof-tags'
import { moveMark, newMarkId, type MarkKind, type OverviewMark } from '@/lib/photos/overview-marks'
import { MarkupLayer } from './OverviewMarkup'

// Marks up the roof overview screenshot for the report's first page:
//   Pin    tap to drop the problem's letter (as many as there are spots)
//   Area   drag across a patch to circle it (tap for a standard size)
//   Arrow  drag from where to where
//   Text   tap, type a few words ("Patio", "N ↑")
//   Move   drag any mark; select it to delete it
// Colour = the problem letter (A blue, B red…) or White for general marks.

type Tool = MarkKind | 'move'
const TOOLS: { key: Tool; label: string }[] = [
  { key: 'pin', label: 'Pin' }, { key: 'area', label: 'Area' }, { key: 'arrow', label: 'Arrow' },
  { key: 'text', label: 'Text' }, { key: 'move', label: 'Move' },
]
const HIT_PX = 28

export function OverviewPinTool({ url, marks, letters, onChange }: {
  url: string
  marks: OverviewMark[]
  letters: string[]
  onChange: (marks: OverviewMark[]) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [tool, setTool] = useState<Tool>('pin')
  const [colour, setColour] = useState<string | null>(letters[0] ?? 'A')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<OverviewMark[][]>([])
  const [draft, setDraft] = useState<OverviewMark | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; id?: string; orig?: OverviewMark } | null>(null)

  const commit = (next: OverviewMark[]) => { setHistory(h => [...h.slice(-30), marks]); onChange(next) }
  const pinLetter = colour ?? letters[0] ?? 'A'

  const at = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect()
    const c = (n: number) => Math.min(1, Math.max(0, n))
    return { x: c((e.clientX - r.left) / r.width), y: c((e.clientY - r.top) / r.height), r }
  }

  /** The mark under a point, by its grab spot (pins, areas and labels by their centre, arrows by their middle). */
  const hit = (x: number, y: number, r: DOMRect): OverviewMark | null => {
    let best: OverviewMark | null = null
    let bestD = HIT_PX
    for (const m of marks) {
      const g = m.kind === 'arrow' ? { x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 } : { x: m.x, y: m.y }
      const d = Math.hypot((g.x - x) * r.width, (g.y - y) * r.height)
      if (d <= bestD) { best = m; bestD = d }
    }
    return best
  }

  const shapeFrom = (a: { x: number; y: number }, b: { x: number; y: number }, id: string): OverviewMark | null => {
    if (tool === 'area') {
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2
      return { id, kind: 'area', letter: colour, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, rx: Math.max(rx, 0.01), ry: Math.max(ry, 0.01) }
    }
    if (tool === 'arrow') return { id, kind: 'arrow', letter: colour, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    return null
  }

  const onDown = (e: React.PointerEvent) => {
    if (!size) return
    const p = at(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (tool === 'move') {
      const m = hit(p.x, p.y, p.r)
      setSelectedId(m?.id ?? null)
      drag.current = { x: p.x, y: p.y, moved: false, id: m?.id, orig: m ?? undefined }
      return
    }
    drag.current = { x: p.x, y: p.y, moved: false }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    if (Math.hypot((p.x - d.x) * p.r.width, (p.y - d.y) * p.r.height) > 6) d.moved = true
    if (!d.moved) return
    if (tool === 'move' && d.orig) setDraft(moveMark(d.orig, p.x - d.x, p.y - d.y))
    else if (tool === 'area' || tool === 'arrow') setDraft(shapeFrom(d, p, 'draft'))
  }

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setDraft(null)
    if (!d) return
    const p = at(e)
    if (tool === 'move') {
      if (d.moved && d.orig) commit(marks.map(m => (m.id === d.orig!.id ? moveMark(d.orig!, p.x - d.x, p.y - d.y) : m)))
      return
    }
    if (tool === 'pin' && !d.moved) {
      const m: OverviewMark = { id: newMarkId(), kind: 'pin', letter: pinLetter, x: p.x, y: p.y }
      commit([...marks, m]); setSelectedId(m.id)
    } else if (tool === 'text' && !d.moved) {
      const text = window.prompt('Label (a few words)')?.trim().slice(0, 40)
      if (text) { const m: OverviewMark = { id: newMarkId(), kind: 'text', letter: colour, x: p.x, y: p.y, text }; commit([...marks, m]); setSelectedId(m.id) }
    } else if (tool === 'area') {
      const m = d.moved ? shapeFrom(d, p, newMarkId()) : { id: newMarkId(), kind: 'area' as const, letter: colour, x: p.x, y: p.y, rx: 0.08, ry: 0.08 * (size ? size.w / size.h : 1) }
      if (m) { commit([...marks, m]); setSelectedId(m.id) }
    } else if (tool === 'arrow' && d.moved) {
      const m = shapeFrom(d, p, newMarkId())
      if (m) { commit([...marks, m]); setSelectedId(m.id) }
    }
  }

  const shown = draft
    ? (draft.id === 'draft' ? [...marks, draft] : marks.map(m => (m.id === draft.id ? draft : m)))
    : marks
  const hint = {
    pin: `Tap where (${pinLetter}) is. Tap again for each spot.`,
    area: 'Drag across the patch to circle it, or tap for a standard circle.',
    arrow: 'Drag from where to where.',
    text: 'Tap where the label goes, then type it.',
    move: 'Drag a mark to move it. Tap one, then Delete to remove it.',
  }[tool]

  return (
    <div className="op-tool">
      <div className="rp-chips" style={{ marginBottom: 6 }}>
        {TOOLS.map(t => (
          <button key={t.key} type="button" className={`rp-chip rp-type${tool === t.key ? ' on' : ''}`} aria-pressed={tool === t.key}
            onClick={() => { setTool(t.key); if (t.key === 'pin' && !colour) setColour(letters[0] ?? 'A') }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="rp-chips" style={{ marginBottom: 6 }}>
        {letters.map(l => {
          const on = colour === l
          const c = issueColour(l)
          return (
            <button key={l} type="button" className="rp-chip rp-letter" aria-pressed={on}
              style={{ borderColor: c, color: on ? 'white' : c, background: on ? c : 'white' }}
              onClick={() => setColour(l)}>
              ({l})
            </button>
          )
        })}
        {tool !== 'pin' && (
          <button type="button" className={`rp-chip rp-none${colour === null ? ' on' : ''}`} aria-pressed={colour === null} onClick={() => setColour(null)}>
            White
          </button>
        )}
      </div>
      <div className="rp-chips" style={{ marginBottom: 8 }}>
        <button type="button" className="rp-chip rp-type" disabled={!history.length}
          onClick={() => { const prev = history[history.length - 1]; setHistory(h => h.slice(0, -1)); setSelectedId(null); onChange(prev) }}>
          Undo
        </button>
        <button type="button" className="rp-chip rp-type" disabled={!selectedId || !marks.some(m => m.id === selectedId)}
          onClick={() => { commit(marks.filter(m => m.id !== selectedId)); setSelectedId(null) }}>
          Delete
        </button>
        <button type="button" className="rp-chip rp-type" disabled={!marks.length}
          onClick={() => { if (window.confirm('Clear all the markup on this image?')) { commit([]); setSelectedId(null) } }}>
          Clear all
        </button>
      </div>
      <p className="fa-ai-status" style={{ margin: '0 0 8px' }}>{hint}</p>
      <div ref={boxRef} style={{ position: 'relative', lineHeight: 0, userSelect: 'none' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Roof overview" draggable={false}
          onLoad={e => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6 }} />
        {size && <MarkupLayer marks={shown} w={size.w} h={size.h} selectedId={tool === 'move' ? selectedId : null} />}
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setDraft(null) }}
          style={{ position: 'absolute', inset: 0, cursor: tool === 'move' ? 'grab' : 'crosshair', touchAction: tool === 'pin' || tool === 'text' ? 'manipulation' : 'none' }} />
      </div>
    </div>
  )
}
