'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { emailDocument, hasRemoteImages, textToHtml } from '@/lib/mail/html'

// One email body in a sandboxed frame (see lib/mail/html.ts). Remote images
// stay blocked until the reader asks — remembered per sender.

const storageKey = (sender: string) => `mail-images:${sender.toLowerCase()}`

function readAlwaysShow(sender: string): boolean {
  try {
    return localStorage.getItem(storageKey(sender)) === '1'
  } catch {
    return false
  }
}

export function MessageBody({ html, text, sender }: { html: string; text: string; sender: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)
  const [showImages, setShowImages] = useState(false)

  useEffect(() => {
    setShowImages(readAlwaysShow(sender))
  }, [sender])

  const body = html || textToHtml(text)
  const blocked = !showImages && hasRemoteImages(body)
  const doc = useMemo(() => emailDocument(body, { showRemoteImages: showImages }), [body, showImages])

  // Size the frame to its content, and keep it sized as images load
  const observerRef = useRef<ResizeObserver | null>(null)
  useEffect(() => () => observerRef.current?.disconnect(), [])

  function onLoad() {
    const d = frameRef.current?.contentDocument
    if (!d?.body) return
    // body, not documentElement: the latter never reports less than the frame's own height
    const measure = () => setHeight(Math.max(40, d.body.scrollHeight + 4))
    measure()
    observerRef.current?.disconnect()
    if (d.body && typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(measure)
      observerRef.current.observe(d.body)
    }
  }

  function alwaysShow() {
    try { localStorage.setItem(storageKey(sender), '1') } catch {}
    setShowImages(true)
  }

  return (
    <div>
      {blocked && (
        <div className="mb-images">
          Images are hidden to stop senders tracking when you open their email.
          <button onClick={() => setShowImages(true)}>Show images</button>
          {sender && <button onClick={alwaysShow}>Always show from {sender}</button>}
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Email"
        srcDoc={doc}
        onLoad={onLoad}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{ width: '100%', height, border: 'none', display: 'block' }}
      />
      <style>{`
        .mb-images { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--grey-600); background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; }
        .mb-images button { font: inherit; font-size: 12px; color: var(--info); background: none; border: none; padding: 0; cursor: pointer; }
        .mb-images button:hover { text-decoration: underline; }
      `}</style>
    </div>
  )
}
