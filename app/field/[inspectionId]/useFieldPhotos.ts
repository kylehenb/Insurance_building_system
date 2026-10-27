'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyAiLabels, MUD_MAP_LABEL, photoKindOfLabel, VIEW_OF_PROPERTY_LABEL, type AiPhotoLabel } from '@/lib/photos/report-order'
import { processPhoto } from './photo-convert'
import { clearInspection, deletePhoto, listPhotos, patchPhoto, putPhoto, type LabelSource } from './photo-store'

// The field app's inspection photos, from picking to uploaded:
//   waiting → converting (2 at a time, so Safari doesn't run out of memory)
//   → saved on the phone (IndexedDB) → uploading (3 at a time) → uploaded.
// The server labels uploaded photos itself (lib/photos/server-labels.ts), so
// once everything is uploaded the inspector can leave. Coming back — even
// after iOS reloaded the page — picks up where it left off: saved photos come
// back from the phone, uploaded ones from the server, and the AI labels are
// fetched while any are outstanding. The inspector's own labels always win.

export type PhotoStatus = 'waiting' | 'converting' | 'queued' | 'uploading' | 'uploaded' | 'failed'

export interface FieldPhoto {
  id: string
  order: number
  /** The picked photo, until it's converted */
  original: File | null
  /** The converted JPEG, until it's uploaded */
  file: File | null
  previewUrl: string | null
  label: string
  labelSource: LabelSource
  status: PhotoStatus
  serverId: string | null
  ai: AiPhotoLabel | null
  aiStatus: string | null
  attempts: number
}

const CONVERT_AT_ONCE = 2
const UPLOAD_AT_ONCE = 3
const POLL_MS = 5000
const RETRY_MS = [2000, 5000, 15000, 30000]

function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Labels for the photos the AI owns: one View of Property, the mud maps, the rest as the AI said. */
function withAiLabels(list: FieldPhoto[]): FieldPhoto[] {
  const keep = (i: number) => list[i].labelSource === 'inspector' || !list[i].ai
  const labels = applyAiLabels(list.map(p => p.label), list.map(p => p.ai), { keep })
  return list.map((p, i) => (keep(i) || p.label === labels[i] ? p : { ...p, label: labels[i], labelSource: 'ai' }))
}

interface ServerPhoto {
  id: string
  url: string | null
  label: string
  clientId: string | null
  sequenceNumber: number | null
  ai: AiPhotoLabel | null
  aiStatus: string | null
}

export function useFieldPhotos({ base, inspectionId, active }: { base: string; inspectionId: string; active: boolean }) {
  const [photos, setPhotos] = useState<FieldPhoto[]>([])
  const [restored, setRestored] = useState(false)
  const [online, setOnline] = useState(true)
  const [visible, setVisible] = useState(true)
  const [tick, setTick] = useState(0) // re-runs the queue after a retry delay
  const photosRef = useRef(photos)
  photosRef.current = photos
  const converting = useRef(new Set<string>())
  const uploading = useRef(new Set<string>())
  const removed = useRef(new Set<string>())
  const retryAt = useRef(new Map<string, number>())
  const nextOrder = useRef(0)
  const flushedFor = useRef('')
  const lastFlush = useRef(0)

  const update = useCallback((id: string, patch: Partial<FieldPhoto> | ((p: FieldPhoto) => Partial<FieldPhoto>)) => {
    setPhotos(prev => prev.map(p => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)))
  }, [])

  // ── Restore: saved on this phone + already on the server ───────────────────
  useEffect(() => {
    if (!active) { setRestored(true); return }
    let cancelled = false
    ;(async () => {
      const [stored, server] = await Promise.all([
        listPhotos(inspectionId),
        fetch(`${base}/photos?pending=1`).then(r => (r.ok ? r.json() : { photos: [] })).then(d => (d.photos ?? []) as ServerPhoto[]).catch(() => [] as ServerPhoto[]),
      ])
      if (cancelled) return
      const byClient = new Map(server.filter(s => s.clientId).map(s => [s.clientId!, s]))
      const list: FieldPhoto[] = stored.map(s => {
        const row = byClient.get(s.id)
        byClient.delete(s.id)
        const uploaded = s.uploaded || !!row
        return {
          id: s.id, order: s.order, original: null,
          file: !uploaded && s.file ? new File([s.file], s.name, { type: 'image/jpeg' }) : null,
          previewUrl: s.thumb ? URL.createObjectURL(s.thumb) : row?.url ?? null,
          label: s.label, labelSource: s.labelSource,
          status: uploaded ? 'uploaded' : s.file ? 'queued' : 'failed',
          serverId: row?.id ?? s.serverId, ai: row?.ai ?? null, aiStatus: row?.aiStatus ?? null, attempts: 0,
        }
      })
      // Uploaded from this inspection but not saved on this phone (another device, or storage was cleared)
      for (const row of byClient.values()) {
        list.push({
          id: row.clientId!, order: row.sequenceNumber ?? list.length, original: null, file: null, previewUrl: row.url,
          label: row.label, labelSource: row.label ? 'inspector' : 'none', status: 'uploaded',
          serverId: row.id, ai: row.ai, aiStatus: row.aiStatus, attempts: 0,
        })
      }
      list.sort((a, b) => a.order - b.order)
      nextOrder.current = list.reduce((m, p) => Math.max(m, p.order + 1), 0)
      setPhotos(prev => withAiLabels([...list, ...prev.filter(p => !list.some(l => l.id === p.id))]))
      setRestored(true)
    })()
    return () => { cancelled = true }
  }, [active, base, inspectionId])

  // ── Connection and visibility: the queue pauses while either is lost ───────
  useEffect(() => {
    const onOnline = () => setOnline(navigator.onLine)
    const onVisible = () => setVisible(document.visibilityState === 'visible')
    onOnline(); onVisible()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // ── Convert ────────────────────────────────────────────────────────────────
  const convert = useCallback(async (p: FieldPhoto) => {
    converting.current.add(p.id)
    update(p.id, { status: 'converting' })
    try {
      const { file, thumb } = await processPhoto(p.original!, { thumb: true })
      if (removed.current.has(p.id)) return
      await putPhoto({
        id: p.id, inspectionId, order: p.order, name: file.name, file, thumb,
        label: p.label, labelSource: p.labelSource, uploaded: false, serverId: null,
      })
      update(p.id, { status: 'queued', file, original: null, previewUrl: thumb ? URL.createObjectURL(thumb) : URL.createObjectURL(file) })
    } catch {
      update(p.id, { status: 'failed', original: null })
    } finally {
      converting.current.delete(p.id)
    }
  }, [inspectionId, update])

  // ── Upload ─────────────────────────────────────────────────────────────────
  const upload = useCallback(async (p: FieldPhoto) => {
    uploading.current.add(p.id)
    update(p.id, { status: 'uploading' })
    let permanent = false
    try {
      const fd = new FormData()
      fd.append('file', p.file!)
      fd.append('clientId', p.id)
      fd.append('sequenceNumber', String(p.order + 1))
      fd.append('label', p.labelSource === 'inspector' ? p.label : '')
      const res = await fetch(`${base}/photos`, { method: 'POST', body: fd })
      if (!res.ok) {
        permanent = res.status === 400 || res.status === 404 || res.status === 413
        throw new Error(`Upload failed (${res.status})`)
      }
      const data = await res.json()
      if (removed.current.has(p.id)) {
        fetch(`${base}/photos?photoId=${data.id}`, { method: 'DELETE' }).catch(() => {})
        return
      }
      retryAt.current.delete(p.id)
      await patchPhoto(p.id, { uploaded: true, serverId: data.id, file: null })
      update(p.id, { status: 'uploaded', serverId: data.id, file: null, aiStatus: 'pending' })
    } catch {
      const attempts = p.attempts + 1
      if (permanent) {
        update(p.id, { status: 'failed', attempts })
      } else {
        retryAt.current.set(p.id, Date.now() + RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)])
        update(p.id, { status: 'queued', attempts })
        setTimeout(() => setTick(t => t + 1), RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)] + 50)
      }
    } finally {
      uploading.current.delete(p.id)
    }
  }, [base, update])

  // ── The queue: start conversions and uploads as slots free up ──────────────
  useEffect(() => {
    if (!active) return
    for (const p of photos) {
      if (converting.current.size >= CONVERT_AT_ONCE) break
      if (p.status === 'waiting' && p.original && !converting.current.has(p.id)) convert(p)
    }
    if (!online || !visible || !restored) return
    const now = Date.now()
    for (const p of photos) {
      if (uploading.current.size >= UPLOAD_AT_ONCE) break
      if (p.status === 'queued' && p.file && !uploading.current.has(p.id) && (retryAt.current.get(p.id) ?? 0) <= now) upload(p)
    }
  }, [active, photos, online, visible, restored, tick, convert, upload])

  const busy = photos.some(p => p.status === 'waiting' || p.status === 'converting' || p.status === 'queued' || p.status === 'uploading')

  // ── Labels: ask the server to label the last few, then fetch until all are in ─
  const awaitingLabels = photos.some(p => p.status === 'uploaded' && (p.aiStatus === 'pending' || p.aiStatus === 'labelling'))

  useEffect(() => {
    if (!active || busy || !awaitingLabels) return
    // Once per drained queue: fewer than a full batch may be waiting
    const key = photos.filter(p => p.status === 'uploaded').map(p => p.id).join(',')
    if (flushedFor.current === key) return
    flushedFor.current = key
    lastFlush.current = Date.now()
    fetch(`${base}/ai-label`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
  }, [active, busy, awaitingLabels, photos, base])

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch(`${base}/photos?pending=1&labels=1`)
      if (!res.ok) return
      const rows = ((await res.json()).photos ?? []) as ServerPhoto[]
      // A batch that failed on the server goes back to waiting: ask again, at most once a minute
      if (rows.some(r => r.aiStatus === 'pending') && Date.now() - lastFlush.current > 60_000 &&
          !photosRef.current.some(p => p.status === 'queued' || p.status === 'uploading')) {
        lastFlush.current = Date.now()
        fetch(`${base}/ai-label`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
      }
      const byClient = new Map(rows.filter(r => r.clientId).map(r => [r.clientId!, r]))
      setPhotos(prev => withAiLabels(prev.map(p => {
        const row = byClient.get(p.id)
        if (!row || p.status !== 'uploaded') return p
        return { ...p, serverId: row.id, aiStatus: row.aiStatus, ai: row.ai ?? p.ai, previewUrl: p.previewUrl ?? row.url }
      })))
    } catch { /* next poll tries again */ }
  }, [base])

  useEffect(() => {
    if (!active || !visible || !awaitingLabels) return
    const timer = setInterval(fetchLabels, POLL_MS)
    return () => clearInterval(timer)
  }, [active, visible, awaitingLabels, fetchLabels])

  // Back in the app: catch up straight away
  useEffect(() => {
    if (active && visible && restored) fetchLabels()
  }, [active, visible, restored, fetchLabels])

  // ── Keep the screen awake while photos are being saved/uploaded ────────────
  useEffect(() => {
    if (!busy || !visible || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    return () => { lock?.release().catch(() => {}) }
  }, [busy, visible])

  // ── Actions ────────────────────────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const added: FieldPhoto[] = Array.from(files).map(original => ({
      id: newId(), order: nextOrder.current++, original, file: null, previewUrl: null,
      label: '', labelSource: 'none', status: 'waiting', serverId: null, ai: null, aiStatus: null, attempts: 0,
    }))
    setPhotos(prev => [...prev, ...added])
  }, [])

  const setLabel = useCallback((id: string, label: string) => {
    const labelSource: LabelSource = label.trim() ? 'inspector' : 'none'
    update(id, { label, labelSource })
    patchPhoto(id, { label, labelSource })
  }, [update])

  /** One-tap lead labels. Only one View of Property: tagging a new one clears the old; tapping again clears it. */
  const tagPhoto = useCallback((id: string, tag: typeof VIEW_OF_PROPERTY_LABEL | typeof MUD_MAP_LABEL) => {
    const kind = tag === VIEW_OF_PROPERTY_LABEL ? 'view_of_property' : 'mud_map'
    const changes: { id: string; label: string; labelSource: LabelSource }[] = []
    for (const p of photosRef.current) {
      if (p.id === id) {
        const on = photoKindOfLabel(p.label) === kind
        // Untagging keeps the AI's descriptive label as the inspector's, so the AI can't tag it straight back
        changes.push(on
          ? { id, label: p.ai?.label ?? '', labelSource: p.ai ? 'inspector' : 'none' }
          : { id, label: tag, labelSource: 'inspector' })
      } else if (kind === 'view_of_property' && photoKindOfLabel(p.label) === 'view_of_property') {
        // The old one goes back to the AI's descriptive label (withAiLabels below)
        changes.push({ id: p.id, label: '', labelSource: 'none' })
      }
    }
    setPhotos(prev => withAiLabels(prev.map(p => {
      const c = changes.find(x => x.id === p.id)
      return c ? { ...p, label: c.label, labelSource: c.labelSource } : p
    })))
    changes.forEach(c => patchPhoto(c.id, { label: c.label, labelSource: c.labelSource }))
  }, [])

  const remove = useCallback((id: string) => {
    const p = photosRef.current.find(x => x.id === id)
    if (!p) return
    removed.current.add(id)
    if (p.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl)
    if (p.serverId) fetch(`${base}/photos?photoId=${p.serverId}`, { method: 'DELETE' }).catch(() => {})
    deletePhoto(id)
    setPhotos(prev => prev.filter(x => x.id !== id))
  }, [base])

  const retryFailed = useCallback(() => {
    setPhotos(prev => prev.map(p => (p.status === 'failed' && p.file ? { ...p, status: 'queued', attempts: 0 } : p)))
    retryAt.current.clear()
  }, [])

  /** "AI Label All Photos": the server looks at every photo again, with the notes written so far. */
  const relabelAll = useCallback(async () => {
    flushedFor.current = ''
    const res = await fetch(`${base}/ai-label`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relabel: true }) })
    if (!res.ok) throw new Error('relabel failed')
    setPhotos(prev => prev.map(p => (p.status === 'uploaded' ? { ...p, aiStatus: 'pending' } : p)))
  }, [base])

  /** Resolves true once nothing is waiting to upload (false if some failed or it took too long). */
  const waitForUploads = useCallback(async (timeoutMs = 5 * 60 * 1000): Promise<boolean> => {
    const start = Date.now()
    for (;;) {
      const list = photosRef.current
      if (!list.some(p => ['waiting', 'converting', 'queued', 'uploading'].includes(p.status))) return !list.some(p => p.status === 'failed')
      if (Date.now() - start > timeoutMs) return false
      await new Promise(r => setTimeout(r, 400))
    }
  }, [])

  /** The photos in the phone's order with the inspector's labels, for submit. */
  const manifest = useCallback(() => photosRef.current
    .filter(p => p.status === 'uploaded')
    .map(p => ({ clientId: p.id, label: p.label, labelSource: p.labelSource })), [])

  const clearSaved = useCallback(() => clearInspection(inspectionId), [inspectionId])

  const counts = useMemo(() => ({
    total: photos.length,
    saved: photos.filter(p => p.status !== 'waiting' && p.status !== 'converting').length,
    uploaded: photos.filter(p => p.status === 'uploaded').length,
    failed: photos.filter(p => p.status === 'failed').length,
    labelled: photos.filter(p => p.status === 'uploaded' && (p.aiStatus === 'done' || p.aiStatus === 'failed' || p.labelSource === 'inspector')).length,
  }), [photos])

  return { photos, counts, busy, online, awaitingLabels, addFiles, setLabel, tagPhoto, remove, retryFailed, relabelAll, waitForUploads, manifest, clearSaved }
}
