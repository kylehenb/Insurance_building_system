'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { ExtraFileRef } from '@/lib/email/extra-files'
import type { JobAttachables } from '@/lib/mail/job-files'

// More files for a document or work order email in Customise send: files from
// the computer (uploaded straight to storage, as the Mail page does) and the
// job's own files and photos (Files and Photos tabs). The dialog sends
// extraFileRefs(files) with the email; the server reads them when it sends.

export interface ExtraFile {
  key: string
  ref: ExtraFileRef
  filename: string
  size: number | null
}

export const extraFileRefs = (files: ExtraFile[]): ExtraFileRef[] => files.map(f => f.ref)

const BUCKET = 'mail-attachments'
const MAX_FILE_BYTES = 25 * 1024 * 1024

type Uploading = { id: string; filename: string; error?: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: '#1a1a1a',
  padding: '4px 4px 4px 8px',
  border: '1px solid #ddd8d0',
  borderRadius: 5,
  background: '#faf9f7',
  maxWidth: '100%',
}
const smallBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 11,
  padding: '4px 8px',
  border: '1px solid #ddd8d0',
  borderRadius: 5,
  background: '#fff',
  color: '#5a5650',
  cursor: 'pointer',
}
const removeBtn: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: '#9a9590', display: 'flex', padding: 0 }

export function ExtraAttachments({ jobId, files, onChange, disabled, onUploadingChange }: {
  /** The email's job: its files and photos are offered */
  jobId: string | null
  files: ExtraFile[]
  onChange(files: ExtraFile[]): void
  disabled?: boolean
  /** True while a file from the computer is still uploading (hold the Send) */
  onUploadingChange?(uploading: boolean): void
}) {
  const [uploading, setUploading] = useState<Uploading[]>([])
  const [picker, setPicker] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Uploads finish one after another; each adds to the list as it is then
  const filesRef = useRef(files)
  filesRef.current = files

  const busy = uploading.some(u => !u.error)
  useEffect(() => { onUploadingChange?.(busy) }, [busy, onUploadingChange])

  function add(more: ExtraFile[]) {
    const have = new Set(filesRef.current.map(f => f.key))
    const next = [...filesRef.current, ...more.filter(f => !have.has(f.key))]
    filesRef.current = next
    onChange(next)
  }

  async function upload(list: FileList | File[]) {
    const supabase = createClient()
    for (const file of Array.from(list)) {
      const id = crypto.randomUUID()
      if (file.size > MAX_FILE_BYTES) {
        setUploading(u => [...u, { id, filename: file.name, error: 'Over the 25 MB email limit' }])
        continue
      }
      setUploading(u => [...u, { id, filename: file.name }])
      try {
        const res = await fetch('/api/email-attachments/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, size: file.size }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Upload failed')
        const mimeType = file.type || 'application/octet-stream'
        const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(body.path, body.token, file, { contentType: mimeType })
        if (error) throw new Error(error.message)
        add([{ key: `upload:${body.path}`, ref: { source: 'upload', path: body.path, filename: file.name, mimeType }, filename: file.name, size: file.size }])
        setUploading(u => u.filter(x => x.id !== id))
      } catch (err) {
        setUploading(u => u.map(x => (x.id === id ? { ...x, error: err instanceof Error ? err.message : 'Upload failed' } : x)))
      }
    }
  }

  const total = files.reduce((n, f) => n + (f.size ?? 0), 0)

  return (
    <div
      onDragOver={e => { if (!disabled && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        setDragOver(false)
        if (disabled || !e.dataTransfer.files.length) return
        e.preventDefault()
        upload(e.dataTransfer.files)
      }}
      style={{
        border: `1px dashed ${dragOver ? '#1e40af' : 'transparent'}`,
        borderRadius: 6,
        background: dragOver ? '#eff6ff' : 'transparent',
        margin: -4,
        padding: 4,
      }}
    >
      {(files.length > 0 || uploading.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {files.map(f => (
            <span key={f.key} style={chip} title={f.filename}>
              {f.ref.source === 'photo' ? <ImageIcon size={12} /> : <Paperclip size={12} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
              {f.size != null && <span style={{ color: '#9a9590', flexShrink: 0 }}>{formatSize(f.size)}</span>}
              <button onClick={() => onChange(files.filter(x => x.key !== f.key))} disabled={disabled} title="Remove" style={removeBtn}>
                <X size={12} />
              </button>
            </span>
          ))}
          {uploading.map(u => (
            <span key={u.id} style={{ ...chip, ...(u.error ? { color: '#991b1b', borderColor: '#fca5a5', background: '#fee2e2' } : { color: '#9a9590' }) }}>
              <Upload size={12} />
              {u.error ? `${u.filename}: ${u.error}` : `Uploading ${u.filename}…`}
              {u.error && (
                <button onClick={() => setUploading(x => x.filter(y => y.id !== u.id))} title="Dismiss" style={removeBtn}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled} style={smallBtn} title="Attach files from your computer (or drop them here)">
          <Upload size={12} /> From computer
        </button>
        {jobId && (
          <button type="button" onClick={() => setPicker(p => !p)} disabled={disabled}
            style={{ ...smallBtn, ...(picker ? { borderColor: '#1e40af', color: '#1e40af' } : {}) }}
            title="Attach files and photos stored on this job">
            <FolderOpen size={12} /> From job files
          </button>
        )}
        {total > 0 && <span style={{ fontSize: 10, color: '#9a9590' }}>Extra files: {formatSize(total)}</span>}
        <input ref={fileRef} type="file" multiple hidden onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
      </div>

      {picker && jobId && (
        <JobFilesPanel
          jobId={jobId}
          chosen={new Set(files.map(f => f.key))}
          onAdd={add}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}

function JobFilesPanel({ jobId, chosen, onAdd, onClose }: {
  jobId: string
  /** Keys already on the email */
  chosen: Set<string>
  onAdd(files: ExtraFile[]): void
  onClose(): void
}) {
  const [data, setData] = useState<JobAttachables | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'files' | 'photos'>('files')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch(`/api/email-attachments/job/${jobId}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: JobAttachables) => {
        if (cancelled) return
        setData(d)
        setTab(d.files.length || !d.photos.length ? 'files' : 'photos')
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [jobId])

  const photos = (data?.photos ?? []).filter(p => !chosen.has(`photo:${p.id}`))
  function togglePhoto(id: string) {
    setPicked(c => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function addPhotos() {
    onAdd(photos.filter(p => picked.has(p.id)).map(p => ({ key: `photo:${p.id}`, ref: { source: 'photo', id: p.id }, filename: p.name, size: p.size })))
    setPicked(new Set())
  }

  const tabBtn = (on: boolean): React.CSSProperties => ({
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 11,
    fontWeight: on ? 600 : 500,
    padding: '6px 10px',
    border: 'none',
    borderBottom: `2px solid ${on ? '#1e40af' : 'transparent'}`,
    background: 'transparent',
    color: on ? '#1e40af' : '#5a5650',
    cursor: 'pointer',
  })
  const empty: React.CSSProperties = { fontSize: 11, color: '#9a9590', padding: '14px 10px' }

  return (
    <div style={{ marginTop: 8, border: '1px solid #ddd8d0', borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e8e4de', background: '#faf9f7' }}>
        <button type="button" style={tabBtn(tab === 'files')} onClick={() => setTab('files')}>Files {data ? `(${data.files.length})` : ''}</button>
        <button type="button" style={tabBtn(tab === 'photos')} onClick={() => setTab('photos')}>Photos {data ? `(${data.photos.length})` : ''}</button>
        <button type="button" onClick={onClose} title="Close" style={{ ...removeBtn, marginLeft: 'auto', padding: '0 10px' }}><X size={13} /></button>
      </div>

      {failed && <div style={empty}>Couldn&apos;t load the job&apos;s files.</div>}
      {!failed && !data && <div style={empty}>Loading…</div>}

      {data && tab === 'files' && (
        data.files.length === 0 ? <div style={empty}>No files uploaded to this job yet (Files tab).</div> : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {data.files.map(f => {
              const added = chosen.has(`file:${f.id}`)
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={added}
                  onClick={() => onAdd([{ key: `file:${f.id}`, ref: { source: 'file', id: f.id }, filename: f.name, size: f.size }])}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    fontFamily: 'DM Sans, sans-serif', fontSize: 11, padding: '7px 10px',
                    border: 'none', borderBottom: '1px solid #f0ece6', background: 'transparent',
                    color: added ? '#9a9590' : '#1a1a1a', cursor: added ? 'default' : 'pointer',
                  }}
                  onMouseEnter={e => { if (!added) e.currentTarget.style.background = '#eff6ff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {added ? <Check size={12} /> : <Paperclip size={12} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}{f.description ? <span style={{ color: '#9a9590' }}> — {f.description}</span> : null}
                  </span>
                  <span style={{ color: '#9a9590', flexShrink: 0 }}>{added ? 'Added' : formatSize(f.size)}</span>
                </button>
              )
            })}
          </div>
        )
      )}

      {data && tab === 'photos' && (
        data.photos.length === 0 ? <div style={empty}>No photos on this job yet.</div>
        : photos.length === 0 ? <div style={empty}>All of the job&apos;s photos are attached.</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6, padding: 8, maxHeight: 220, overflowY: 'auto' }}>
              {photos.map(p => {
                const on = picked.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label ?? p.name}
                    onClick={() => togglePhoto(p.id)}
                    style={{
                      position: 'relative', aspectRatio: '1', padding: 0, overflow: 'hidden',
                      border: `2px solid ${on ? '#1e40af' : '#e8e4de'}`, borderRadius: 5,
                      background: '#faf9f7', cursor: 'pointer', fontSize: 9, color: '#5a5650',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, shown small */}
                    {p.thumbUrl ? <img src={p.thumbUrl} alt={p.label ?? p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span>{p.name}</span>}
                    {on && (
                      <span style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: 8, background: '#1e40af', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={10} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderTop: '1px solid #e8e4de' }}>
              <button type="button" style={{ ...smallBtn, border: 'none', padding: '4px 0' }}
                onClick={() => setPicked(picked.size === photos.length ? new Set() : new Set(photos.map(p => p.id)))}>
                {picked.size === photos.length ? 'Clear' : 'Select all'}
              </button>
              <button type="button" disabled={picked.size === 0} onClick={addPhotos}
                style={{ ...smallBtn, background: '#1e40af', borderColor: '#1e40af', color: '#fff', opacity: picked.size ? 1 : 0.45, cursor: picked.size ? 'pointer' : 'default' }}>
                Attach {picked.size || ''} photo{picked.size === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )
      )}
    </div>
  )
}
