'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import TemplateSelectorField from '@/components/reports/TemplateSelectorField'

interface InitialData {
  inspectionId: string
  inspectionRef: string | null
  status: string
  scheduledDate: string | null
  scheduledTime: string | null
  jobId: string | null
  jobNumber: string | null
  address: string | null
  insuredName: string | null
  insurer: string | null
  lossType: string | null
  dateOfLoss: string | null
  claimNumber: string | null
  quoteId: string | null
  quoteRef: string | null
  reportId: string | null
  reportRef: string | null
  inspector: string | null
  inspectorId: string
  tenantId: string
  personMet: string | null
  fieldDraft: Record<string, unknown> | null
  safetyConfirmedAt: string | null
  formSubmittedAt: string | null
}

interface ScopeItem { id: string; text: string }
interface ScopeRoom { id: string; name: string; l: string; w: string; h: string; items: ScopeItem[] }
interface PhotoEntry { id: string; file: File; previewUrl: string; label: string; processing: boolean }

function uid() { return Math.random().toString(36).slice(2) }

// Convert any image (including HEIC) to a compressed JPEG ≤ TARGET_BYTES.
// Uses the canvas API — iOS Safari decodes HEIC natively, so no extra library needed.
async function processPhotoForUpload(file: File): Promise<File> {
  const TARGET_BYTES = 125 * 1024  // 125 KB ceiling
  const MAX_DIM = 1600             // 1600px max on longest side

  return new Promise(resolve => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objUrl)

      let w = img.naturalWidth
      let h = img.naturalHeight

      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = Math.min(MAX_DIM / w, MAX_DIM / h)
        w = Math.round(w * scale)
        h = Math.round(h * scale)
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      // Adaptive quality — steps down until ≤ TARGET_BYTES or hits 0.55 floor
      const compress = (quality: number) => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return }
          if (blob.size > TARGET_BYTES && quality > 0.55) {
            compress(Math.round((quality - 0.08) * 100) / 100)
            return
          }
          const baseName = file.name.replace(/\.(heic|heif)$/i, '')
          const jpegName = baseName.match(/\.(jpe?g)$/i) ? file.name : `${baseName}.jpg`
          resolve(new File([blob], jpegName, { type: 'image/jpeg', lastModified: Date.now() }))
        }, 'image/jpeg', quality)
      }

      compress(0.82)
    }

    img.onerror = () => {
      // Browser can't decode (e.g. Chrome with HEIC and no native support).
      // Fall through — the server will receive the raw file; upload will likely
      // fail the bucket mime-type check, but the user will see an error rather
      // than a silent hang. In practice this path is never hit on iOS Safari.
      URL.revokeObjectURL(objUrl)
      resolve(file)
    }

    img.src = objUrl
  })
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function FieldApp({ initialData }: { initialData: InitialData }) {
  const base = `/api/field/${initialData.inspectionId}`

  // ─── Safety ──────────────────────────────────────────────────────────────
  const [safetyDone, setSafetyDone] = useState(!!initialData.safetyConfirmedAt)
  const [commenceTime, setCommenceTime] = useState('')
  const [chips, setChips] = useState({ general: false, ppe: false, asbestos: false, structural: false, roofPower: false, weather: false })
  const [customSafetyNotes, setCustomSafetyNotes] = useState('')
  const [hospitalName, setHospitalName] = useState('')
  const [hasSig, setHasSig] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)

  // ─── Details ─────────────────────────────────────────────────────────────
  const [personMet, setPersonMet] = useState(initialData.personMet ?? initialData.insuredName ?? '')
  const [relation, setRelation] = useState('')
  const [propDesc, setPropDesc] = useState('')

  // ─── Scope ────────────────────────────────────────────────────────────────
  const [scopeRooms, setScopeRooms] = useState<ScopeRoom[]>([])

  // ─── Notes ────────────────────────────────────────────────────────────────
  const [raw_report_notes, setRawReportNotes] = useState('')

  // ─── Photos ───────────────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [photoContext, setPhotoContext] = useState('')
  const [aiLabeling, setAiLabeling] = useState(false)
  const [aiLabelDone, setAiLabelDone] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ─── Additional Reports ───────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<string | null>(null)
  // Make Safe
  const [msWorksCompleted, setMsWorksCompleted] = useState('')
  const [msTempFixes, setMsTempFixes] = useState('')
  const [msHours, setMsHours] = useState('')
  // Roof Report
  const [roofRawNotes, setRoofRawNotes] = useState('')
  const [roofPhotos, setRoofPhotos] = useState<PhotoEntry[]>([])
  const [roofPhotoContext, setRoofPhotoContext] = useState('')
  const [roofAiLabeling, setRoofAiLabeling] = useState(false)
  const [roofAiLabelDone, setRoofAiLabelDone] = useState(false)
  const roofPhotoInputRef = useRef<HTMLInputElement>(null)
  // Leak Detection
  const [ldMethod, setLdMethod] = useState('')
  const [ldSource, setLdSource] = useState('')
  const [ldLocation, setLdLocation] = useState('')
  const [ldReadings, setLdReadings] = useState(['', '', ''])
  const [ldFindings, setLdFindings] = useState('')
  // Restoration
  const [restType, setRestType] = useState('')
  const [restExtent, setRestExtent] = useState('')
  const [restRooms, setRestRooms] = useState('')
  const [restEquip, setRestEquip] = useState<Record<string, boolean>>({ dehumidifiers: false, airMovers: false, airScrubbers: false, dryingMats: false })
  const [restNotes, setRestNotes] = useState('')
  // External Trades
  const [extTrades, setExtTrades] = useState<Record<string, boolean>>({})
  const [extTradeNotes, setExtTradeNotes] = useState<Record<string, string>>({})

  // ─── Damage Templates ────────────────────────────────────────────────────
  const [damageTemplate, setDamageTemplate] = useState<string | null>(null)
  const [damageTemplateSaved, setDamageTemplateSaved] = useState(true)
  const [isNewDamageTemplate, setIsNewDamageTemplate] = useState(false)
  const [roofDamageTemplate, setRoofDamageTemplate] = useState<string | null>(null)
  const [roofDamageTemplateSaved, setRoofDamageTemplateSaved] = useState(true)
  const [isNewRoofDamageTemplate, setIsNewRoofDamageTemplate] = useState(false)
  const [msDamageTemplate, setMsDamageTemplate] = useState<string | null>(null)
  const [msDamageTemplateSaved, setMsDamageTemplateSaved] = useState(true)
  const [isNewMsDamageTemplate, setIsNewMsDamageTemplate] = useState(false)

  // ─── Review / Submit ─────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(!!initialData.formSubmittedAt)
  const [submitTime, setSubmitTime] = useState(initialData.formSubmittedAt ? new Date(initialData.formSubmittedAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
  const [submitPath, setSubmitPath] = useState<'none' | 'finalise' | 'office'>('none')
  const [amendmentText, setAmendmentText] = useState('')
  const [amendmentSent, setAmendmentSent] = useState(false)
  const [step, setStep] = useState(1)
  const [saveStatus, setSaveStatus] = useState('')

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocusRoomRef = useRef<string | null>(null)

  // After a scope item is added, focus the last input in that room
  useEffect(() => {
    if (!pendingFocusRoomRef.current) return
    const roomId = pendingFocusRoomRef.current
    pendingFocusRoomRef.current = null
    setTimeout(() => {
      const inputs = document.querySelectorAll(`[data-room-id="${roomId}"] .fa-scope-input`)
      ;(inputs[inputs.length - 1] as HTMLInputElement | undefined)?.focus()
    }, 0)
  }, [scopeRooms])

  // Move focus to the next input/textarea in the page (used for iOS Return key navigation)
  function focusNextInput(current: HTMLElement) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="file"]):not([type="hidden"]), textarea:not([disabled])'
    ))
    const idx = all.indexOf(current)
    if (idx >= 0 && idx < all.length - 1) all[idx + 1].focus()
  }

  // ─── Signature Canvas ─────────────────────────────────────────────────────
  // ctx is scaled by dpr, so draw-coordinates are CSS pixels — no extra scaling needed
  const getCanvasPos = (canvas: HTMLCanvasElement, e: MouseEvent | Touch) => {
    const rect = canvas.getBoundingClientRect()
    const clientX = 'clientX' in e ? e.clientX : (e as Touch).clientX
    const clientY = 'clientY' in e ? e.clientY : (e as Touch).clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    // Use actual layout dimensions so physical ↔ CSS mapping is exact
    const rect = canvas.getBoundingClientRect()
    const cssW = rect.width || canvas.offsetWidth || 300
    const cssH = rect.height || canvas.offsetHeight || 90
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const sigStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current; if (!canvas) return
    isDrawing.current = true
    const pos = getCanvasPos(canvas, 'touches' in e.nativeEvent ? e.nativeEvent.touches[0] : e.nativeEvent as MouseEvent)
    const ctx = canvas.getContext('2d')!
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }, [])

  const sigMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const pos = getCanvasPos(canvas, 'touches' in e.nativeEvent ? e.nativeEvent.touches[0] : e.nativeEvent as MouseEvent)
    const ctx = canvas.getContext('2d')!
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
    setHasSig(true)
  }, [])

  const sigEnd = useCallback(() => { isDrawing.current = false }, [])

  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSig(false)
  }

  // ─── Draft Save/Restore ───────────────────────────────────────────────────
  const collectDraft = useCallback(() => ({
    personMet, relation, propDesc, raw_report_notes, photoContext,
    hospitalName, customSafetyNotes, chips, safetyDone, commenceTime, step,
    scopeRooms: scopeRooms.map(r => ({ ...r, items: r.items.map(i => i.text) })),
    roofRawNotes, roofPhotoContext,
    msWorksCompleted, msTempFixes, msHours,
    ldMethod, ldSource, ldLocation, ldReadings, ldFindings,
    restType, restExtent, restRooms, restEquip, restNotes,
    extTrades, extTradeNotes,
    damage_template: damageTemplate, damage_template_saved: damageTemplateSaved,
    roof_damage_template: roofDamageTemplate, roof_damage_template_saved: roofDamageTemplateSaved,
    ms_damage_template: msDamageTemplate, ms_damage_template_saved: msDamageTemplateSaved,
  }), [personMet, relation, propDesc, raw_report_notes, photoContext, hospitalName, customSafetyNotes, chips, safetyDone, commenceTime, step, scopeRooms, roofRawNotes, roofPhotoContext, msWorksCompleted, msTempFixes, msHours, ldMethod, ldSource, ldLocation, ldReadings, ldFindings, restType, restExtent, restRooms, restEquip, restNotes, extTrades, extTradeNotes, damageTemplate, damageTemplateSaved, roofDamageTemplate, roofDamageTemplateSaved, msDamageTemplate, msDamageTemplateSaved])

  const armDraft = useCallback(() => {
    if (submitted) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: collectDraft() }) })
        setSaveStatus('Saved')
        setTimeout(() => setSaveStatus(''), 2000)
      } catch { setSaveStatus('Save failed') }
    }, 3000)
  }, [base, collectDraft, submitted])

  // Flush draft immediately when the user navigates away or closes the tab
  useEffect(() => {
    if (submitted) return
    const flush = () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      const draft = collectDraft()
      // navigator.sendBeacon keeps the request alive after unload
      const blob = new Blob([JSON.stringify({ draft })], { type: 'application/json' })
      navigator.sendBeacon(`${base}/draft`, blob)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [base, collectDraft, submitted])

  // Restore draft
  useEffect(() => {
    const d = initialData.fieldDraft as Record<string, unknown> | null
    if (!d) return
    if (d.personMet) setPersonMet(d.personMet as string)
    if (d.relation) setRelation(d.relation as string)
    if (d.propDesc) setPropDesc(d.propDesc as string)
    if (d.raw_report_notes) setRawReportNotes(d.raw_report_notes as string)
    if (d.photoContext) setPhotoContext(d.photoContext as string)
    if (d.hospitalName) setHospitalName(d.hospitalName as string)
    if (d.customSafetyNotes) setCustomSafetyNotes(d.customSafetyNotes as string)
    if (d.chips) setChips(d.chips as typeof chips)
    if (d.commenceTime) setCommenceTime(d.commenceTime as string)
    if (d.safetyDone) setSafetyDone(true)
    if (typeof d.step === 'number' && d.step > 1) setStep(d.step as number)
    if (d.scopeRooms) {
      const rooms = (d.scopeRooms as Array<{ id?: string; name: string; l: string; w: string; h: string; items: string[] }>)
      setScopeRooms(rooms.map(r => ({ id: r.id ?? uid(), name: r.name, l: r.l, w: r.w, h: r.h, items: r.items.map(text => ({ id: uid(), text })) })))
    }
    if (d.roofRawNotes) setRoofRawNotes(d.roofRawNotes as string)
    if (d.roofPhotoContext) setRoofPhotoContext(d.roofPhotoContext as string)
    if (d.msWorksCompleted) setMsWorksCompleted(d.msWorksCompleted as string)
    if (d.msTempFixes) setMsTempFixes(d.msTempFixes as string)
    if (d.msHours) setMsHours(d.msHours as string)
    if (d.ldMethod) setLdMethod(d.ldMethod as string)
    if (d.ldSource) setLdSource(d.ldSource as string)
    if (d.ldLocation) setLdLocation(d.ldLocation as string)
    if (d.ldReadings) setLdReadings(d.ldReadings as string[])
    if (d.ldFindings) setLdFindings(d.ldFindings as string)
    if (d.restType) setRestType(d.restType as string)
    if (d.restExtent) setRestExtent(d.restExtent as string)
    if (d.restRooms) setRestRooms(d.restRooms as string)
    if (d.restEquip) setRestEquip(d.restEquip as Record<string, boolean>)
    if (d.restNotes) setRestNotes(d.restNotes as string)
    if (d.extTrades) setExtTrades(d.extTrades as Record<string, boolean>)
    if (d.extTradeNotes) setExtTradeNotes(d.extTradeNotes as Record<string, string>)
    if (d.damage_template) setDamageTemplate(d.damage_template as string)
    if (typeof d.damage_template_saved === 'boolean') setDamageTemplateSaved(d.damage_template_saved as boolean)
    if (d.roof_damage_template) setRoofDamageTemplate(d.roof_damage_template as string)
    if (typeof d.roof_damage_template_saved === 'boolean') setRoofDamageTemplateSaved(d.roof_damage_template_saved as boolean)
    if (d.ms_damage_template) setMsDamageTemplate(d.ms_damage_template as string)
    if (typeof d.ms_damage_template_saved === 'boolean') setMsDamageTemplateSaved(d.ms_damage_template_saved as boolean)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const applyAllClear = () => {
    setChips({ general: true, ppe: true, asbestos: true, structural: true, roofPower: true, weather: true })
    armDraft()
  }

  const completeSafety = () => {
    if (!hasSig) { alert('Please sign before confirming.'); return }
    const now = new Date()
    const ts = now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    setCommenceTime(ts)
    setSafetyDone(true)
    setStep(2)
    armDraft()
    setTimeout(() => document.getElementById('sec-details')?.scrollIntoView({ behavior: 'smooth' }), 150)
  }

  const addRoom = () => {
    setScopeRooms(prev => [...prev, { id: uid(), name: '', l: '', w: '', h: '', items: [{ id: uid(), text: '' }] }])
    armDraft()
  }

  const updateRoom = (roomId: string, key: keyof ScopeRoom, value: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, [key]: value } : r))
    armDraft()
  }

  const addScopeItem = (roomId: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, items: [...r.items, { id: uid(), text: '' }] } : r))
  }

  const updateScopeItem = (roomId: string, itemId: string, text: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, text } : i) } : r))
    armDraft()
  }

  const removeScopeItem = (roomId: string, itemId: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, items: r.items.filter(i => i.id !== itemId) } : r))
    armDraft()
  }

  const removeRoom = (roomId: string) => {
    setScopeRooms(prev => prev.filter(r => r.id !== roomId))
    armDraft()
  }

  const handlePhotos = (files: FileList | null) => {
    if (!files) return
    setAiLabelDone(false)

    Array.from(files).forEach(file => {
      const id = uid()
      // Show a placeholder immediately so the inspector sees something
      const rawPreview = URL.createObjectURL(file)
      setPhotos(prev => [...prev, { id, file, previewUrl: rawPreview, label: '', processing: true }])

      processPhotoForUpload(file).then(processed => {
        const processedPreview = URL.createObjectURL(processed)
        setPhotos(prev => prev.map(p => {
          if (p.id !== id) return p
          URL.revokeObjectURL(p.previewUrl)   // drop the raw HEIC preview
          return { ...p, file: processed, previewUrl: processedPreview, processing: false }
        }))
        armDraft()
      })
    })
  }

  const updatePhotoLabel = (id: string, label: string) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, label } : p))
    armDraft()
  }

  const removePhoto = (id: string) => {
    setPhotos(prev => {
      const p = prev.find(x => x.id === id)
      if (p) URL.revokeObjectURL(p.previewUrl)
      return prev.filter(x => x.id !== id)
    })
    armDraft()
  }

  const anyProcessing = photos.some(p => p.processing)

  const runAILabels = async () => {
    if (!photoContext.trim()) { alert('Add a photo description first.'); return }
    if (!photos.length) { alert('No photos to label.'); return }
    if (anyProcessing) { alert('Photos are still processing — please wait a moment.'); return }
    setAiLabeling(true)
    try {
      const res = await fetch(`${base}/ai-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: photoContext, photoCount: photos.length, jobContext: { lossType: initialData.lossType, insurer: initialData.insurer, address: initialData.address } }),
      })
      const data = await res.json()
      if (data.ok && data.labels?.length) {
        setPhotos(prev => prev.map((p, i) => ({ ...p, label: data.labels[i] ?? p.label })))
        setAiLabelDone(true)
      }
    } catch { /* fallback: keep existing labels */ }
    setAiLabeling(false)
  }

  // ─── Submit Flow ──────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!safetyDone) return
    finalSubmit()
  }

  const finalSubmit = async () => {
    setIsSubmitting(true)
    try {
      // Flush the current draft immediately so the snapshot is preserved post-submission
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      await fetch(`${base}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: collectDraft() }),
      })

      // Upload photos first
      for (const photo of photos) {
        const fd = new FormData()
        fd.append('file', photo.file)
        fd.append('label', photo.label)
        await fetch(`${base}/photos`, { method: 'POST', body: fd })
      }

      // Submit the inspection
      const scopeRoomsPayload = scopeRooms.map(r => ({
        room: r.name,
        l: r.l, w: r.w, h: r.h,
        items: r.items.map(i => i.text).filter(Boolean),
      }))

      // Upload roof photos first if any
      for (const photo of roofPhotos) {
        const fd = new FormData()
        fd.append('file', photo.file)
        fd.append('label', photo.label)
        fd.append('isRoofPhoto', 'true')
        await fetch(`${base}/photos`, { method: 'POST', body: fd })
      }

      const res = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personMet,
          safetyData: {
            general: chips.general,
            ppe: chips.ppe,
            asbestos: chips.asbestos,
            structural: chips.structural,
            roofPower: chips.roofPower,
            weather: chips.weather,
            customNotes: customSafetyNotes,
            hospitalName,
            signedBy: personMet,
          },
          scopeRooms: scopeRoomsPayload,
          rawReportDump: raw_report_notes,
          propDesc,
          photoContext,
          insurer: initialData.insurer ?? '',
          lossType: initialData.lossType ?? '',
          roofRawNotes,
          roofPhotoContext,
        }),
      })

      const data = await res.json()
      if (data.ok) {
        const now = new Date()
        const ts = now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        setSubmitTime(ts)
        setSubmitted(true)
        setStep(7)
        setTimeout(() => document.getElementById('submitted-state')?.scrollIntoView({ behavior: 'smooth' }), 200)
      } else {
        alert('Submission failed. Please try again.')
      }
    } catch (e) {
      console.error(e)
      alert('Submission failed. Please check your connection.')
    }
    setIsSubmitting(false)
  }

  const togglePanel = (key: string) => {
    setActivePanel(prev => prev === key ? null : key)
  }

  const toggleExtTrade = (key: string) => {
    setExtTrades(prev => ({ ...prev, [key]: !prev[key] }))
    armDraft()
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const stepLabels = ['', 'Safety', 'Details', 'Scope', 'Notes', 'Photos', 'Reports']

  return (
    <div className="fa-root">

      {/* HEADER */}
      <div className="fa-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="fa-logo"><span>IRC</span></div>
          <div className="fa-job-pill">{initialData.jobNumber ?? '—'}</div>
        </div>
        <div className="fa-hdr-right">
          {initialData.jobNumber ?? '—'}
          <br />
          <span style={{ fontSize: 9 }}>
            {initialData.inspectionRef ?? initialData.inspectionId} · {formatDate(initialData.scheduledDate)}
          </span>
          {saveStatus && <div className="fa-save-indicator" style={{ opacity: 1 }}>{saveStatus}</div>}
        </div>
      </div>

      {/* PROGRESS */}
      <div className="fa-prog-bar">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className={`fa-prog${step > i ? ' done' : step === i ? ' active' : ''}`} />
        ))}
        <div className="fa-prog-lbl">{stepLabels[step]}</div>
      </div>

      {/* JOB BANNER */}
      <div className="fa-banner">
        <div className="fa-bgrid">
          <div className="fa-bf full"><label>Property</label><span>{initialData.address ?? '—'}</span></div>
          <div className="fa-bf"><label>Insured</label><span>{initialData.insuredName ?? '—'}</span></div>
          <div className="fa-bf"><label>Insurer</label><span>{initialData.insurer ?? '—'}</span></div>
          <div className="fa-bf"><label>Inspector</label><span>{initialData.inspector ?? '—'}</span></div>
          <div className="fa-bf"><label>Loss Type</label><span>{initialData.lossType ?? '—'}</span></div>
          <div className="fa-bf"><label>Date of Loss</label><span>{formatDate(initialData.dateOfLoss)}</span></div>
        </div>
        <div className="fa-type-badge">{initialData.lossType?.toUpperCase() ?? 'INSPECTION'}</div>
      </div>

      {/* ── 01 SAFETY & COMMENCE ─────────────────────────────────────────── */}
      <div className="fa-sc" id="sec-safety">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle ${safetyDone ? 'done' : 'warn'}`}>{safetyDone ? '✓' : '⚠'}</div>
          <div className="fa-sc-meta">
            <h3>Safety &amp; Commence</h3>
            <p>Required · unlocks all sections</p>
          </div>
          <span className={`fa-badge ${safetyDone ? 'ok' : 'req'}`}>{safetyDone ? 'Complete' : 'Required'}</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone ? (
            <div style={{ padding: '16px 0 0' }}>
              {/* All Clear */}
              <div style={{ padding: '0 18px', marginBottom: 14 }}>
                <button
                  className={`fa-all-clear${Object.values(chips).every(Boolean) ? ' filled' : ''}`}
                  onClick={applyAllClear}
                >
                  ✓ Standard Conditions Apply
                </button>
              </div>
              {/* Safety Chips */}
              <div className="fa-safety-grid" style={{ padding: '0 18px', marginBottom: 16 }}>
                {([
                  ['general', 'No immediate hazards identified'],
                  ['ppe', 'Appropriate PPE worn'],
                  ['asbestos', 'Asbestos risk acknowledged'],
                  ['structural', 'No structural hazards'],
                  ['roofPower', 'Power hazards managed'],
                  ['weather', 'Weather conditions suitable'],
                ] as [keyof typeof chips, string][]).map(([key, label]) => (
                  <div
                    key={key}
                    className={`fa-chip${chips[key] ? ' sel' : ''}`}
                    onClick={() => { setChips(prev => ({ ...prev, [key]: !prev[key] })); armDraft() }}
                  >
                    <div className="fa-cbox">{chips[key] ? '✓' : ''}</div>
                    <div className="fa-ctext">{label}</div>
                  </div>
                ))}
              </div>
              {/* Hospital */}
              <div className="fa-fg">
                <label className="fa-fl">Nearest Hospital</label>
                <input
                  className="fa-input"
                  type="text"
                  placeholder="Not built yet — enter manually"
                  value={hospitalName}
                  onChange={e => { setHospitalName(e.target.value); armDraft() }}
                  enterKeyHint="next"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }}
                />
              </div>
              {/* Custom Notes */}
              <div className="fa-fg">
                <label className="fa-fl">Additional Safety Notes</label>
                <textarea
                  className="fa-ta"
                  placeholder="Any specific hazards or conditions noted on arrival…"
                  style={{ minHeight: 70 }}
                  value={customSafetyNotes}
                  onChange={e => { setCustomSafetyNotes(e.target.value); armDraft() }}
                />
              </div>
              {/* Signature */}
              <div className="fa-fg">
                <label className="fa-fl">Inspector Signature <span className="req">*</span></label>
                <div className="fa-sig-wrap">
                  <canvas
                    ref={canvasRef}
                    className="fa-sig-canvas"
                    onMouseDown={sigStart} onMouseMove={sigMove} onMouseUp={sigEnd} onMouseLeave={sigEnd}
                    onTouchStart={sigStart} onTouchMove={sigMove} onTouchEnd={sigEnd}
                  />
                  {!hasSig && <div className="fa-sig-ph">Sign here</div>}
                </div>
                <button className="fa-sig-clear" onClick={clearSig} style={{ marginTop: 4 }}>Clear</button>
              </div>
              {/* Confirm Button */}
              <div style={{ padding: '0 18px 18px' }}>
                <button
                  onClick={completeSafety}
                  style={{ width: '100%', padding: '15px 18px', background: hasSig ? '#4a7c59' : '#ddd5c8', color: hasSig ? 'white' : '#7a6f65', border: 'none', borderRadius: 6, fontFamily: 'var(--font-bebas-neue), sans-serif', fontSize: 20, letterSpacing: '3px', cursor: hasSig ? 'pointer' : 'not-allowed' }}
                >
                  Confirm Safety &amp; Commence
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '12px 18px 16px' }}>
              <div className="fa-safety-confirmed">
                <div className="fa-sc-icon">✓</div>
                <div className="fa-sc-text">
                  <h4>Safety Confirmed</h4>
                  <p>Commenced · {commenceTime || formatDate(initialData.safetyConfirmedAt)} · {initialData.inspector}</p>
                </div>
                <button className="fa-sc-edit" onClick={() => setSafetyDone(false)}>Edit</button>
              </div>
              {hospitalName && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  🏥 Nearest hospital: {hospitalName}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 02 DETAILS ───────────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-details">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>02</div>
          <div className="fa-sc-meta"><h3>Details</h3><p>Person on site · property description</p></div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}
          <div style={{ padding: '16px 0' }}>
            <div className="fa-fg">
              <label className="fa-fl">Person Met On Site <span className="req">*</span></label>
              <input className="fa-input" type="text" value={personMet} onChange={e => { setPersonMet(e.target.value); armDraft() }} placeholder="Full name" enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
            </div>
            <div className="fa-fg">
              <label className="fa-fl">Relation to Property</label>
              <div className="fa-rg inline">
                {['Owner', 'Tenant', 'Agent', 'Other'].map(r => (
                  <button key={r} className={`fa-ro${relation === r ? ' sel' : ''}`} onClick={() => { setRelation(r); armDraft() }}>{r}</button>
                ))}
              </div>
            </div>
            <div className="fa-fg">
              <label className="fa-fl">Property Description</label>
              <textarea
                className="fa-ta"
                placeholder="e.g. Single storey brick veneer, tiled roof, circa 1985…"
                style={{ minHeight: 90 }}
                value={propDesc}
                onChange={e => { setPropDesc(e.target.value); armDraft() }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 03 SCOPE NOTES ───────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-scope">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>03</div>
          <div className="fa-sc-meta"><h3>Scope Notes</h3><p>Rooms · dimensions · items</p></div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}
          <div style={{ paddingTop: 12 }}>
            {scopeRooms.map(room => (
              <div key={room.id} className="fa-room-block" data-room-id={room.id}>
                <div className="fa-room-head">
                  <input
                    className="fa-room-name"
                    type="text"
                    placeholder="Room name"
                    value={room.name}
                    onChange={e => updateRoom(room.id, 'name', e.target.value)}
                    enterKeyHint="next"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, marginLeft: 4 }}>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>L</span>
                    <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.l} onChange={e => updateRoom(room.id, 'l', e.target.value)} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
                    <span style={{ fontSize: 9, color: 'var(--border)' }}>×</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>W</span>
                    <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.w} onChange={e => updateRoom(room.id, 'w', e.target.value)} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
                    <span style={{ fontSize: 9, color: 'var(--border)' }}>×</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>H</span>
                    <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.h} onChange={e => updateRoom(room.id, 'h', e.target.value)} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
                  </div>
                  <button style={{ background: 'none', border: 'none', color: 'var(--border)', fontSize: 16, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }} onClick={() => removeRoom(room.id)}>×</button>
                </div>
                <div className="fa-room-body">
                  {room.items.map(item => (
                    <div key={item.id} className="fa-scope-row">
                      <input
                        className="fa-scope-input"
                        type="text"
                        placeholder="Scope item"
                        value={item.text}
                        onChange={e => updateScopeItem(room.id, item.id, e.target.value)}
                        enterKeyHint="done"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            pendingFocusRoomRef.current = room.id
                            addScopeItem(room.id)
                            armDraft()
                          }
                        }}
                      />
                      <button className="fa-scope-del" onClick={() => removeScopeItem(room.id, item.id)}>×</button>
                    </div>
                  ))}
                  <button className="fa-add-btn" onClick={() => addScopeItem(room.id)}>+ Add Item</button>
                </div>
              </div>
            ))}
            <div style={{ padding: '8px 12px 16px' }}>
              <button
                onClick={addRoom}
                style={{ width: '100%', padding: '12px', background: 'var(--black)', color: 'var(--beige)', border: 'none', borderRadius: 6, fontFamily: 'var(--font-bebas-neue), sans-serif', fontSize: 17, letterSpacing: '2px', cursor: 'pointer' }}
              >
                + Add Room
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 04 REPORT NOTES ──────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-notes">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>04</div>
          <div className="fa-sc-meta"><h3>Raw Report Notes</h3><p>Damage description · cause · findings</p></div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}
          {safetyDone && (
            <div style={{ padding: '14px 16px 0' }}>
              <TemplateSelectorField
                reportType="BAR"
                value={damageTemplate}
                onChange={name => { setDamageTemplate(name); setIsNewDamageTemplate(false); armDraft() }}
                onTemplateSaved={name => { setDamageTemplate(name); setIsNewDamageTemplate(true); armDraft() }}
              />
              {isNewDamageTemplate && damageTemplate && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={damageTemplateSaved}
                    onChange={e => { setDamageTemplateSaved(e.target.checked); armDraft() }}
                    style={{ width: 14, height: 14, accentColor: 'var(--black)' }}
                  />
                  Save as template for future jobs
                </label>
              )}
            </div>
          )}
          <div className="fa-ai-dark">
            <div className="fa-ai-dark-head">
              <span style={{ fontSize: 14 }}>✦</span>
              <span className="fa-ai-dark-title">AI Report Generation</span>
            </div>
            <div className="fa-ai-hints">
              {['What was damaged', 'Cause of damage', 'Pre-existing conditions', 'Any maintenance noted', 'Extent of damage', 'Structural concerns'].map(hint => (
                <div key={hint} className="fa-ai-hint">{hint}</div>
              ))}
            </div>
            <div className="fa-ai-dark-body">
              <textarea
                className="fa-ai-dark-ta"
                placeholder="Describe the damage, cause, and your findings in plain language. AI will structure this into a professional report…"
                style={{ minHeight: 130 }}
                value={raw_report_notes}
                onChange={e => { setRawReportNotes(e.target.value); armDraft() }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 05 PHOTOS ────────────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-photos">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>05</div>
          <div className="fa-sc-meta"><h3>Photos</h3><p>Upload · label with AI</p></div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}
          {/* Photo Context (AI Dark) */}
          <div className="fa-ai-dark" style={{ marginBottom: 0 }}>
            <div className="fa-ai-dark-head">
              <span style={{ fontSize: 14 }}>📷</span>
              <span className="fa-ai-dark-title">Photo Context</span>
            </div>
            <div className="fa-ai-dark-body">
              <textarea
                className="fa-ai-dark-ta"
                placeholder="Describe your photos in order. e.g. 'First is the damaged ceiling in the living room, second shows the water stain on the wall, third is an overview of the roof tiles displaced…'"
                style={{ minHeight: 80 }}
                value={photoContext}
                onChange={e => { setPhotoContext(e.target.value); armDraft() }}
              />
              <button
                className={`fa-ai-label-btn${aiLabelDone ? ' done' : ''}`}
                onClick={runAILabels}
                disabled={aiLabeling || anyProcessing}
              >
                {anyProcessing ? <><span className="fa-spinner" /> Converting photos…</> : aiLabeling ? <><span className="fa-spinner" /> Labelling…</> : aiLabelDone ? '✓ Labels Applied' : '✦ AI Label All Photos'}
              </button>
            </div>
          </div>
          {/* Photo Grid */}
          <div className="fa-photo-grid">
            {photos.map(photo => (
              <div key={photo.id} className="fa-photo-card">
                <img className="fa-photo-thumb" src={photo.previewUrl} alt="inspection" />
                {photo.processing && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <span className="fa-spinner" style={{ borderColor: 'var(--beige)', borderTopColor: 'transparent', width: 22, height: 22 }} />
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, color: 'var(--beige)', letterSpacing: 1 }}>Converting…</span>
                  </div>
                )}
                {!photo.processing && <button className="fa-photo-del" onClick={() => removePhoto(photo.id)}>×</button>}
                <div className="fa-photo-label-area">
                  <textarea
                    className="fa-photo-label-ta"
                    rows={1}
                    placeholder={photo.processing ? 'Processing…' : 'Add label'}
                    value={photo.label}
                    disabled={photo.processing}
                    onChange={e => updatePhotoLabel(photo.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
            {/* Upload Slot */}
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="fa-upload-slot"
            >
              <span style={{ fontSize: 24 }}>📷</span>
              <span>Add Photo</span>
            </button>
            <input
              ref={photoInputRef}
              id="photo-file-input"
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={e => handlePhotos(e.target.files)}
            />
          </div>
        </div>
      </div>

      {/* ── 06 ADDITIONAL REPORTS ─────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-reports">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>06</div>
          <div className="fa-sc-meta"><h3>Additional Reports</h3><p>Make Safe · Roof Report · Leak Detection · Restoration</p></div>
          <span className="fa-badge opt">Optional</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}

          {/* List */}
          <div style={{ paddingTop: 4 }}>
            {[
              { key: 'make-safe', dot: 'ms', name: 'Make Safe', sub: 'Emergency works completed' },
              { key: 'roof-report', dot: 'rr', name: 'Roof Report', sub: 'Roof-specific inspection' },
              { key: 'leak-detection', dot: 'ld', name: 'Leak Detection', sub: 'Source identification' },
              { key: 'restoration', dot: 're', name: 'Restoration Assessment', sub: 'Water / fire / mould' },
            ].map(({ key, dot, name, sub }) => (
              <div key={key}>
                <div
                  className={`fa-ar-item${activePanel === key ? ' active' : ''}`}
                  onClick={() => togglePanel(key)}
                >
                  <div className={`fa-ar-dot ${dot}`} />
                  <div className="fa-ar-info">
                    <div className="fa-ar-name">{name}</div>
                    <div className="fa-ar-sub">{sub}</div>
                  </div>
                  <div className="fa-ar-check">{activePanel === key ? '✓' : '›'}</div>
                </div>

                {/* Make Safe Panel */}
                {key === 'make-safe' && activePanel === 'make-safe' && (
                  <div className="fa-internal-panel fa-panel-ms">
                    <div className="fa-panel-title">🚨 Make Safe <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>Fields</span></div>
                    <div style={{ padding: '0 18px 14px' }}>
                      <div style={{ paddingTop: 14 }}>
                        <TemplateSelectorField
                          reportType="make_safe"
                          value={msDamageTemplate}
                          onChange={name => { setMsDamageTemplate(name); setIsNewMsDamageTemplate(false); armDraft() }}
                          onTemplateSaved={name => { setMsDamageTemplate(name); setIsNewMsDamageTemplate(true); armDraft() }}
                        />
                        {isNewMsDamageTemplate && msDamageTemplate && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 10, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={msDamageTemplateSaved}
                              onChange={e => { setMsDamageTemplateSaved(e.target.checked); armDraft() }}
                              style={{ width: 14, height: 14, accentColor: 'var(--black)' }}
                            />
                            Save as template for future jobs
                          </label>
                        )}
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Works Completed On Site</label>
                        <textarea className="fa-ta" placeholder="Describe emergency make safe works carried out…" value={msWorksCompleted} onChange={e => { setMsWorksCompleted(e.target.value); armDraft() }} />
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Temporary Measures</label>
                        <textarea className="fa-ta" placeholder="Tarps, boarding, temporary repairs…" style={{ minHeight: 70 }} value={msTempFixes} onChange={e => { setMsTempFixes(e.target.value); armDraft() }} />
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 0 }}>
                        <label className="fa-fl">Hours on Site</label>
                        <input className="fa-input" type="text" placeholder="e.g. 2.5 hrs" value={msHours} onChange={e => { setMsHours(e.target.value); armDraft() }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Roof Report Panel */}
                {key === 'roof-report' && activePanel === 'roof-report' && (
                  <div className="fa-internal-panel fa-panel-rr">
                    <div className="fa-panel-title">🏠 Roof Report <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>AI Generation</span></div>
                    <div style={{ padding: '14px 16px 0' }}>
                      <TemplateSelectorField
                        reportType="roof"
                        value={roofDamageTemplate}
                        onChange={name => { setRoofDamageTemplate(name); setIsNewRoofDamageTemplate(false); armDraft() }}
                        onTemplateSaved={name => { setRoofDamageTemplate(name); setIsNewRoofDamageTemplate(true); armDraft() }}
                      />
                      {isNewRoofDamageTemplate && roofDamageTemplate && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={roofDamageTemplateSaved}
                            onChange={e => { setRoofDamageTemplateSaved(e.target.checked); armDraft() }}
                            style={{ width: 14, height: 14, accentColor: 'var(--black)' }}
                          />
                          Save as template for future jobs
                        </label>
                      )}
                    </div>
                    {/* Roof Report Raw Notes */}
                    <div className="fa-ai-dark" style={{ marginBottom: 0 }}>
                      <div className="fa-ai-dark-head">
                        <span style={{ fontSize: 14 }}>✦</span>
                        <span className="fa-ai-dark-title">Roof Report Raw Notes</span>
                      </div>
                      <div className="fa-ai-hints">
                        {['Roof type', 'Roof condition', 'Roof pitch', 'Penetrations count', 'Storeys count', 'Ridge condition', 'Gutter condition', 'Gutter overflows', 'Roof insulation', 'Damage cause', 'Internal damage', 'Roof damage', 'Maintenance issues', 'Insured aware', 'Non-claim issues', 'Repairs required', 'Repair blockers', 'Prior repairs', 'Conclusion'].map(hint => (
                          <div key={hint} className="fa-ai-hint">{hint}</div>
                        ))}
                      </div>
                      <div className="fa-ai-dark-body">
                        <textarea
                          className="fa-ai-dark-ta"
                          placeholder="Dictate roof inspection details covering all fields above. AI will generate the full roof report…"
                          style={{ minHeight: 130 }}
                          value={roofRawNotes}
                          onChange={e => { setRoofRawNotes(e.target.value); armDraft() }}
                        />
                      </div>
                    </div>
                    {/* Roof Photos */}
                    <div className="fa-ai-dark" style={{ marginTop: 16, marginBottom: 0 }}>
                      <div className="fa-ai-dark-head">
                        <span style={{ fontSize: 14 }}>📷</span>
                        <span className="fa-ai-dark-title">Roof Photo Context</span>
                      </div>
                      <div className="fa-ai-dark-body">
                        <textarea
                          className="fa-ai-dark-ta"
                          placeholder="Describe your roof photos in order. e.g. 'First shows the damaged ridge capping, second is the valley with debris, third shows the gutter overflow…'"
                          style={{ minHeight: 80 }}
                          value={roofPhotoContext}
                          onChange={e => { setRoofPhotoContext(e.target.value); armDraft() }}
                        />
                        <button
                          className={`fa-ai-label-btn${roofAiLabelDone ? ' done' : ''}`}
                          onClick={() => {
                            if (!roofPhotoContext.trim()) { alert('Add a photo description first.'); return }
                            if (!roofPhotos.length) { alert('No photos to label.'); return }
                            setRoofAiLabeling(true)
                            fetch(`${base}/ai-label-roof`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ context: roofPhotoContext, photoCount: roofPhotos.length, jobContext: { lossType: initialData.lossType, insurer: initialData.insurer, address: initialData.address } }),
                            }).then(res => res.json()).then(data => {
                              if (data.ok && data.labels?.length) {
                                setRoofPhotos(prev => prev.map((p, i) => ({ ...p, label: data.labels[i] ?? p.label })))
                                setRoofAiLabelDone(true)
                              }
                              setRoofAiLabeling(false)
                            }).catch(() => setRoofAiLabeling(false))
                          }}
                          disabled={roofAiLabeling || roofPhotos.some(p => p.processing)}
                        >
                          {roofPhotos.some(p => p.processing) ? <><span className="fa-spinner" /> Converting photos…</> : roofAiLabeling ? <><span className="fa-spinner" /> Labelling…</> : roofAiLabelDone ? '✓ Labels Applied' : '✦ AI Label All Photos'}
                        </button>
                      </div>
                    </div>
                    {/* Roof Photo Grid */}
                    <div className="fa-photo-grid" style={{ marginTop: 16 }}>
                      {roofPhotos.map(photo => (
                        <div key={photo.id} className="fa-photo-card">
                          <img className="fa-photo-thumb" src={photo.previewUrl} alt="roof inspection" />
                          {photo.processing && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <span className="fa-spinner" style={{ borderColor: 'var(--beige)', borderTopColor: 'transparent', width: 22, height: 22 }} />
                              <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, color: 'var(--beige)', letterSpacing: 1 }}>Converting…</span>
                            </div>
                          )}
                          {!photo.processing && <button className="fa-photo-del" onClick={() => {
                            setRoofPhotos(prev => {
                              const p = prev.find(x => x.id === photo.id)
                              if (p) URL.revokeObjectURL(p.previewUrl)
                              return prev.filter(x => x.id !== photo.id)
                            })
                            armDraft()
                          }}>×</button>}
                          <div className="fa-photo-label-area">
                            <textarea
                              className="fa-photo-label-ta"
                              rows={1}
                              placeholder={photo.processing ? 'Processing…' : 'Add label'}
                              value={photo.label}
                              disabled={photo.processing}
                              onChange={e => {
                                setRoofPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, label: e.target.value } : p))
                                armDraft()
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      {/* Upload Slot */}
                      <button
                        type="button"
                        onClick={() => roofPhotoInputRef.current?.click()}
                        className="fa-upload-slot"
                      >
                        <span style={{ fontSize: 24 }}>📷</span>
                        <span>Add Roof Photo</span>
                      </button>
                      <input
                        ref={roofPhotoInputRef}
                        id="roof-photo-file-input"
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={e => {
                          if (!e.target.files) return
                          setRoofAiLabelDone(false)
                          Array.from(e.target.files).forEach(file => {
                            const id = uid()
                            const rawPreview = URL.createObjectURL(file)
                            setRoofPhotos(prev => [...prev, { id, file, previewUrl: rawPreview, label: '', processing: true }])
                            processPhotoForUpload(file).then(processed => {
                              const processedPreview = URL.createObjectURL(processed)
                              setRoofPhotos(prev => prev.map(p => {
                                if (p.id !== id) return p
                                URL.revokeObjectURL(p.previewUrl)
                                return { ...p, file: processed, previewUrl: processedPreview, processing: false }
                              }))
                              armDraft()
                            })
                          })
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Leak Detection Panel */}
                {key === 'leak-detection' && activePanel === 'leak-detection' && (
                  <div className="fa-internal-panel fa-panel-ld">
                    <div className="fa-panel-title">🔧 Leak Detection <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>Fields</span></div>
                    <div style={{ padding: '0 18px 14px' }}>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14, paddingTop: 14 }}>
                        <label className="fa-fl">Test Method Used</label>
                        <div className="fa-rg">
                          {['Water test', 'Thermal imaging', 'Moisture meter', 'Visual only'].map(opt => (
                            <button key={opt} className={`fa-ro${ldMethod === opt ? ' sel' : ''}`} onClick={() => { setLdMethod(opt); armDraft() }}>{opt}</button>
                          ))}
                        </div>
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Leak Source Identified</label>
                        <div className="fa-rg">
                          {['Yes — confirmed', 'Probable', 'Not identified'].map(opt => (
                            <button key={opt} className={`fa-ro${ldSource === opt ? ' sel' : ''}`} onClick={() => { setLdSource(opt); armDraft() }}>{opt}</button>
                          ))}
                        </div>
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Source Location</label>
                        <input className="fa-input" type="text" placeholder="e.g. Failed shower recess seal, bedroom 2" value={ldLocation} onChange={e => { setLdLocation(e.target.value); armDraft() }} />
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Moisture Readings</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          {[0, 1, 2].map(i => (
                            <div key={i}>
                              <label className="fa-fl" style={{ fontSize: 9 }}>Location {i + 1}</label>
                              <input className="fa-input" type="text" placeholder="e.g. 85%" value={ldReadings[i]} onChange={e => { const r = [...ldReadings]; r[i] = e.target.value; setLdReadings(r); armDraft() }} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 0 }}>
                        <label className="fa-fl">Findings</label>
                        <textarea className="fa-ta" placeholder="Describe leak detection findings and conclusions…" value={ldFindings} onChange={e => { setLdFindings(e.target.value); armDraft() }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Restoration Panel */}
                {key === 'restoration' && activePanel === 'restoration' && (
                  <div className="fa-internal-panel fa-panel-re">
                    <div className="fa-panel-title">🧰 Restoration Assessment <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>Fields</span></div>
                    <div style={{ padding: '0 18px 14px' }}>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14, paddingTop: 14 }}>
                        <label className="fa-fl">Restoration Type Required</label>
                        <div className="fa-rg inline">
                          {['Water / flood', 'Fire / smoke', 'Mould remediation', 'Storm'].map(opt => (
                            <button key={opt} className={`fa-ro${restType === opt ? ' sel' : ''}`} onClick={() => { setRestType(opt); armDraft() }}>{opt}</button>
                          ))}
                        </div>
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Affected Area Extent</label>
                        <div className="fa-rg">
                          {['Isolated', 'Moderate', 'Extensive'].map(opt => (
                            <button key={opt} className={`fa-ro${restExtent === opt ? ' sel' : ''}`} onClick={() => { setRestExtent(opt); armDraft() }}>{opt}</button>
                          ))}
                        </div>
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Rooms / Areas Affected</label>
                        <input className="fa-input" type="text" placeholder="e.g. Living room, hallway, bedroom 1" value={restRooms} onChange={e => { setRestRooms(e.target.value); armDraft() }} />
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                        <label className="fa-fl">Equipment Required</label>
                        {[['dehumidifiers', 'Dehumidifiers'], ['airMovers', 'Air movers / fans'], ['airScrubbers', 'Air scrubbers'], ['dryingMats', 'Drying mats']].map(([k, label]) => (
                          <div key={k} className={`fa-ti${restEquip[k] ? ' checked' : ''}`} onClick={() => { setRestEquip(prev => ({ ...prev, [k]: !prev[k] })); armDraft() }}>
                            <div className="fa-tbox" />
                            <div className="fa-ttext">{label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 0 }}>
                        <label className="fa-fl">Assessment Notes</label>
                        <textarea className="fa-ta" placeholder="Restoration findings, urgency, recommended actions…" value={restNotes} onChange={e => { setRestNotes(e.target.value); armDraft() }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* External Trades */}
          <div className="fa-divider"><span>External Trades — Request Report</span></div>
          <p style={{ fontSize: 12, color: 'var(--muted)', padding: '0 18px', marginBottom: 8 }}>Tap to select. A work order will be auto-triggered on submission.</p>
          {[
            { key: 'make-safe-ext', name: 'Make Safe', sub: 'External trade' },
            { key: 'leak-plumber', name: 'Leak Detection', sub: 'Plumber' },
            { key: 'electrical', name: 'Electrical', sub: 'Test + report' },
            { key: 'roof-plumber', name: 'Roof Plumber', sub: 'Roof report' },
            { key: 'aircon', name: 'Air Conditioning', sub: 'Report' },
            { key: 'fencing', name: 'Fencing / Gates', sub: 'Report' },
            { key: 'asbestos', name: 'Asbestos Test', sub: 'Clearance report' },
            { key: 'structural', name: 'Structural Engineer', sub: 'Report' },
          ].map(({ key, name, sub }) => (
            <div key={key} className={`fa-ext-item${extTrades[key] ? ' checked' : ''}`} onClick={() => toggleExtTrade(key)}>
              <div className="fa-ext-check">{extTrades[key] ? '✓' : ''}</div>
              <div className="fa-ext-info">
                <div className="fa-ext-name">{name}</div>
                <div className="fa-ext-sub">{sub}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--border)' }}>›</span>
            </div>
          ))}
          {/* Notes for selected external trades */}
          {Object.entries(extTrades).filter(([, v]) => v).map(([key]) => (
            <div key={key} style={{ padding: '0 18px 10px' }}>
              <label className="fa-fl" style={{ fontSize: 9, marginBottom: 4 }}>{key.replace(/-/g, ' ')} — Instructions</label>
              <textarea className="fa-ta" style={{ minHeight: 60, fontSize: 14 }} placeholder="Scope / instructions for this trade…" value={extTradeNotes[key] ?? ''} onChange={e => { setExtTradeNotes(prev => ({ ...prev, [key]: e.target.value })); armDraft() }} />
            </div>
          ))}
          <div style={{ height: 8 }} />
        </div>
      </div>


      <div style={{ height: 16 }} />

      {/* ── SUBMITTED STATE ───────────────────────────────────────────────── */}
      {submitted && (
        <div id="submitted-state" style={{ paddingTop: 16 }}>
          <div className="fa-submitted-overlay">
            <div className="fa-submitted-banner">
              <div className="fa-submitted-tick">✓</div>
              <div className="fa-submitted-text">
                <h3>Inspection Submitted</h3>
                <p>Submitted · {submitTime}</p>
              </div>
            </div>
            {submitPath === 'none' && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 12, color: 'var(--beige-dark)', marginBottom: 10, lineHeight: 1.6 }}>
                  Form submitted. AI is processing your notes and photos now. What would you like to do?
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    onClick={() => setSubmitPath('office')}
                    style={{ width: '100%', padding: '13px 16px', background: 'var(--beige)', color: 'var(--black)', border: 'none', borderRadius: 6, fontFamily: 'var(--font-bebas-neue)', fontSize: 18, letterSpacing: 2, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <span style={{ fontSize: 22 }}>🖥️</span>
                    <div>
                      <div>Hand to Office</div>
                      <div style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, letterSpacing: 1, fontWeight: 400, marginTop: 2, opacity: 0.7 }}>Office reviews on desktop · send amendment note if needed</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
            {submitPath === 'office' && !amendmentSent && (
              <div className="fa-amendment-box">
                <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--beige-dark)', marginBottom: 8, display: 'block' }}>
                  Amendment Note to Office
                </span>
                <textarea
                  className="fa-amendment-ta"
                  placeholder="e.g. Forgot to photograph the bathroom ceiling. Scope for bedroom 2 should say replace not repair."
                  value={amendmentText}
                  onChange={e => setAmendmentText(e.target.value)}
                />
                <button
                  className="fa-amendment-send"
                  onClick={async () => {
                    if (!amendmentText.trim()) { setAmendmentSent(true); return }
                    // TODO: wire up amendment send
                    setAmendmentSent(true)
                  }}
                >
                  {amendmentText.trim() ? 'Send Amendment to Office' : 'Done — Close App'}
                </button>
              </div>
            )}
            {amendmentSent && (
              <div style={{ background: 'var(--green-light)', border: '1px solid #c5dfc9', borderRadius: 6, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--green)' }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <div><div style={{ fontWeight: 500 }}>All done</div><div style={{ fontSize: 11, marginTop: 1 }}>Inspection submitted successfully</div></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBMIT BAR */}
      {!submitted && (
        <div className="fa-submit-bar">
          <button
            className={`fa-submit-btn${!safetyDone ? ' locked' : ''}`}
            onClick={handleSubmit}
            disabled={!safetyDone || isSubmitting || anyProcessing}
          >
            {anyProcessing ? 'Converting photos…' : isSubmitting ? 'Submitting…' : 'Submit Inspection'}
          </button>
        </div>
      )}
    </div>
  )
}
