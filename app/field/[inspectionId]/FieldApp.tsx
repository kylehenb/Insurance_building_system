'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
interface ReviewFlag { type: 'ok' | 'warn'; msg: string }

function uid() { return Math.random().toString(36).slice(2) }

// Convert any image (including HEIC) to a compressed JPEG ≤ TARGET_BYTES.
// Uses the canvas API — iOS Safari decodes HEIC natively, so no extra library needed.
async function processPhotoForUpload(file: File): Promise<File> {
  const TARGET_BYTES = 500 * 1024  // 500 KB ceiling
  const MAX_DIM = 2048             // 2048px max on longest side

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
  const [rawReportDump, setRawReportDump] = useState('')

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
  const [rfType, setRfType] = useState('')
  const [rfCondition, setRfCondition] = useState('')
  const [rfPitch, setRfPitch] = useState('')
  const [rfPenetrations, setRfPenetrations] = useState('')
  const [rfInsulation, setRfInsulation] = useState('')
  const [rfDamage, setRfDamage] = useState('')
  const [rfCause, setRfCause] = useState('')
  const [rfPreExist, setRfPreExist] = useState('')
  const [rfAware, setRfAware] = useState('')
  const [rfOtherCond, setRfOtherCond] = useState('')
  const [rfMaintenance, setRfMaintenance] = useState('')
  const [rfPrevents, setRfPrevents] = useState('')
  const [rfPrior, setRfPrior] = useState('')
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

  // ─── Review / Submit ─────────────────────────────────────────────────────
  const [reviewScore, setReviewScore] = useState<number | null>(null)
  const [reviewFlags, setReviewFlags] = useState<ReviewFlag[]>([])
  const [reviewSummary, setReviewSummary] = useState('')
  const [isReviewing, setIsReviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(!!initialData.formSubmittedAt)
  const [submitTime, setSubmitTime] = useState(initialData.formSubmittedAt ? new Date(initialData.formSubmittedAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
  const [submitPath, setSubmitPath] = useState<'none' | 'finalise' | 'office'>('none')
  const [amendmentText, setAmendmentText] = useState('')
  const [amendmentSent, setAmendmentSent] = useState(false)
  const [step, setStep] = useState(1)
  const [saveStatus, setSaveStatus] = useState('')

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Signature Canvas ─────────────────────────────────────────────────────
  const getCanvasPos = (canvas: HTMLCanvasElement, e: MouseEvent | Touch) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'clientX' in e ? e.clientX : (e as Touch).clientX
    const clientY = 'clientY' in e ? e.clientY : (e as Touch).clientY
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvas.offsetWidth * window.devicePixelRatio || canvas.offsetWidth
    canvas.height = 90 * (window.devicePixelRatio || 1)
    const ctx = canvas.getContext('2d')!
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1)
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
    personMet, relation, propDesc, rawReportDump, photoContext,
    hospitalName, customSafetyNotes, chips, safetyDone, commenceTime,
    scopeRooms: scopeRooms.map(r => ({ ...r, items: r.items.map(i => i.text) })),
    rfType, rfCondition, rfPitch, rfPenetrations, rfInsulation,
    rfDamage, rfCause, rfPreExist, rfAware, rfOtherCond,
    rfMaintenance, rfPrevents, rfPrior,
    msWorksCompleted, msTempFixes, msHours,
    ldMethod, ldSource, ldLocation, ldReadings, ldFindings,
    restType, restExtent, restRooms, restEquip, restNotes,
    extTrades, extTradeNotes,
  }), [personMet, relation, propDesc, rawReportDump, photoContext, hospitalName, customSafetyNotes, chips, safetyDone, commenceTime, scopeRooms, rfType, rfCondition, rfPitch, rfPenetrations, rfInsulation, rfDamage, rfCause, rfPreExist, rfAware, rfOtherCond, rfMaintenance, rfPrevents, rfPrior, msWorksCompleted, msTempFixes, msHours, ldMethod, ldSource, ldLocation, ldReadings, ldFindings, restType, restExtent, restRooms, restEquip, restNotes, extTrades, extTradeNotes])

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

  // Restore draft
  useEffect(() => {
    const d = initialData.fieldDraft as Record<string, unknown> | null
    if (!d) return
    if (d.personMet) setPersonMet(d.personMet as string)
    if (d.relation) setRelation(d.relation as string)
    if (d.propDesc) setPropDesc(d.propDesc as string)
    if (d.rawReportDump) setRawReportDump(d.rawReportDump as string)
    if (d.photoContext) setPhotoContext(d.photoContext as string)
    if (d.hospitalName) setHospitalName(d.hospitalName as string)
    if (d.customSafetyNotes) setCustomSafetyNotes(d.customSafetyNotes as string)
    if (d.chips) setChips(d.chips as typeof chips)
    if (d.commenceTime) setCommenceTime(d.commenceTime as string)
    if (d.safetyDone) setSafetyDone(true)
    if (d.scopeRooms) {
      const rooms = (d.scopeRooms as Array<{ id?: string; name: string; l: string; w: string; h: string; items: string[] }>)
      setScopeRooms(rooms.map(r => ({ id: r.id ?? uid(), name: r.name, l: r.l, w: r.w, h: r.h, items: r.items.map(text => ({ id: uid(), text })) })))
    }
    if (d.rfType) setRfType(d.rfType as string)
    if (d.rfCondition) setRfCondition(d.rfCondition as string)
    if (d.rfPitch) setRfPitch(d.rfPitch as string)
    if (d.rfPenetrations) setRfPenetrations(d.rfPenetrations as string)
    if (d.rfInsulation) setRfInsulation(d.rfInsulation as string)
    if (d.rfDamage) setRfDamage(d.rfDamage as string)
    if (d.rfCause) setRfCause(d.rfCause as string)
    if (d.rfPreExist) setRfPreExist(d.rfPreExist as string)
    if (d.rfAware) setRfAware(d.rfAware as string)
    if (d.rfOtherCond) setRfOtherCond(d.rfOtherCond as string)
    if (d.rfMaintenance) setRfMaintenance(d.rfMaintenance as string)
    if (d.rfPrevents) setRfPrevents(d.rfPrevents as string)
    if (d.rfPrior) setRfPrior(d.rfPrior as string)
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
  const runPreLeaveReview = async () => {
    setIsReviewing(true)
    setStep(7)
    document.getElementById('sec-review')?.scrollIntoView({ behavior: 'smooth' })

    // Client-side checks
    const flags: ReviewFlag[] = []
    let score = 10

    if (!safetyDone) { flags.push({ type: 'warn', msg: 'Safety section not confirmed' }); score -= 2 }

    const totalItems = scopeRooms.reduce((n, r) => n + r.items.filter(i => i.text.trim()).length, 0)
    if (totalItems === 0) { flags.push({ type: 'warn', msg: 'No scope items entered — add rooms and items' }); score -= 2 }
    else flags.push({ type: 'ok', msg: `Scope — ${totalItems} item${totalItems > 1 ? 's' : ''} across ${scopeRooms.length} room(s)` })

    const noteLen = rawReportDump.trim().length
    if (noteLen < 80) { flags.push({ type: 'warn', msg: `Raw report notes are brief — aim for 200+ characters (currently ${noteLen})` }); score -= 2 }
    else flags.push({ type: 'ok', msg: `Raw report notes — ${noteLen} characters` })

    if (!photos.length) { flags.push({ type: 'warn', msg: 'No photos attached — add at least one site photo' }); score -= 1 }
    else flags.push({ type: 'ok', msg: `Photos — ${photos.length} attached` })

    if (propDesc.trim().length < 20) { flags.push({ type: 'warn', msg: 'Property description not filled — add in Section 02' }); score -= 1 }
    if (!personMet.trim()) flags.push({ type: 'warn', msg: 'Person met on site not filled' })

    score = Math.max(1, Math.min(10, score))
    setReviewScore(score)
    setReviewFlags(flags)
    setReviewSummary('Reviewing your notes…')

    // AI review
    if (noteLen > 0) {
      try {
        const res = await fetch(`${base}/ai-review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawReportDump, propDesc, scopeItemCount: totalItems, photoCount: photos.length }),
        })
        const data = await res.json()
        if (data.ok) {
          const blended = Math.round((score + (data.score ?? score)) / 2)
          setReviewScore(blended)
          setReviewFlags([...flags, ...(data.flags ?? [])])
          setReviewSummary(data.summary ?? '')
        }
      } catch { /* use client-side score */ }
    } else {
      setReviewSummary('Add report notes for AI quality analysis.')
    }

    setIsReviewing(false)
  }

  const handleSubmit = () => {
    if (!safetyDone) return
    runPreLeaveReview()
  }

  const finalSubmit = async () => {
    setIsSubmitting(true)
    try {
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
          rawReportDump,
          propDesc,
          photoContext,
          insurer: initialData.insurer ?? '',
          lossType: initialData.lossType ?? '',
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
  const stepLabels = ['', 'Safety', 'Details', 'Scope', 'Notes', 'Photos', 'Reports', 'Review']

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
        {[1, 2, 3, 4, 5, 6, 7].map(i => (
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
          <div className="fa-bf"><label>Quote #</label><span>{initialData.quoteRef ?? '—'}</span></div>
          <div className="fa-bf"><label>Loss Type</label><span>{initialData.lossType ?? '—'}</span></div>
          <div className="fa-bf"><label>Date of Loss</label><span>{formatDate(initialData.dateOfLoss)}</span></div>
          <div className="fa-bf"><label>Inspection</label><span>{initialData.inspectionRef ?? initialData.inspectionId}</span></div>
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
              <input className="fa-input" type="text" value={personMet} onChange={e => { setPersonMet(e.target.value); armDraft() }} placeholder="Full name" />
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
              <div key={room.id} className="fa-room-block">
                <div className="fa-room-head">
                  <input
                    className="fa-room-name"
                    type="text"
                    placeholder="Room name"
                    value={room.name}
                    onChange={e => updateRoom(room.id, 'name', e.target.value)}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, marginLeft: 4 }}>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>L</span>
                    <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.l} onChange={e => updateRoom(room.id, 'l', e.target.value)} />
                    <span style={{ fontSize: 9, color: 'var(--border)' }}>×</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>W</span>
                    <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.w} onChange={e => updateRoom(room.id, 'w', e.target.value)} />
                    <span style={{ fontSize: 9, color: 'var(--border)' }}>×</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>H</span>
                    <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.h} onChange={e => updateRoom(room.id, 'h', e.target.value)} />
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
                value={rawReportDump}
                onChange={e => { setRawReportDump(e.target.value); armDraft() }}
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
            <label className="fa-upload-slot" htmlFor="photo-file-input">
              <span style={{ fontSize: 24 }}>📷</span>
              <span>Add Photo</span>
            </label>
            <input
              id="photo-file-input"
              ref={photoInputRef}
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
                      <div className="fa-fg" style={{ padding: 0, marginBottom: 14, paddingTop: 14 }}>
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
                    <div className="fa-panel-title">🏠 Roof Report <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>Fields</span></div>
                    <div className="fa-rr-section">Roof Type</div>
                    <div className="fa-qs-row">
                      {['Tiled — concrete', 'Tiled — terracotta', 'Metal — Colorbond', 'Metal — corrugated', 'Flat / membrane', 'Other'].map(opt => (
                        <button key={opt} className={`fa-qs-btn${rfType === opt ? ' qs-green' : ''}`} style={rfType === opt ? { borderColor: 'var(--green)', background: 'var(--green-light)', color: 'var(--green)', fontWeight: 500 } : {}} onClick={() => { setRfType(opt); armDraft() }}>{opt}</button>
                      ))}
                    </div>
                    <div className="fa-rr-section">Condition &amp; Pitch</div>
                    <div className="fa-qs-row">
                      {['Good', 'Fair', 'Poor', 'End of life'].map(opt => (
                        <button key={opt} className={`fa-qs-btn${rfCondition === opt ? ' qs-green' : ''}`} style={rfCondition === opt ? { borderColor: 'var(--green)', background: 'var(--green-light)', color: 'var(--green)', fontWeight: 500 } : {}} onClick={() => { setRfCondition(opt); armDraft() }}>{opt}</button>
                      ))}
                    </div>
                    <div className="fa-qs-row">
                      {['Low pitch', 'Medium pitch', 'Steep pitch'].map(opt => (
                        <button key={opt} className={`fa-qs-btn${rfPitch === opt ? ' qs-green' : ''}`} style={rfPitch === opt ? { borderColor: 'var(--green)', background: 'var(--green-light)', color: 'var(--green)', fontWeight: 500 } : {}} onClick={() => { setRfPitch(opt); armDraft() }}>{opt}</button>
                      ))}
                    </div>
                    {([
                      ['rf-penetrations', 'Penetrations', rfPenetrations, setRfPenetrations, 'Skylights, vents, ridge caps, valleys…'],
                      ['rf-insulation', 'Insulation', rfInsulation, setRfInsulation, 'Type and condition of insulation'],
                      ['rf-damage', 'Damage Description', rfDamage, setRfDamage, 'Describe damage to roof components…'],
                      ['rf-cause', 'Cause of Damage', rfCause, setRfCause, '• Primary Cause\n'],
                      ['rf-pre-exist', 'Pre-existing Conditions', rfPreExist, setRfPreExist, 'Yes / No — describe if yes'],
                      ['rf-other-cond', 'Other Conditions Noted', rfOtherCond, setRfOtherCond, 'Any other observations…'],
                      ['rf-maintenance', 'Maintenance Notes', rfMaintenance, setRfMaintenance, 'Unrelated maintenance items noted…'],
                    ] as [string, string, string, (v: string) => void, string][]).map(([id, label, val, setter, ph]) => (
                      <div key={id}>
                        <div className="fa-rr-section">{label}</div>
                        <div className="fa-rr-row">
                          <div className="fa-rr-value" style={{ padding: '10px 18px' }}>
                            <textarea
                              placeholder={ph}
                              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 15, lineHeight: 1.6, color: 'var(--text)', resize: 'vertical', minHeight: 40 }}
                              value={val}
                              onChange={e => { setter(e.target.value); armDraft() }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
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

      {/* ── 07 AI PRE-LEAVE REVIEW ───────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-review">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>07</div>
          <div className="fa-sc-meta"><h3>AI Pre-Leave Review</h3><p>Runs on submit · stay on site</p></div>
          <span className="fa-badge opt">On Submit</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}
          {isReviewing && (
            <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--muted)' }}>
              <span className="fa-spinner" style={{ borderColor: 'var(--muted)' }} /> Reviewing your inspection…
            </div>
          )}
          {!isReviewing && reviewScore === null && (
            <div style={{ padding: '16px 18px', textAlign: 'center', fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
              Review runs automatically on submit — stay on site until results appear (15–30 sec).
            </div>
          )}
          {!isReviewing && reviewScore !== null && !submitted && (
            <>
              {/* Score display */}
              <div style={{ background: 'var(--black)', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flexShrink: 0, textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-bebas-neue)', fontSize: 52, letterSpacing: 2, color: 'var(--beige)', lineHeight: 1 }}>{reviewScore}</div>
                  <div style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--beige-dark)', letterSpacing: 1, marginTop: 1 }}>OUT OF 10</div>
                </div>
                <div style={{ flex: 1, borderLeft: '1px solid rgba(200,184,154,.15)', paddingLeft: 16 }}>
                  <div style={{ fontFamily: 'var(--font-bebas-neue)', fontSize: 14, letterSpacing: 2, color: 'var(--beige)', marginBottom: 6 }}>AI Input Quality</div>
                  <div style={{ background: 'rgba(200,184,154,.12)', borderRadius: 2, height: 4, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', background: reviewScore >= 8 ? 'var(--green)' : reviewScore >= 5 ? 'var(--beige-dark)' : 'var(--red)', borderRadius: 2, width: `${reviewScore * 10}%`, transition: 'width .8s' }} />
                  </div>
                  {reviewSummary && <p style={{ fontSize: 11, color: 'var(--beige-dark)', lineHeight: 1.5 }}>{reviewSummary}</p>}
                </div>
              </div>
              {/* Flags */}
              <div style={{ paddingTop: 12 }}>
                {reviewFlags.map((f, i) => (
                  <div key={i} className={`fa-ai-flag ${f.type}`}>{f.type === 'ok' ? '✓ ' : '⚠ '}{f.msg}</div>
                ))}
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, padding: '12px 18px 16px' }}>
                <button className="fa-action-btn back" onClick={() => document.getElementById('sec-notes')?.scrollIntoView({ behavior: 'smooth' })}>← Go Back</button>
                <button className="fa-action-btn confirm" onClick={finalSubmit} disabled={isSubmitting}>
                  {isSubmitting ? <><span className="fa-spinner" style={{ borderColor: 'white' }} /> Submitting…</> : 'Looks Good ✓'}
                </button>
              </div>
            </>
          )}
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
