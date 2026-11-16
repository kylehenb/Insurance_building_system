'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Photos sized for printing. The browser puts each photo into the PDF as it is,
// so a report's size is the sum of its photos: 50 photos uploaded at ~320 KB
// made a 16 MB PDF. A report photo prints about 9 cm wide, which needs nowhere
// near the 1600 px uploaded, so inside a report each photo is redrawn at print
// size first (a fraction of the bytes, no visible difference on paper). The
// report's Print button waits until they're done. A photo that can't be
// redrawn (the browser isn't allowed to read it) prints as it is.

/** Long edge for a photo in the report's photo grid: it prints about 8.5 cm wide, so ~240 dots per inch */
export const GRID_EDGE = 800
/** Long edge for page one's roof overview, printed nearly full width */
export const OVERVIEW_EDGE = 1600
const QUALITY = 0.62
const AT_ONCE = 2 // iPhone Safari runs out of memory with many canvases at once

const cache = new Map<string, Promise<string>>()
let running = 0
const waiting: Array<() => void> = []

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>(r => waiting.push(r))
  running++
  try { return await fn() } finally {
    running--
    waiting.shift()?.()
  }
}

function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    // Photos from storage are on another site: read them with CORS so the canvas can be saved
    if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** A smaller copy of a photo for printing (a blob: URL), or the photo's own URL when it can't be made smaller */
export function printSize(url: string, edge: number): Promise<string> {
  const key = `${edge}|${url}`
  let made = cache.get(key)
  if (!made) {
    made = slot(async () => {
      const img = await load(url)
      if (!img) return url
      const w = img.naturalWidth, h = img.naturalHeight
      // Already small (a phone's own preview): leave it
      if (!w || !h || Math.max(w, h) <= edge) return url
      const scale = edge / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      try {
        const ctx = canvas.getContext('2d')!
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', QUALITY))
        return blob ? URL.createObjectURL(blob) : url
      } catch {
        return url // the browser wouldn't let the photo be read back
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
    })
    cache.set(key, made)
  }
  return made
}

interface PrintImages { register: () => () => void }
const PrintImagesContext = createContext<PrintImages | null>(null)

/** Around a report: counts the photos still being sized, so Print can wait for them */
export function usePrintImagesProvider() {
  const [pending, setPending] = useState(0)
  const [total, setTotal] = useState(0)
  const value = useMemo<PrintImages>(() => ({
    register: () => {
      setPending(n => n + 1)
      setTotal(n => n + 1)
      let done = false
      return () => { if (!done) { done = true; setPending(n => n - 1) } }
    },
  }), [])
  // Never hold Print up for long: after 30 s it prints with whatever is ready
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 30_000)
    return () => clearTimeout(t)
  }, [])
  const Provider = useCallback(({ children }: { children: React.ReactNode }) => (
    <PrintImagesContext.Provider value={value}>{children}</PrintImagesContext.Provider>
  ), [value])
  return { Provider, ready: pending <= 0 || gaveUp, done: total - pending, total }
}

/**
 * The URL to show a photo with: inside a report, its print-size copy once made
 * (null until then, so it isn't loaded twice); anywhere else, the photo itself.
 */
export function usePrintSrc(url: string, edge: number): string | null {
  const ctx = useContext(PrintImagesContext)
  const [src, setSrc] = useState<string | null>(ctx ? null : url)
  const registered = useRef<{ url: string; done: () => void } | null>(null)
  useEffect(() => {
    if (!ctx) return
    let live = true
    if (registered.current?.url !== url) {
      registered.current?.done()
      registered.current = { url, done: ctx.register() }
    }
    const mine = registered.current
    void printSize(url, edge).then(s => { if (live) { setSrc(s); mine.done() } })
    return () => { live = false }
  }, [ctx, url, edge])
  useEffect(() => () => registered.current?.done(), [])
  return ctx ? src : url
}
