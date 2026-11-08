'use client'

import { useState } from 'react'
import { markColour, type OverviewMark } from '@/lib/photos/overview-marks'

// Draws the roof overview screenshot with its markup (lib/photos/overview-marks.ts)
// on top: areas, arrows, text labels and problem pins. The drawing uses the
// image's own size as its coordinates, so nothing stretches and the marks line
// up at any size. Used by the report's first page and the field app's pin tool.

const PRINT = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as const

export function MarkupLayer({ marks, w, h, selectedId }: { marks: OverviewMark[]; w: number; h: number; selectedId?: string | null }) {
  const s = Math.max(w, h)
  const stroke = s * 0.006
  const pinR = s * 0.024
  const font = s * 0.026
  const order = { area: 0, arrow: 1, text: 2, pin: 3 } as const
  const sorted = [...marks].sort((a, b) => order[a.kind] - order[b.kind])
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', ...PRINT }}>
      {sorted.map(m => {
        const c = markColour(m.letter)
        const white = !m.letter
        const sel = m.id === selectedId
        const halo = sel ? 'rgba(0,0,0,.85)' : 'rgba(0,0,0,.45)'
        if (m.kind === 'area') {
          return (
            <g key={m.id}>
              <ellipse cx={m.x * w} cy={m.y * h} rx={m.rx * w} ry={m.ry * h} fill="none" stroke={halo} strokeWidth={stroke * 2.2} />
              <ellipse cx={m.x * w} cy={m.y * h} rx={m.rx * w} ry={m.ry * h} fill={white ? 'rgba(255,255,255,.12)' : c} fillOpacity={white ? 1 : 0.16} stroke={c} strokeWidth={stroke} />
            </g>
          )
        }
        if (m.kind === 'arrow') {
          const x1 = m.x1 * w, y1 = m.y1 * h, x2 = m.x2 * w, y2 = m.y2 * h
          const ang = Math.atan2(y2 - y1, x2 - x1)
          const head = stroke * 5
          const p = (a: number) => `${x2 - head * Math.cos(ang - a)},${y2 - head * Math.sin(ang - a)}`
          const tip = `${x2},${y2} ${p(0.45)} ${p(-0.45)}`
          // The line stops at the head's base so its end doesn't poke through the point
          const bx = x2 - head * 0.8 * Math.cos(ang), by = y2 - head * 0.8 * Math.sin(ang)
          return (
            <g key={m.id}>
              <line x1={x1} y1={y1} x2={bx} y2={by} stroke={halo} strokeWidth={stroke * 2.2} strokeLinecap="round" />
              <polygon points={tip} fill={halo} stroke={halo} strokeWidth={stroke * 1.2} strokeLinejoin="round" />
              <line x1={x1} y1={y1} x2={bx} y2={by} stroke={c} strokeWidth={stroke} strokeLinecap="round" />
              <polygon points={tip} fill={c} />
            </g>
          )
        }
        if (m.kind === 'text') {
          const tw = m.text.length * font * 0.56 + font * 0.9
          const th = font * 1.55
          return (
            <g key={m.id} transform={`translate(${m.x * w} ${m.y * h})`}>
              <rect x={-tw / 2} y={-th / 2} width={tw} height={th} rx={th * 0.22} fill={white ? 'rgba(20,16,16,.78)' : c}
                stroke={sel ? '#000' : 'rgba(255,255,255,.9)'} strokeWidth={stroke * 0.5} />
              <text x={0} y={font * 0.36} textAnchor="middle" fontSize={font} fontWeight={700} fill="#fff" fontFamily="system-ui, sans-serif">{m.text}</text>
            </g>
          )
        }
        return (
          <g key={m.id}>
            <circle cx={m.x * w} cy={m.y * h} r={pinR + stroke * 0.9} fill={sel ? '#000' : '#fff'} />
            <circle cx={m.x * w} cy={m.y * h} r={pinR} fill={c} />
            <text x={m.x * w} y={m.y * h + font * 0.36} textAnchor="middle" fontSize={font} fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif">{m.letter}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** The screenshot with its markup, shown whole (never cropped) within `maxHeight`. */
export function OverviewWithMarkup({ url, marks, maxHeight, size, onSize }: {
  url: string
  marks: OverviewMark[]
  maxHeight: number
  /** The image's size when already known */
  size?: { w: number; h: number } | null
  onSize?: (w: number, h: number) => void
}) {
  const [loaded, setLoaded] = useState<{ w: number; h: number } | null>(size ?? null)
  return (
    <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Roof overview" style={{ display: 'block', maxWidth: '100%', maxHeight, height: 'auto', width: 'auto' }}
        onLoad={e => { const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight; setLoaded({ w, h }); onSize?.(w, h) }} />
      {loaded && <MarkupLayer marks={marks} w={loaded.w} h={loaded.h} />}
    </div>
  )
}
