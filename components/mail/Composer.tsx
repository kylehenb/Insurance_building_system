'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RichTextEditor, type RichTextEditorHandle } from '@/components/email/RichTextEditor'
import { MessageBody } from '@/components/mail/MessageBody'
import {
  formatAddress, MAX_EMAIL_BYTES, readAddressInput,
  type ComposeStart, type ComposeState, type DraftAttachment,
} from '@/lib/mail/compose-rules'
import type { MailAddress } from '@/lib/mail/summary'

// Writing an email — new, reply, reply all or forward. What's written is
// saved as a Gmail draft a couple of seconds after each change (so it's in
// the Gmail app's Drafts too, and closing loses nothing). Sending hands the
// saved draft to the page, which holds it for a few seconds so it can be undone.

export interface ComposerHandle {
  /** Saves any unsaved changes; resolves to the draft id (null if nothing was written) */
  flush(): Promise<string | null>
}

interface Props {
  initial: ComposeStart
  variant: 'floating' | 'inline'
  onClose(draftId: string | null): void
  onDiscarded(): void
  onSend(draftId: string): void
}

const SAVE_AFTER_MS = 2000
const BUCKET = 'mail-attachments'

type Uploading = { id: string; filename: string; error?: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const TITLES = { new: 'New message', reply: 'Reply', reply_all: 'Reply all', forward: 'Forward' } as const

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ initial, variant, onClose, onDiscarded, onSend }, ref) {
  const [state, setState] = useState<ComposeState>(initial)
  const [showCc, setShowCc] = useState(!!(initial.cc || initial.bcc))
  const [showQuote, setShowQuote] = useState(false)
  const [minimised, setMinimised] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(initial.draftId ? 'saved' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Uploading[]>([])
  const [busy, setBusy] = useState(false)

  const stateRef = useRef(state)
  const dirty = useRef(false)
  const saving = useRef<Promise<string | null> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<RichTextEditorHandle>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { stateRef.current = state }, [state])

  const save = useCallback(async (): Promise<string | null> => {
    // One save at a time; changes made meanwhile are picked up by the next
    if (saving.current) await saving.current.catch(() => null)
    if (!dirty.current) return stateRef.current.draftId
    dirty.current = false
    setStatus('saving')
    const run = (async () => {
      const res = await fetch('/api/mail/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stateRef.current),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        dirty.current = true
        throw new Error(body.error ?? 'Could not save the draft')
      }
      const next = { ...stateRef.current, draftId: body.draftId as string, threadId: (body.threadId as string | null) ?? stateRef.current.threadId }
      stateRef.current = next
      setState(s => ({ ...s, draftId: next.draftId, threadId: next.threadId }))
      return next.draftId
    })()
    saving.current = run
    try {
      const id = await run
      setStatus('saved')
      setError(null)
      return id
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not save the draft')
      throw err
    } finally {
      if (saving.current === run) saving.current = null
    }
  }, [])

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    return save()
  }, [save])

  useImperativeHandle(ref, () => ({ flush }), [flush])

  // Save a couple of seconds after the last change
  function change(patch: Partial<ComposeState>) {
    setState(s => {
      const next = { ...s, ...patch }
      stateRef.current = next
      return next
    })
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { save().catch(() => {}) }, SAVE_AFTER_MS)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Keep what's written if the page is closed mid-sentence
  useEffect(() => {
    function onUnload(e: BeforeUnloadEvent) {
      if (dirty.current || saving.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // Replies start in the text; the editor takes a moment to be ready
  useEffect(() => {
    if (initial.mode === 'new' && !initial.draftId) return
    const timers = [0, 60, 200, 500].map(ms => setTimeout(() => {
      if (!document.activeElement?.closest('.cmp')) editorRef.current?.focus()
    }, ms))
    return () => timers.forEach(clearTimeout)
  }, [initial.mode, initial.draftId])

  async function attach(files: FileList | File[]) {
    const supabase = createClient()
    const already = stateRef.current.attachments.reduce((n, a) => n + a.size, 0)
    let total = already
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID()
      total += file.size
      if (total > MAX_EMAIL_BYTES) {
        setUploading(u => [...u, { id, filename: file.name, error: 'Over Gmail\'s 25 MB limit' }])
        continue
      }
      setUploading(u => [...u, { id, filename: file.name }])
      try {
        const res = await fetch('/api/mail/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, size: file.size }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Upload failed')
        const { error: upErr } = await supabase.storage.from(BUCKET).uploadToSignedUrl(body.path, body.token, file, { contentType: file.type || 'application/octet-stream' })
        if (upErr) throw new Error(upErr.message)
        const attachment: DraftAttachment = { kind: 'upload', path: body.path, filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }
        change({ attachments: [...stateRef.current.attachments, attachment] })
        setUploading(u => u.filter(x => x.id !== id))
      } catch (err) {
        setUploading(u => u.map(x => (x.id === id ? { ...x, error: err instanceof Error ? err.message : 'Upload failed' } : x)))
      }
    }
  }

  async function send() {
    const fields = [state.to, state.cc, state.bcc].map(readAddressInput)
    const invalid = fields.flatMap(f => f.invalid)
    if (invalid.length) { setError(`Not a valid address: ${invalid.join(', ')}`); return }
    if (fields.every(f => f.addresses.length === 0)) { setError('Add at least one recipient'); return }
    if (uploading.some(u => !u.error)) { setError('Wait for the attachments to finish uploading'); return }
    setBusy(true)
    setError(null)
    try {
      // Sending sends the saved draft, so it must be saved as it is now
      dirty.current = true
      const id = await flush()
      if (id) onSend(id)
    } catch {
      // save() has shown the error
    } finally {
      setBusy(false)
    }
  }

  async function close() {
    try {
      const id = await flush()
      onClose(id)
    } catch {
      // Keep it open so nothing is lost; the error is showing
    }
  }

  async function discard() {
    if (timer.current) clearTimeout(timer.current)
    dirty.current = false
    setBusy(true)
    try {
      await saving.current?.catch(() => null)
      const id = stateRef.current.draftId
      if (id) {
        const res = await fetch(`/api/mail/drafts/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not discard the draft')
      }
      onDiscarded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard the draft')
      setBusy(false)
    }
  }

  const statusText = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Draft saved' : ''
  const title = state.mode === 'new' ? (state.subject || TITLES.new) : TITLES[state.mode]

  return (
    <div
      className={`cmp cmp-${variant}${minimised ? ' min' : ''}`}
      onKeyDown={e => {
        // The page's shortcuts (e archive, # delete…) don't apply while writing
        e.stopPropagation()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
        if (e.key === 'Escape' && variant === 'floating') { e.preventDefault(); close() }
      }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); attach(e.dataTransfer.files) } }}
    >
      {variant === 'floating' && (
        <div className="cmp-head" onClick={() => setMinimised(m => !m)}>
          <span className="cmp-title">{title}</span>
          <span className="cmp-head-btns" onClick={e => e.stopPropagation()}>
            <button title={minimised ? 'Restore' : 'Minimise'} onClick={() => setMinimised(m => !m)}>{minimised ? '▴' : '▾'}</button>
            <button title="Save & close (Esc)" onClick={close}>✕</button>
          </span>
        </div>
      )}

      {!minimised && (
        <>
          <RecipientField label="To" value={state.to} onChange={to => change({ to })} autoFocus={variant === 'floating' && state.mode !== 'reply' && state.mode !== 'reply_all'}
            extra={!showCc && <button className="cmp-link" onClick={() => setShowCc(true)}>Cc Bcc</button>} />
          {showCc && <RecipientField label="Cc" value={state.cc} onChange={cc => change({ cc })} />}
          {showCc && <RecipientField label="Bcc" value={state.bcc} onChange={bcc => change({ bcc })} />}
          <div className="cmp-row">
            <input className="cmp-subject" placeholder="Subject" value={state.subject} onChange={e => change({ subject: e.target.value })} />
          </div>

          <div className="cmp-editor">
            <RichTextEditor ref={editorRef} value={state.body} onChange={body => change({ body })} minHeight={variant === 'floating' ? 220 : 160} />
          </div>

          {initial.quoteHtml && (
            <div className="cmp-quote">
              <button className="cmp-dots" title={showQuote ? 'Hide quoted text' : 'Show quoted text'} onClick={() => setShowQuote(s => !s)}>•••</button>
              {showQuote && <div className="cmp-quote-body"><MessageBody html={initial.quoteHtml} text="" sender="" /></div>}
            </div>
          )}

          {(state.attachments.length > 0 || uploading.length > 0) && (
            <div className="cmp-files">
              {state.attachments.map((a, i) => (
                <span key={i} className="cmp-file">
                  📎 {a.filename} <span className="cmp-file-size">{formatSize(a.size)}</span>
                  <button title="Remove" onClick={() => change({ attachments: state.attachments.filter((_, j) => j !== i) })}>✕</button>
                </span>
              ))}
              {uploading.map(u => (
                <span key={u.id} className={`cmp-file${u.error ? ' err' : ' up'}`}>
                  {u.error ? `${u.filename}: ${u.error}` : `Uploading ${u.filename}…`}
                  {u.error && <button title="Dismiss" onClick={() => setUploading(x => x.filter(y => y.id !== u.id))}>✕</button>}
                </span>
              ))}
            </div>
          )}

          {error && <div className="cmp-error">{error}</div>}

          <div className="cmp-foot">
            <button className="cmp-send" onClick={send} disabled={busy} title="Send (Ctrl+Enter)">Send</button>
            <button className="cmp-icon" title="Attach files" onClick={() => fileRef.current?.click()}>📎</button>
            <input ref={fileRef} type="file" multiple hidden onChange={e => { if (e.target.files) attach(e.target.files); e.target.value = '' }} />
            <label className="cmp-sig" title="Add the company email signature (Settings → Email Templates)">
              <input type="checkbox" checked={state.includeSignature} onChange={e => change({ includeSignature: e.target.checked })} /> Signature
            </label>
            <span className="cmp-status">{statusText}</span>
            {variant === 'inline' && <button className="cmp-link" onClick={close}>Close</button>}
            <button className="cmp-icon" title="Discard draft" onClick={discard} disabled={busy}>🗑</button>
          </div>
        </>
      )}
      <style>{COMPOSER_CSS}</style>
    </div>
  )
})

function RecipientField({ label, value, onChange, autoFocus, extra }: {
  label: string
  value: string
  onChange(v: string): void
  autoFocus?: boolean
  extra?: React.ReactNode
}) {
  const [found, setSuggestions] = useState<MailAddress[]>([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  // Suggest for the address being typed (after the last comma)
  const typing = value.slice(value.lastIndexOf(',') + 1).trim()
  const searching = typing.length >= 2 && !typing.includes('<')
  const suggestions = searching ? found : []
  useEffect(() => {
    if (!searching) return
    const n = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mail/contacts?q=${encodeURIComponent(typing)}`)
        if (!res.ok || n !== seq.current) return
        setSuggestions(await res.json())
        setActive(0)
      } catch {
        // Suggestions are a nicety
      }
    }, 200)
    return () => clearTimeout(t)
  }, [typing, searching])

  function pick(a: MailAddress) {
    const before = value.slice(0, value.lastIndexOf(',') + 1)
    onChange(`${before}${before ? ' ' : ''}${formatAddress(a)}, `)
    setSuggestions([])
  }

  return (
    <div className="cmp-row cmp-recip">
      <span className="cmp-label">{label}</span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setSuggestions([]), 150)}
        onKeyDown={e => {
          if (suggestions.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, suggestions.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]) }
          if (e.key === 'Escape') { e.stopPropagation(); setSuggestions([]) }
        }}
      />
      {extra}
      {suggestions.length > 0 && (
        <div className="cmp-suggest">
          {suggestions.map((s, i) => (
            <button key={s.email} className={i === active ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pick(s) }}>
              <strong>{s.name || s.email}</strong>{s.name && <span>{s.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const COMPOSER_CSS = `
  .cmp { background: var(--paper); font-size: 14px; color: var(--ink); }
  .cmp-floating { position: fixed; right: 24px; bottom: 0; z-index: 60; width: min(600px, calc(100vw - 48px)); max-height: calc(100vh - 40px); overflow-y: auto; border-radius: 10px 10px 0 0; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
  .cmp-floating.min { width: 300px; }
  .cmp-inline { border: 0.5px solid var(--line-strong); border-radius: 10px; box-shadow: 0 1px 6px rgba(60,50,40,.12); margin: 8px 0 24px; overflow: visible; }
  .cmp-head { display: flex; justify-content: space-between; align-items: center; background: var(--ink); color: var(--cream); padding: 9px 14px; border-radius: 10px 10px 0 0; cursor: pointer; }
  .cmp-title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cmp-head-btns button { background: none; border: none; color: var(--cream); font-size: 13px; cursor: pointer; padding: 0 5px; }
  .cmp-row { display: flex; align-items: center; gap: 8px; border-bottom: 0.5px solid var(--line-faint); padding: 0 14px; position: relative; }
  .cmp-row input { flex: 1; min-width: 0; font: inherit; font-size: 14px; border: none; outline: none; padding: 9px 0; background: none; color: var(--ink); }
  .cmp-label { color: var(--subtle); font-size: 13px; width: 28px; }
  .cmp-link { font: inherit; font-size: 13px; color: var(--grey-600); background: none; border: none; cursor: pointer; padding: 0; }
  .cmp-link:hover { color: var(--ink); text-decoration: underline; }
  .cmp-suggest { position: absolute; left: 50px; top: 100%; z-index: 5; min-width: 320px; background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.15); padding: 4px 0; }
  .cmp-suggest button { display: flex; flex-direction: column; align-items: flex-start; width: 100%; font: inherit; font-size: 13px; text-align: left; background: none; border: none; padding: 6px 12px; cursor: pointer; }
  .cmp-suggest button span { font-size: 12px; color: var(--subtle); }
  .cmp-suggest button.on, .cmp-suggest button:hover { background: var(--surface-2); }
  .cmp-editor { padding: 10px 14px 4px; }
  .cmp-quote { padding: 0 14px; }
  .cmp-dots { font-size: 10px; letter-spacing: 1px; color: var(--grey-600); background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 6px; padding: 0 6px; cursor: pointer; }
  .cmp-quote-body { margin-top: 8px; opacity: .85; }
  .cmp-files { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 14px 0; }
  .cmp-file { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 6px; padding: 4px 8px; max-width: 100%; }
  .cmp-file.up { color: var(--subtle); }
  .cmp-file.err { color: var(--danger-dark); background: var(--danger-bg); border-color: var(--danger-soft); }
  .cmp-file-size { color: var(--subtle); }
  .cmp-file button { background: none; border: none; color: var(--subtle); cursor: pointer; font-size: 11px; padding: 0; }
  .cmp-error { margin: 8px 14px 0; font-size: 13px; color: var(--danger-dark); background: var(--danger-bg); border-radius: 6px; padding: 6px 10px; }
  .cmp-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .cmp-send { font: inherit; font-size: 14px; font-weight: 600; color: var(--cream); background: var(--ink); border: none; border-radius: 18px; padding: 8px 22px; cursor: pointer; }
  .cmp-send:hover { background: var(--ink-hover); }
  .cmp-send:disabled { opacity: .6; cursor: default; }
  .cmp-icon { font-size: 15px; background: none; border: none; cursor: pointer; padding: 4px; border-radius: 50%; opacity: .75; }
  .cmp-icon:hover { opacity: 1; background: var(--surface-2); }
  .cmp-icon:last-child { margin-left: auto; }
  .cmp-sig { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--grey-600); cursor: pointer; }
  .cmp-status { font-size: 12px; color: var(--subtle); }
`
