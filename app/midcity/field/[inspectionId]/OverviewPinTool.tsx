'use client'

import { useRef, useState } from 'react'
import { issueColour, type OverviewPin } from '@/lib/photos/roof-tags'

// Pins the problem letters onto the roof overview screenshot for the report's
// first page: pick a letter, tap the roof where the problem is. Drag a pin to
// move it. Positions are kept as fractions of the image, so they stay put
// whatever size the report draws it.

export function OverviewPinTool({ url, pins, letters, onChange }: {
  url: string
  pins: OverviewPin[]
  letters: string[]
  onChange: (pins: OverviewPin[]) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [selected, setSelected] = useState<string>(() => letters.find(l => !pins.some(p => p.letter === l)) ?? letters[0] ?? 'A')
  const [dragging, setDragging] = useState<OverviewPin | null>(null)

  const at = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return null
    const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
    return { x: clamp((clientX - r.left) / r.width), y: clamp((clientY - r.top) / r.height) }
  }

  const place = (letter: string, pos: { x: number; y: number }) => {
    onChange([...pins.filter(p => p.letter !== letter), { letter, ...pos }].sort((a, b) => a.letter.localeCompare(b.letter)))
  }

  const tapImage = (e: React.MouseEvent) => {
    const pos = at(e.clientX, e.clientY)
    if (!pos) return
    place(selected, pos)
    // On to the next letter that hasn't been placed
    const next = letters.find(l => l !== selected && !pins.some(p => p.letter === l))
    if (next) setSelected(next)
  }

  const shown = dragging ? [...pins.filter(p => p.letter !== dragging.letter), dragging] : pins
  const placed = pins.some(p => p.letter === selected)

  return (
    <div className="op-tool">
      <div className="rp-chips" style={{ marginBottom: 8 }}>
        {letters.map(l => {
          const on = l === selected
          const c = issueColour(l)
          const done = pins.some(p => p.letter === l)
          return (
            <button key={l} type="button" className="rp-chip rp-letter" aria-pressed={on}
              style={{ borderColor: c, color: on ? 'white' : c, background: on ? c : 'white' }}
              onClick={() => setSelected(l)}>
              ({l}){done ? ' ✓' : ''}
            </button>
          )
        })}
        {placed && (
          <button type="button" className="rp-chip rp-none" onClick={() => onChange(pins.filter(p => p.letter !== selected))}>
            Remove ({selected})
          </button>
        )}
      </div>
      <p className="fa-ai-status" style={{ margin: '0 0 8px' }}>
        Tap the roof where ({selected}) is. Drag a pin to move it.
      </p>
      <div style={{ position: 'relative', lineHeight: 0, userSelect: 'none' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={url} alt="Roof overview" draggable={false} onClick={tapImage}
          style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, cursor: 'crosshair' }} />
        {shown.map(p => (
          <button key={p.letter} type="button" aria-label={`Pin ${p.letter}`}
            onPointerDown={e => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setSelected(p.letter); setDragging(p) }}
            onPointerMove={e => { if (dragging?.letter !== p.letter) return; const pos = at(e.clientX, e.clientY); if (pos) setDragging({ letter: p.letter, ...pos }) }}
            onPointerUp={() => { if (dragging) place(dragging.letter, { x: dragging.x, y: dragging.y }); setDragging(null) }}
            onPointerCancel={() => setDragging(null)}
            style={{
              position: 'absolute', left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: 'translate(-50%, -50%)',
              width: 34, height: 34, borderRadius: '50%', background: issueColour(p.letter), color: '#fff',
              fontWeight: 800, fontSize: 14, lineHeight: 1, padding: 0, border: '3px solid #fff',
              boxShadow: p.letter === selected ? '0 0 0 3px rgba(0,0,0,.55)' : '0 2px 6px rgba(0,0,0,.4)',
              touchAction: 'none', cursor: 'grab',
            }}>
            {p.letter}
          </button>
        ))}
      </div>
    </div>
  )
}
