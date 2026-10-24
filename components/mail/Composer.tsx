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
import type { JobHit, JobPanel } from '@/lib/mail/job-context'
import type { JobAttachables, JobFileSource } from '@/lib/mail/job-files'
import type { DocumentRef } from '@/lib/documents/send/documents'
import { isoToPerthLocal, MIN_SCHEDULE_LEAD_MS, perthLocalToIso, schedulePresets, spokenSendAt } from '@/lib/mail/schedule-rules'

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
  /** Send later: sendAt is an ISO time */
  onSchedule(draftId: string, sendAt: string): void
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

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ initial, variant, onClose, onDiscarded, onSend, onSchedule }, ref) {
  const [state, setState] = useState<ComposeState>(initial)
  const [showCc, setShowCc] = useState(!!(initial.cc || initial.bcc))
  const [showQuote, setShowQuote] = useState(false)
  const [minimised, setMinimised] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(initial.draftId ? 'saved' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Uploading[]>([])
  const [busy, setBusy] = useState(false)
  const [scheduleMenu, setScheduleMenu] = useState<'closed' | 'presets' | 'pick'>('closed')
  const [pickAt, setPickAt] = useState('')
  const [job, setJob] = useState<JobPanel | null>(null)
  const [linking, setLinking] = useState(false)
  const [picker, setPicker] = useState(false)
  const [signature, setSignature] = useState<string | null | undefined>(undefined)

  const stateRef = useRef(state)
  const dirty = useRef(false)
  const saving = useRef<Promise<string | null> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<RichTextEditorHandle>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { stateRef.current = state }, [state])

  // Writing about a job: its contacts and documents are a click away
  useEffect(() => {
    if (!state.jobId) return
    let cancelled = false
    fetch(`/api/mail/jobs/${state.jobId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setJob(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [state.jobId])

  // The company signature, shown under the text as it will be sent
  useEffect(() => {
    let cancelled = false
    fetch('/api/mail/signature')
      .then(r => (r.ok ? r.json() : { html: null }))
      .then(d => { if (!cancelled) setSignature(d.html ?? null) })
      .catch(() => { if (!cancelled) setSignature(null) })
    return () => { cancelled = true }
  }, [])

  /** Files the email about a job: its contacts, documents, files and photos are offered, and the sent copy is filed on it */
  function linkJob(hit: JobHit) {
    const patch: Partial<ComposeState> = { jobId: hit.id }
    if (!stateRef.current.subject.trim()) patch.subject = [hit.job_number, hit.property_address].filter(Boolean).join(' - ')
    change(patch)
    setLinking(false)
  }

  function unlinkJob() {
    change({ jobId: null })
    setPicker(false)
  }

  function addRecipient(field: 'to' | 'cc', address: string) {
    const current = stateRef.current[field]
    const { addresses } = readAddressInput(current)
    const email = readAddressInput(address).addresses[0]?.email.toLowerCase()
    if (email && addresses.some(a => a.email.toLowerCase() === email)) return
    const trimmed = current.trim().replace(/,$/, '')
    change({ [field]: trimmed ? `${trimmed}, ${address}` : address } as Partial<ComposeState>)
    if (field === 'cc') setShowCc(true)
  }

  async function attachDocument(ref: DocumentRef, title: string) {
    const id = crypto.randomUUID()
    setUploading(u => [...u, { id, filename: title }])
    try {
      const res = await fetch('/api/mail/job-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: stateRef.current.jobId, ref }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not make the PDF')
      change({ attachments: [...stateRef.current.attachments, body.attachment as DraftAttachment] })
      setUploading(u => u.filter(x => x.id !== id))
    } catch (err) {
      setUploading(u => u.map(x => (x.id === id ? { ...x, error: err instanceof Error ? err.message : 'Failed' } : x)))
    }
  }

  async function attachJobFile(source: JobFileSource, id: string, filename: string, size: number | null) {
    const upId = crypto.randomUUID()
    const total = stateRef.current.attachments.reduce((n, a) => n + a.size, 0) + (size ?? 0)
    if (total > MAX_EMAIL_BYTES) {
      setUploading(u => [...u, { id: upId, filename, error: 'Over Gmail\'s 25 MB limit' }])
      return
    }
    setUploading(u => [...u, { id: upId, filename }])
    try {
      const res = await fetch('/api/mail/job-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: stateRef.current.jobId, source, id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not attach the file')
      change({ attachments: [...stateRef.current.attachments, body.attachment as DraftAttachment] })
      setUploading(u => u.filter(x => x.id !== upId))
    } catch (err) {
      setUploading(u => u.map(x => (x.id === upId ? { ...x, error: err instanceof Error ? err.message : 'Failed' } : x)))
    }
  }

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

  /** Saves it as it is now, ready to send; null (with the reason showing) if it isn't ready */
  async function readyToSend(): Promise<string | null> {
    const fields = [state.to, state.cc, state.bcc].map(readAddressInput)
    const invalid = fields.flatMap(f => f.invalid)
    if (invalid.length) { setError(`Not a valid address: ${invalid.join(', ')}`); return null }
    if (fields.every(f => f.addresses.length === 0)) { setError('Add at least one recipient'); return null }
    if (uploading.some(u => !u.error)) { setError('Wait for the attachments to finish uploading'); return null }
    setBusy(true)
    setError(null)
    try {
      // Sending sends the saved draft, so it must be saved as it is now
      dirty.current = true
      return await flush()
    } catch {
      return null // save() has shown the error
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const id = await readyToSend()
    if (id) onSend(id)
  }

  async function schedule(sendAt: string | null) {
    if (!sendAt || new Date(sendAt).getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
      setError('Choose a time at least a minute from now')
      return
    }
    setScheduleMenu('closed')
    const id = await readyToSend()
    if (id) onSchedule(id, sendAt)
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

          {state.jobId && job?.id === state.jobId ? (
            <div className="cmp-job">
              <span className="cmp-job-chip" title="Sent copies are filed on this job">
                {job.job_number}
                <button title="Unlink this job" aria-label="Unlink this job" onClick={unlinkJob}>✕</button>
              </span>
              {job.contacts.map(c => (
                <button key={c.email} className="cmp-job-add" title={`Add ${c.email} (Shift: Cc)`}
                  onClick={e => addRecipient(e.shiftKey ? 'cc' : 'to', c.name ? `${c.name} <${c.email}>` : c.email)}>
                  + {c.label}
                </button>
              ))}
              <button className={`cmp-job-attach${picker ? ' on' : ''}`} onClick={() => setPicker(p => !p)}>📁 Attach from job</button>
            </div>
          ) : !state.jobId && (
            <div className="cmp-job">
              {linking
                ? <JobSearch onPick={linkJob} onCancel={() => setLinking(false)} />
                : <button className="cmp-job-add" title="File this email on a job and attach its documents, files and photos" onClick={() => setLinking(true)}>+ Link to a job</button>}
            </div>
          )}

          {picker && state.jobId && job?.id === state.jobId && (
            <JobFilesPicker
              key={state.jobId}
              jobId={state.jobId}
              documents={job.documents}
              onDocument={d => attachDocument(d.ref, `${d.title}.pdf`)}
              onFile={(source, id, name, size) => attachJobFile(source, id, name, size)}
              onClose={() => setPicker(false)}
            />
          )}

          <div className="cmp-editor">
            <RichTextEditor ref={editorRef} value={state.body} onChange={body => change({ body })} minHeight={variant === 'floating' ? 220 : 160} />
          </div>

          {state.includeSignature && signature !== undefined && (
            signature
              ? <div className="cmp-sig-preview" title="Added when sent — change it in Settings → Email Templates" dangerouslySetInnerHTML={{ __html: signature }} />
              : <div className="cmp-sig-none">No signature set up yet — add one in <a href="/dashboard/settings/email-templates">Settings → Email Templates</a>.</div>
          )}

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
            <span className="cmp-send-group">
              <button className="cmp-send" onClick={send} disabled={busy} title="Send (Ctrl+Enter)">Send</button>
              <button className="cmp-send-more" disabled={busy} title="Schedule send" aria-label="Schedule send"
                onClick={() => setScheduleMenu(m => (m === 'closed' ? 'presets' : 'closed'))}>▾</button>
              {scheduleMenu !== 'closed' && (
                <div className="cmp-sched">
                  <div className="cmp-sched-title">Schedule send <span>(Perth time)</span></div>
                  {scheduleMenu === 'presets' ? (
                    <>
                      {schedulePresets().map(p => (
                        <button key={p.label} onClick={() => schedule(p.at)}>
                          <span>{p.label}</span><span className="cmp-sched-when">{spokenSendAt(p.at)}</span>
                        </button>
                      ))}
                      <button onClick={() => { setPickAt(isoToPerthLocal(schedulePresets()[0].at)); setScheduleMenu('pick') }}>Pick date &amp; time</button>
                    </>
                  ) : (
                    <div className="cmp-sched-pick">
                      <input type="datetime-local" value={pickAt} onChange={e => setPickAt(e.target.value)} />
                      <div>
                        <button className="cmp-link" onClick={() => setScheduleMenu('presets')}>Back</button>
                        <button className="cmp-send" onClick={() => schedule(perthLocalToIso(pickAt))}>Schedule send</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </span>
            <button className="cmp-icon" title="Attach files from your computer" onClick={() => fileRef.current?.click()}>📎</button>
            <button className="cmp-icon" title="Attach documents, files or photos from a job"
              onClick={() => { if (state.jobId) setPicker(p => !p); else setLinking(true) }}>📁</button>
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

function JobSearch({ onPick, onCancel }: { onPick(hit: JobHit): void; onCancel(): void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<JobHit[]>([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  const term = q.trim()
  const searching = term.length >= 2
  const hits = searching ? found : []
  useEffect(() => {
    if (!searching) return
    const n = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mail/jobs?q=${encodeURIComponent(term)}`)
        if (!res.ok || n !== seq.current) return
        setFound(await res.json())
        setActive(0)
      } catch {
        // Try again on the next keystroke
      }
    }, 200)
    return () => clearTimeout(t)
  }, [term, searching])

  return (
    <div className="cmp-jobsearch">
      <input
        autoFocus
        placeholder="Job number, claim, insured or address"
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
          if (hits.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); onPick(hits[active]) }
        }}
      />
      <button className="cmp-link" onClick={onCancel}>Cancel</button>
      {hits.length > 0 && (
        <div className="cmp-suggest cmp-jobhits">
          {hits.map((h, i) => (
            <button key={h.id} className={i === active ? 'on' : ''} onMouseDown={e => { e.preventDefault(); onPick(h) }}>
              <strong>{h.job_number}{h.insured_name ? ` · ${h.insured_name}` : ''}</strong>
              <span>{[h.property_address, h.claim_number && `Claim ${h.claim_number}`].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type JobDocument = JobPanel['documents'][number]

function JobFilesPicker({ jobId, documents, onDocument, onFile, onClose }: {
  jobId: string
  documents: JobDocument[]
  onDocument(d: JobDocument): void
  onFile(source: JobFileSource, id: string, name: string, size: number | null): void
  onClose(): void
}) {
  const [data, setData] = useState<JobAttachables | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'photos' | 'files' | 'documents'>('photos')
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch(`/api/mail/jobs/${jobId}/files`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: JobAttachables) => {
        if (cancelled) return
        setData(d)
        setTab(d.photos.length ? 'photos' : d.files.length ? 'files' : 'documents')
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [jobId])

  function toggle(id: string) {
    setChosen(c => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function attachChosen() {
    if (!data) return
    for (const p of data.photos) if (chosen.has(p.id)) onFile('photo', p.id, p.name, p.size)
    setChosen(new Set())
    onClose()
  }

  const counts = { photos: data?.photos.length ?? 0, files: data?.files.length ?? 0, documents: documents.length }

  return (
    <div className="cmp-picker">
      <div className="cmp-picker-tabs">
        {(['photos', 'files', 'documents'] as const).map(t => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'photos' ? 'Photos' : t === 'files' ? 'Files' : 'Documents'} <span>{counts[t]}</span>
          </button>
        ))}
        <button className="cmp-picker-close" title="Close" onClick={onClose}>✕</button>
      </div>

      {failed && <div className="cmp-picker-empty">Couldn&apos;t load the job&apos;s files.</div>}
      {!failed && !data && <div className="cmp-picker-empty">Loading…</div>}

      {data && tab === 'photos' && (
        data.photos.length === 0 ? <div className="cmp-picker-empty">No photos on this job yet.</div> : (
          <>
            <div className="cmp-photos">
              {data.photos.map(p => (
                <button key={p.id} className={`cmp-photo${chosen.has(p.id) ? ' on' : ''}`} title={p.label ?? p.name} onClick={() => toggle(p.id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, shown small */}
                  {p.thumbUrl ? <img src={p.thumbUrl} alt={p.label ?? p.name} loading="lazy" /> : <span>{p.name}</span>}
                  {chosen.has(p.id) && <i>✓</i>}
                </button>
              ))}
            </div>
            <div className="cmp-picker-foot">
              <button className="cmp-link" onClick={() => setChosen(chosen.size === data.photos.length ? new Set() : new Set(data.photos.map(p => p.id)))}>
                {chosen.size === data.photos.length ? 'Clear' : 'Select all'}
              </button>
              <button className="cmp-send" disabled={chosen.size === 0} onClick={attachChosen}>
                Attach {chosen.size || ''} photo{chosen.size === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )
      )}

      {data && tab === 'files' && (
        data.files.length === 0 ? <div className="cmp-picker-empty">No files uploaded to this job yet.</div> : (
          <div className="cmp-picker-list">
            {data.files.map(f => (
              <button key={f.id} onClick={() => onFile('file', f.id, f.name, f.size)}>
                <span>📄 {f.name}{f.description ? <em> — {f.description}</em> : null}</span>
                <span className="cmp-file-size">{formatSize(f.size)}</span>
              </button>
            ))}
          </div>
        )
      )}

      {data && tab === 'documents' && (
        documents.length === 0 ? <div className="cmp-picker-empty">No quotes, reports or invoices on this job yet.</div> : (
          <div className="cmp-picker-list">
            {documents.map((d, i) => (
              <button key={i} onClick={() => onDocument(d)}><span>📑 {d.title}</span><span className="cmp-file-size">PDF</span></button>
            ))}
          </div>
        )
      )}
    </div>
  )
}

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
  .cmp-job { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 0.5px solid var(--line-faint); background: var(--surface-3); }
  .cmp-job-chip { font-size: 12px; font-weight: 700; color: var(--teal); background: var(--success-bg-2); border: 0.5px solid #cfe5d8; border-radius: 10px; padding: 1px 8px; }
  .cmp-job-add { font: inherit; font-size: 12px; color: var(--body); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 10px; padding: 1px 8px; cursor: pointer; }
  .cmp-job-add:hover { border-color: var(--gold); }
  .cmp-job-chip button { background: none; border: none; color: var(--teal); font-size: 10px; cursor: pointer; padding: 0 0 0 5px; opacity: .7; }
  .cmp-job-chip button:hover { opacity: 1; }
  .cmp-job-attach { font: inherit; font-size: 12px; color: var(--body); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 10px; padding: 1px 8px; cursor: pointer; margin-left: auto; }
  .cmp-job-attach:hover, .cmp-job-attach.on { border-color: var(--gold); }
  .cmp-jobsearch { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; }
  .cmp-jobsearch input { flex: 1; min-width: 0; font: inherit; font-size: 13px; border: 0.5px solid var(--line-strong); border-radius: 6px; padding: 4px 8px; background: var(--paper); color: var(--ink); outline: none; }
  .cmp-jobhits { left: 0; }
  .cmp-picker { border-bottom: 0.5px solid var(--line-faint); background: var(--surface-3); padding: 0 14px 10px; }
  .cmp-picker-tabs { display: flex; align-items: center; gap: 4px; padding: 6px 0; }
  .cmp-picker-tabs button { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; border-radius: 10px; padding: 3px 10px; cursor: pointer; }
  .cmp-picker-tabs button span { color: var(--subtle); }
  .cmp-picker-tabs button.on { background: var(--paper); color: var(--ink); box-shadow: 0 0 0 0.5px var(--line-strong); }
  .cmp-picker-tabs .cmp-picker-close { margin-left: auto; font-size: 11px; }
  .cmp-picker-empty { font-size: 13px; color: var(--subtle); padding: 10px 0; }
  .cmp-photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; max-height: 240px; overflow-y: auto; }
  .cmp-photo { position: relative; aspect-ratio: 1; padding: 0; border: 2px solid transparent; border-radius: 6px; overflow: hidden; background: var(--surface-2); cursor: pointer; font-size: 10px; color: var(--subtle); }
  .cmp-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cmp-photo.on { border-color: var(--gold); }
  .cmp-photo i { position: absolute; top: 4px; right: 4px; font-style: normal; font-size: 11px; color: var(--cream); background: var(--ink); border-radius: 50%; width: 18px; height: 18px; line-height: 18px; text-align: center; }
  .cmp-picker-foot { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; }
  .cmp-picker-foot .cmp-send { font-size: 13px; padding: 6px 16px; }
  .cmp-picker-list { display: flex; flex-direction: column; max-height: 240px; overflow-y: auto; }
  .cmp-picker-list button { display: flex; justify-content: space-between; gap: 12px; font: inherit; font-size: 13px; text-align: left; color: var(--ink); background: none; border: none; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
  .cmp-picker-list button:hover { background: var(--paper); }
  .cmp-picker-list em { color: var(--subtle); font-style: normal; }
  .cmp-sig-preview { margin: 0 14px 4px; padding: 8px 0 0; border-top: 0.5px dashed var(--line); opacity: .85; }
  .cmp-sig-preview img { max-width: 100%; height: auto; }
  .cmp-sig-none { margin: 0 14px 4px; font-size: 12px; color: var(--subtle); }
  .cmp-sig-none a { color: var(--grey-600); }
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
  .cmp-send-group { position: relative; display: inline-flex; }
  .cmp-send-group > .cmp-send { border-radius: 18px 0 0 18px; padding-right: 16px; }
  .cmp-send-more { font-size: 11px; color: var(--cream); background: var(--ink); border: none; border-left: 1px solid rgba(255,255,255,.25); border-radius: 0 18px 18px 0; padding: 0 12px; cursor: pointer; }
  .cmp-send-more:hover { background: var(--ink-hover); }
  .cmp-sched { position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 6; min-width: 280px; background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18); padding: 6px 0; }
  .cmp-sched-title { font-size: 12px; font-weight: 600; color: var(--ink); padding: 6px 14px 8px; }
  .cmp-sched-title span { font-weight: 400; color: var(--subtle); }
  .cmp-sched > button { display: flex; justify-content: space-between; gap: 16px; width: 100%; font: inherit; font-size: 13px; text-align: left; background: none; border: none; padding: 8px 14px; cursor: pointer; color: var(--ink); }
  .cmp-sched > button:hover { background: var(--surface-2); }
  .cmp-sched-when { color: var(--subtle); }
  .cmp-sched-pick { display: flex; flex-direction: column; gap: 10px; padding: 4px 14px 8px; }
  .cmp-sched-pick input { font: inherit; font-size: 13px; padding: 6px 8px; border: 0.5px solid var(--line-strong); border-radius: 6px; }
  .cmp-sched-pick div { display: flex; justify-content: space-between; align-items: center; }
  .cmp-icon { font-size: 15px; background: none; border: none; cursor: pointer; padding: 4px; border-radius: 50%; opacity: .75; }
  .cmp-icon:hover { opacity: 1; background: var(--surface-2); }
  .cmp-icon:last-child { margin-left: auto; }
  .cmp-sig { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--grey-600); cursor: pointer; }
  .cmp-status { font-size: 12px; color: var(--subtle); }
`
