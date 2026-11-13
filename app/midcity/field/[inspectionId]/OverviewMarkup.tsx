'use client'

import { useState } from 'react'
import { markColour, shapeCentre, type OverviewMark, type Point } from '@/lib/photos/overview-marks'

// Draws a photo's markup (lib/photos/overview-marks.ts) on top of it: areas
// (circles and outlines, each with its problem letter inside), arrows, text
// labels and problem pins. The drawing uses the image's own size as its
// coordinates, so nothing stretches and the marks line up at any size; drawn
// over a box the image is fitted into (object-fit: contain), it fits the same
// way. Used by the report (page one and the photos) and the field app's markup tool.

const PRINT = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as const

export function MarkupLayer({ marks, w, h, selectedId, drawing }: {
  marks: OverviewMark[]
  w: number
  h: number
  selectedId?: string | null
  /** An outline still being tapped out: its corners so far */
  drawing?: { points: Point[]; letter: string | null } | null
}) {
  const s = Math.max(w, h)
  const stroke = s * 0.006
  const pinR = s * 0.024
  const font = s * 0.026
  const order = { area: 0, shape: 0, arrow: 1, text: 2, pin: 3 } as const
  const sorted = [...marks].sort((a, b) => order[a.kind] - order[b.kind])
  // An area's problem letter, in its middle: big and bold in the problem's colour,
  // ringed in white so it reads on any roof; smaller in a small area
  const areaLetter = (letter: string | null, cx: number, cy: number, span: number) => {
    if (!letter) return null
    const size = Math.max(font * 1.9, Math.min(font * 2.6, span * 0.8))
    return (
      <text x={cx} y={cy + size * 0.36} textAnchor="middle" fontSize={size} fontWeight={900} fill={markColour(letter)}
        stroke="#fff" strokeWidth={size * 0.12} strokeLinejoin="round" paintOrder="stroke" fontFamily="system-ui, sans-serif">{letter}</text>
    )
  }
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
              {areaLetter(m.letter, m.x * w, m.y * h, Math.min(m.rx * w, m.ry * h))}
            </g>
          )
        }
        if (m.kind === 'shape') {
          const pts = m.points.map(p => `${p.x * w},${p.y * h}`).join(' ')
          const mid = shapeCentre(m.points)
          const xs = m.points.map(p => p.x * w), ys = m.points.map(p => p.y * h)
          const span = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2
          return (
            <g key={m.id}>
              <polygon points={pts} fill="none" stroke={halo} strokeWidth={stroke * 2.2} strokeLinejoin="round" />
              <polygon points={pts} fill={white ? 'rgba(255,255,255,.12)' : c} fillOpacity={white ? 1 : 0.16} stroke={c} strokeWidth={stroke} strokeLinejoin="round" />
              {areaLetter(m.letter, mid.x * w, mid.y * h, span)}
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
      {drawing && drawing.points.length > 0 && (() => {
        const c = markColour(drawing.letter)
        const pts = drawing.points.map(p => `${p.x * w},${p.y * h}`).join(' ')
        return (
          <g>
            <polyline points={pts} fill="none" stroke="rgba(0,0,0,.6)" strokeWidth={stroke * 2.2} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={pts} fill="none" stroke={c} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
            {drawing.points.map((p, i) => (
              <circle key={i} cx={p.x * w} cy={p.y * h} r={stroke * (i === 0 ? 3.2 : 2)} fill={i === 0 ? '#fff' : c} stroke={i === 0 ? c : '#fff'} strokeWidth={stroke * 0.8} />
            ))}
          </g>
        )
      })()}
    </svg>
  )
}

/**
 * A report photo with its markup, fitted whole into a box it fills (as the
 * report's photo boxes do: object-fit contain, plus the photo's own crop).
 */
export function PhotoWithMarkup({ url, alt, marks, transform }: { url: string; alt: string; marks?: OverviewMark[]; transform?: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const fill: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', transformOrigin: 'center center', transform }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} style={{ ...fill, objectFit: 'contain' }}
        onLoad={e => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size && !!marks?.length && <div style={fill}><MarkupLayer marks={marks} w={size.w} h={size.h} /></div>}
    </>
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
