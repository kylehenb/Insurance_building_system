'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceStatus } from './useVoiceNotes'

// The field app's own camera, for taking photos one after another like the
// Camera app: tap the shutter and it's ready for the next straight away, with
// no "Take Photo or Choose" prompt. Each photo goes to the uploader the moment
// it's taken (saved on the phone, then uploaded) with the time it was taken, so
// it can be lined up with the voice notes. The Record button here is the same
// one as in the notes. Locking the phone turns the camera off; it comes back by
// itself on unlock. Dark roof spaces are better with the iPhone's own camera
// (Add Photos), which has night mode and flash.

const PRINT_W = 1920
const PRINT_H = 1440

export function CameraScreen({ title, onCapture, onClose, voice }: {
  title: string
  onCapture: (file: File) => void
  onClose: () => void
  voice?: { status: VoiceStatus; startedAt: number | null; record: () => void; pause: () => void }
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<'starting' | 'live' | 'denied' | 'unsupported' | 'stopped'>('starting')
  const [taken, setTaken] = useState(0)
  const [lastThumb, setLastThumb] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return }
    stopCamera()
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: PRINT_W }, height: { ideal: PRINT_H } },
      })
      streamRef.current = stream
      const v = videoRef.current
      if (v) { v.srcObject = stream; await v.play().catch(() => {}) }
      setState('live')
    } catch (err) {
      setState((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'stopped')
    }
  }, [stopCamera])

  useEffect(() => {
    // Started just after mounting, so its state changes come after this effect, not during it
    const opening = setTimeout(() => { void startCamera() }, 0)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Locked or left: iOS turns the camera off. Back again: turn it back on.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { stopCamera(); setState('stopped') } else void startCamera()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(opening)
      document.removeEventListener('visibilitychange', onVisibility)
      document.body.style.overflow = prev
      stopCamera()
    }
  }, [startCamera, stopCamera])

  useEffect(() => () => { if (lastThumb) URL.revokeObjectURL(lastThumb) }, [lastThumb])

  // The recording clock
  useEffect(() => {
    if (voice?.status !== 'recording') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [voice?.status])

  const shoot = () => {
    const v = videoRef.current
    if (!v || state !== 'live' || !v.videoWidth) return
    const at = Date.now()
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    canvas.toBlob(blob => {
      if (!blob) return
      const stamp = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
      onCapture(new File([blob], `IMG_${stamp}.jpg`, { type: 'image/jpeg', lastModified: at }))
      setTaken(n => n + 1)
      setLastThumb(URL.createObjectURL(blob))
    }, 'image/jpeg', 0.9)
  }

  const recording = voice?.status === 'recording'
  const clock = recording && voice?.startedAt ? (() => {
    const s = Math.max(0, Math.floor((now - voice.startedAt) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })() : ''

  return (
    <div className="cam-screen" role="dialog" aria-label={title}>
      <div className="cam-top">
        <span>{title}{taken ? ` · ${taken} taken` : ''}</span>
        <button type="button" className="rp-viewer-close" onClick={onClose}>Done</button>
      </div>
      <div className="cam-view">
        <video ref={videoRef} className="cam-video" playsInline muted autoPlay />
        {flash && <div className="cam-flash" />}
        {state !== 'live' && (
          <div className="cam-msg">
            {state === 'starting' && 'Starting the camera…'}
            {state === 'stopped' && <button type="button" className="rp-chip rp-type" onClick={() => void startCamera()}>Turn the camera on</button>}
            {state === 'denied' && <>Safari isn&apos;t allowed to use the camera. Allow it for this site in Safari&apos;s settings (aA → Website Settings → Camera), or use Add Photos.</>}
            {state === 'unsupported' && <>This browser can&apos;t show the camera here. Use Add Photos instead.</>}
          </div>
        )}
        {recording && <div className="cam-rec" aria-live="polite">● REC {clock}</div>}
        {voice?.status === 'needs-tap' && <div className="cam-rec paused">Recording paused · tap Record to carry on</div>}
      </div>
      <div className="cam-bar">
        <div className="cam-side">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {lastThumb && <img src={lastThumb} alt="Last photo" className="cam-thumb" />}
        </div>
        <button type="button" className="cam-shutter" onClick={shoot} disabled={state !== 'live'} aria-label="Take photo" />
        <div className="cam-side">
          {voice && voice.status !== 'unsupported' && (
            <button type="button" className={`cam-mic${recording ? ' on' : ''}`} onClick={recording ? voice.pause : voice.record}
              aria-label={recording ? 'Pause recording' : 'Record'} disabled={voice.status === 'starting'}>
              {recording ? '❚❚' : '●'}
              <span>{recording ? 'Pause' : 'Record'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
