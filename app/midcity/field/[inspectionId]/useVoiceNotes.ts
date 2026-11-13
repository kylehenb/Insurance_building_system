'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceSection } from '@/lib/audio/voice-timeline'
import { deleteChunks, deleteSection, listChunks, listSections, putChunk, putSection, type StoredSection } from './voice-store'

// Bindi Co's voice notes: Record, talk, Pause, as many times as wanted through
// the visit. Each stretch is one section:
//   recording: the audio is saved on the phone every few seconds (voice-store.ts)
//   paused:    the section is sent to be turned into text (/api/midcity/voice),
//              and its text and timing handed to the app (onSection) to add to the notes
// A long stretch is cut into 3 minute sections as it goes, so text keeps arriving.
// Locking the phone or leaving Safari stops the microphone (iOS doesn't let a web
// page record in the background): the section so far is kept, and on coming back
// recording starts again by itself (autoResume), or with one tap if Safari asks.
// Sections cut off by a reload are picked up from the phone and sent on the next load.

export type VoiceStatus = 'idle' | 'starting' | 'recording' | 'needs-tap' | 'unsupported' | 'denied'

const SLICE_MS = 4000
const ROLL_MS = 3 * 60 * 1000
const RETRY_MS = [3000, 10000, 30000, 60000]
const AUTO_RESUME_KEY = 'bindi-voice-auto-resume'

function newSectionId() {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    try { if (MediaRecorder.isTypeSupported(t)) return t } catch { /* next */ }
  }
  return ''
}

const readAutoResume = (): boolean => {
  try { return localStorage.getItem(AUTO_RESUME_KEY) !== 'off' } catch { return true }
}

export function useVoiceNotes({ inspectionId, enabled, onSection }: {
  inspectionId: string
  /** Start sending saved sections once the app has its draft (so it knows which are already in the notes) */
  enabled: boolean
  /** A section's text and timing, once it's back; called again for the same section after a reload, so dedupe by id */
  onSection: (section: VoiceSection) => void
}) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [waiting, setWaiting] = useState(0)
  const [failed, setFailed] = useState(0)
  const [autoResume, setAutoResumeState] = useState(true)
  useEffect(() => { setAutoResumeState(readAutoResume()) }, [])

  const onSectionRef = useRef(onSection)
  useEffect(() => { onSectionRef.current = onSection })
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; section: StoredSection; n: number; writes: Promise<unknown>[]; roll: ReturnType<typeof setTimeout> | null } | null>(null)
  const keepGoing = useRef(false) // a roll: start the next section as this one stops
  const resumeOnReturn = useRef(false)
  const sending = useRef(false)
  const tries = useRef(new Map<string, number>())
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Send saved sections, oldest first, one at a time ──────────────────────
  const sendSaved = useCallback(async () => {
    if (sending.current || !enabled) return
    sending.current = true
    try {
      for (;;) {
        const all = await listSections(inspectionId)
        // Already turned into text: hand over again (the app ignores ones it has)
        for (const s of all.filter(x => x.status === 'done')) {
          onSectionRef.current({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt ?? s.startedAt, text: s.text ?? '', parts: s.parts ?? [] })
        }
        const live = rec.current?.section.id
        const todo = all.filter(x => x.status === 'saved' && x.id !== live)
        setWaiting(todo.length)
        const next = todo.find(x => (tries.current.get(x.id) ?? 0) === 0 || navigator.onLine)
        if (!next) break
        const blobs = await listChunks(next.id)
        if (!blobs.length) { await deleteSection(next.id); continue }
        const audio = new Blob(blobs, { type: next.mime.split(';')[0] || 'audio/mp4' })
        try {
          const fd = new FormData()
          fd.append('inspectionId', inspectionId)
          fd.append('sectionId', next.id)
          fd.append('audio', audio, `${next.id}.${audio.type.includes('webm') ? 'webm' : 'm4a'}`)
          const res = await fetch('/api/midcity/voice', { method: 'POST', body: fd })
          if (!res.ok) throw new Error(`voice ${res.status}`)
          const data = await res.json() as { text?: string; parts?: StoredSection['parts'] }
          const done: StoredSection = { ...next, status: 'done', text: data.text ?? '', parts: data.parts ?? [] }
          await putSection(done)
          await deleteChunks(next.id)
          tries.current.delete(next.id)
          onSectionRef.current({ id: done.id, startedAt: done.startedAt, endedAt: done.endedAt ?? done.startedAt, text: done.text ?? '', parts: done.parts ?? [] })
        } catch {
          const n = (tries.current.get(next.id) ?? 0) + 1
          tries.current.set(next.id, n)
          setFailed(f => f + 1)
          if (retryTimer.current) clearTimeout(retryTimer.current)
          retryTimer.current = setTimeout(() => { setFailed(0); void sendSaved() }, RETRY_MS[Math.min(n - 1, RETRY_MS.length - 1)])
          break
        }
      }
      setWaiting((await listSections(inspectionId)).filter(x => x.status === 'saved' && x.id !== rec.current?.section.id).length)
    } finally {
      sending.current = false
    }
  }, [enabled, inspectionId])

  // ── Sections cut off (reload, crash): close them with the audio saved so far ─
  const recoverCutOff = useCallback(async () => {
    const live = rec.current?.section.id
    for (const s of await listSections(inspectionId)) {
      if (s.status !== 'recording' || s.id === live) continue
      const pieces = (await listChunks(s.id)).length
      await putSection({ ...s, status: 'saved', endedAt: s.endedAt ?? s.startedAt + pieces * SLICE_MS })
    }
  }, [inspectionId])

  useEffect(() => {
    if (!enabled) return
    void recoverCutOff().then(sendSaved)
    const online = () => { void sendSaved() }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [enabled, recoverCutOff, sendSaved])

  // ── Record ─────────────────────────────────────────────────────────────────
  const begin = useCallback(async (tapped = false): Promise<boolean> => {
    if (rec.current) return true
    const mime = pickMime()
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setStatus('unsupported'); return false }
    setStatus('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      // Refused: by the inspector when they tapped, or by Safari wanting a tap when it started by itself
      const refused = (err as DOMException)?.name === 'NotAllowedError'
      setStatus(refused ? (tapped ? 'denied' : 'needs-tap') : 'idle')
      return false
    }
    const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 })
    const section: StoredSection = { id: newSectionId(), inspectionId, startedAt: Date.now(), endedAt: null, mime: recorder.mimeType || mime || 'audio/mp4', status: 'recording' }
    await putSection(section)
    const r = { recorder, stream, section, n: 0, writes: [] as Promise<unknown>[], roll: null as ReturnType<typeof setTimeout> | null }
    rec.current = r
    recorder.ondataavailable = e => { if (e.data?.size) r.writes.push(putChunk(section.id, r.n++, e.data)) }
    recorder.onstop = async () => {
      if (r.roll) clearTimeout(r.roll)
      r.stream.getTracks().forEach(t => t.stop())
      await Promise.all(r.writes)
      await putSection({ ...section, endedAt: Date.now(), status: 'saved' })
      if (rec.current === r) rec.current = null
      if (keepGoing.current) {
        keepGoing.current = false
        void begin()
      } else {
        setStatus(s => (s === 'recording' || s === 'starting' ? 'idle' : s))
        setStartedAt(null)
      }
      void sendSaved()
    }
    recorder.start(SLICE_MS)
    // Long stretches go in 3 minute sections, so text keeps coming back
    r.roll = setTimeout(() => { if (rec.current === r) { keepGoing.current = true; recorder.stop() } }, ROLL_MS)
    setStartedAt(prev => prev ?? section.startedAt)
    setStatus('recording')
    return true
  }, [inspectionId, sendSaved])

  const stop = useCallback(() => {
    keepGoing.current = false
    const r = rec.current
    if (!r) { setStatus(s => (s === 'needs-tap' ? 'idle' : s)); return }
    try { r.recorder.requestData() } catch { /* not all browsers */ }
    try { r.recorder.stop() } catch { /* already stopped */ }
  }, [])

  const record = useCallback(() => { resumeOnReturn.current = false; void begin(true) }, [begin])
  const pause = useCallback(() => { resumeOnReturn.current = false; stop() }, [stop])

  // ── Leaving Safari or locking the phone: keep what's said, carry on after ──
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (rec.current) { resumeOnReturn.current = true; stop() }
      } else {
        void recoverCutOff().then(sendSaved)
        if (resumeOnReturn.current) {
          resumeOnReturn.current = false
          if (readAutoResume()) {
            void begin().then(ok => { if (!ok) setStatus('needs-tap') })
          } else {
            setStatus('needs-tap')
          }
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [begin, stop, recoverCutOff, sendSaved])

  useEffect(() => () => {
    keepGoing.current = false
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const r = rec.current
    if (r) { try { r.recorder.stop() } catch { /* gone */ } }
  }, [])

  const setAutoResume = useCallback((on: boolean) => {
    setAutoResumeState(on)
    try { localStorage.setItem(AUTO_RESUME_KEY, on ? 'on' : 'off') } catch { /* this phone only */ }
  }, [])

  return { status, recording: status === 'recording', startedAt, waiting, failed, autoResume, setAutoResume, record, pause }
}
