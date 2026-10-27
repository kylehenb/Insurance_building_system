'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LOW_CONFIDENCE, MUD_MAP_LABEL, orderReportPhotos, photoKindOfLabel, VIEW_OF_PROPERTY_LABEL } from '@/lib/photos/report-order'
import { processPhotoForUpload } from './photo-convert'
import { UploadBanner } from './UploadBanner'
import { useFieldPhotos } from './useFieldPhotos'

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
  /** The signed-in user — the one who signs the safety section */
  currentUserName: string | null
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

interface SafetySignature { name: string; at: string }

function formatStamp(iso: string) {
  return new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// One list for the "Add a report" dropdown. Reports with both keys ask Internal or External when picked.
// internal = the panel filled in here; external = a trade asked to report (keys match the saved draft)
const REPORT_OPTIONS: { id: string; name: string; internal?: string; external?: string; extSub?: string }[] = [
  { id: 'make-safe', name: 'Make Safe', internal: 'make-safe', external: 'make-safe-ext', extSub: 'External trade' },
  { id: 'roof', name: 'Roof Report', internal: 'roof-report', external: 'roof-plumber', extSub: 'Roof plumber' },
  { id: 'leak', name: 'Leak Detection', internal: 'leak-detection', external: 'leak-plumber', extSub: 'Plumber' },
  { id: 'restoration', name: 'Restoration Assessment', internal: 'restoration', external: 'restoration-ext', extSub: 'Restoration trade' },
  { id: 'electrical', name: 'Electrical', external: 'electrical', extSub: 'Test + report' },
  { id: 'aircon', name: 'Air Conditioning', external: 'aircon', extSub: 'Report' },
  { id: 'fencing', name: 'Fencing / Gates', external: 'fencing', extSub: 'Report' },
  { id: 'asbestos', name: 'Asbestos Test', external: 'asbestos', extSub: 'Clearance report' },
  { id: 'structural', name: 'Structural Engineer', external: 'structural', extSub: 'Report' },
]
const INTERNAL_DOT: Record<string, string> = { 'make-safe': 'ms', 'roof-report': 'rr', 'leak-detection': 'ld', restoration: 're' }

// Roof photos upload at submit, a few at a time. (Inspection photos upload as they're added — see useFieldPhotos.)
async function uploadPhotoEntries(entries: { file: File; label: string; sequenceNumber: number; isRoofPhoto?: boolean }[], base: string, concurrency = 4) {
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++]
      const fd = new FormData()
      fd.append('file', entry.file)
      fd.append('label', entry.label)
      fd.append('sequenceNumber', String(entry.sequenceNumber))
      if (entry.isRoofPhoto) fd.append('isRoofPhoto', 'true')
      await fetch(`${base}/photos`, { method: 'POST', body: fd })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
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
  const [signature, setSignature] = useState<SafetySignature | null>(null)

  // ─── Scope ────────────────────────────────────────────────────────────────
  const [scopeRooms, setScopeRooms] = useState<ScopeRoom[]>([])

  // ─── Notes ────────────────────────────────────────────────────────────────
  const [raw_report_notes, setRawReportNotes] = useState('')

  // ─── Photos ───────────────────────────────────────────────────────────────
  const [aiLabeling, setAiLabeling] = useState(false)
  const [uploadDoneShown, setUploadDoneShown] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ─── Additional Reports ───────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<string | null>(null)
  // Internal reports added from the dropdown, in the order added
  const [internalReports, setInternalReports] = useState<string[]>([])
  // A report with both options waiting for Internal / External
  const [reportChoice, setReportChoice] = useState<string | null>(null)
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

  // ─── Signature ────────────────────────────────────────────────────────────
  // Tap to sign as the signed-in user; the stamp keeps who and when
  const signSafety = () => {
    setSignature({ name: initialData.currentUserName ?? initialData.inspector ?? 'Inspector', at: new Date().toISOString() })
    armDraft()
  }

  // ─── Draft Save/Restore ───────────────────────────────────────────────────
  const collectDraft = useCallback(() => ({
    raw_report_notes,
    customSafetyNotes, chips, safetyDone, commenceTime, step, signature, internalReports,
    scopeRooms: scopeRooms.map(r => ({ ...r, items: r.items.map(i => i.text) })),
    roofRawNotes, roofPhotoContext,
    msWorksCompleted, msTempFixes, msHours,
    ldMethod, ldSource, ldLocation, ldReadings, ldFindings,
    restType, restExtent, restRooms, restEquip, restNotes,
    extTrades, extTradeNotes,
  }), [raw_report_notes, customSafetyNotes, chips, safetyDone, commenceTime, step, signature, internalReports, scopeRooms, roofRawNotes, roofPhotoContext, msWorksCompleted, msTempFixes, msHours, ldMethod, ldSource, ldLocation, ldReadings, ldFindings, restType, restExtent, restRooms, restEquip, restNotes, extTrades, extTradeNotes])

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
    if (d.raw_report_notes) setRawReportNotes(d.raw_report_notes as string)
    if (d.customSafetyNotes) setCustomSafetyNotes(d.customSafetyNotes as string)
    if (d.chips) setChips(d.chips as typeof chips)
    if (d.commenceTime) setCommenceTime(d.commenceTime as string)
    if (d.safetyDone) setSafetyDone(true)
    if (d.signature) setSignature(d.signature as SafetySignature)
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
    if (Array.isArray(d.internalReports)) setInternalReports(d.internalReports as string[])
    else {
      // Drafts from before the dropdown: show any internal report that has something filled in
      const has = (...v: unknown[]) => v.some(x => typeof x === 'string' ? x.trim() : Array.isArray(x) ? x.some(Boolean) : x && Object.values(x as object).some(Boolean))
      setInternalReports([
        has(d.msWorksCompleted, d.msTempFixes, d.msHours) && 'make-safe',
        has(d.roofRawNotes, d.roofPhotoContext) && 'roof-report',
        has(d.ldMethod, d.ldSource, d.ldLocation, d.ldReadings, d.ldFindings) && 'leak-detection',
        has(d.restType, d.restExtent, d.restRooms, d.restEquip, d.restNotes) && 'restoration',
      ].filter((k): k is string => !!k))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const applyAllClear = () => {
    setChips({ general: true, ppe: true, asbestos: true, structural: true, roofPower: true, weather: true })
    armDraft()
  }

  const completeSafety = () => {
    if (!signature) { alert('Please tap to sign before confirming.'); return }
    const now = new Date()
    const ts = now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    setCommenceTime(ts)
    setSafetyDone(true)
    setStep(2)
    armDraft()
    setTimeout(() => document.getElementById('sec-scope')?.scrollIntoView({ behavior: 'smooth' }), 150)
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

  // Inspection photos: converted, saved on the phone and uploaded as they're added; labelled on the server
  const fieldPhotos = useFieldPhotos({ base, inspectionId: initialData.inspectionId, active: !submitted })
  const { photos, counts: photoCounts, busy: photosBusy } = fieldPhotos
  // Report order on screen: View of Property, then mud maps, then the rest as taken
  const shownPhotos = orderReportPhotos(photos)

  // The green "all uploaded" bar shows when a round of uploads finishes, until dismissed
  const wasBusy = useRef(false)
  useEffect(() => {
    if (photosBusy) { wasBusy.current = true; setUploadDoneShown(false) }
    else if (wasBusy.current) { wasBusy.current = false; setUploadDoneShown(true) }
  }, [photosBusy])

  // Leaving mid-upload: browsers that honour it warn first (iOS mostly doesn't — hence the bar)
  useEffect(() => {
    if (!photosBusy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [photosBusy])

  const handlePhotos = (files: FileList | null) => {
    if (!files?.length) return
    fieldPhotos.addFiles(files)
  }

  const runAILabels = async () => {
    if (!photos.length) { alert('No photos to label.'); return }
    setAiLabeling(true)
    try {
      // Save the notes first so the server labels with what's written so far
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      await fetch(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: collectDraft() }) })
      await fieldPhotos.relabelAll()
    } catch {
      alert('The photos couldn\'t be relabelled just now. Try again in a moment.')
    }
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

      const scopeRoomsPayload = scopeRooms.map(r => ({
        room: r.name,
        l: r.l, w: r.w, h: r.h,
        items: r.items.map(i => i.text).filter(Boolean),
      }))

      // Inspection photos upload as they're added: wait for any still going (the bar shows progress)
      if (!(await fieldPhotos.waitForUploads())) {
        alert('Some photos haven\'t uploaded yet. Check your connection, tap "Try again" on the bar at the top, then submit again.')
        setIsSubmitting(false)
        return
      }

      // Roof photos still go up now, numbered in their own report
      await uploadPhotoEntries(roofPhotos.map((p, i) => ({ file: p.file, label: p.label, sequenceNumber: i + 1, isRoofPhoto: true })), base)

      const res = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personMet: '',
          safetyData: {
            general: chips.general,
            ppe: chips.ppe,
            asbestos: chips.asbestos,
            structural: chips.structural,
            roofPower: chips.roofPower,
            weather: chips.weather,
            customNotes: customSafetyNotes,
            signedBy: signature?.name ?? initialData.inspector ?? '',
            signedAt: signature?.at ?? null,
          },
          scopeRooms: scopeRoomsPayload,
          rawReportDump: raw_report_notes,
          propDesc: '',
          insurer: initialData.insurer ?? '',
          lossType: initialData.lossType ?? '',
          roofRawNotes,
          roofPhotoContext,
          // The server finishes the labels with these notes, then orders and attaches the photos
          photoManifest: fieldPhotos.manifest(),
        }),
      })

      const data = await res.json()
      if (data.ok) {
        const now = new Date()
        const ts = now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        setSubmitTime(ts)
        setSubmitted(true)
        fieldPhotos.clearSaved()
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

  const addInternalReport = (key: string) => {
    setInternalReports(prev => prev.includes(key) ? prev : [...prev, key])
    setActivePanel(key)
    armDraft()
  }

  const addExternalReport = (key: string) => {
    setExtTrades(prev => ({ ...prev, [key]: true }))
    armDraft()
  }

  // Removing an internal report clears what was entered, so it isn't sent with the inspection
  const removeInternalReport = (key: string) => {
    const filled = {
      'make-safe': [msWorksCompleted, msTempFixes, msHours],
      'roof-report': [roofRawNotes, roofPhotoContext, roofPhotos.length ? 'photos' : ''],
      'leak-detection': [ldMethod, ldSource, ldLocation, ldFindings, ...ldReadings],
      restoration: [restType, restExtent, restRooms, restNotes, Object.values(restEquip).some(Boolean) ? 'equip' : ''],
    }[key]?.some(v => v.trim())
    if (filled && !confirm('Remove this report? What you\'ve entered for it will be cleared.')) return
    if (key === 'make-safe') { setMsWorksCompleted(''); setMsTempFixes(''); setMsHours('') }
    if (key === 'roof-report') {
      roofPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl))
      setRoofRawNotes(''); setRoofPhotoContext(''); setRoofPhotos([]); setRoofAiLabelDone(false)
    }
    if (key === 'leak-detection') { setLdMethod(''); setLdSource(''); setLdLocation(''); setLdReadings(['', '', '']); setLdFindings('') }
    if (key === 'restoration') {
      setRestType(''); setRestExtent(''); setRestRooms(''); setRestNotes('')
      setRestEquip({ dehumidifiers: false, airMovers: false, airScrubbers: false, dryingMats: false })
    }
    setInternalReports(prev => prev.filter(k => k !== key))
    setActivePanel(prev => prev === key ? null : prev)
    armDraft()
  }

  const removeExternalReport = (key: string) => {
    setExtTrades(prev => ({ ...prev, [key]: false }))
    armDraft()
  }

  const pickReport = (id: string) => {
    const opt = REPORT_OPTIONS.find(o => o.id === id)
    if (!opt) return
    const internalFree = opt.internal && !internalReports.includes(opt.internal)
    const externalFree = opt.external && !extTrades[opt.external]
    if (internalFree && externalFree) { setReportChoice(id); return }
    if (internalFree) addInternalReport(opt.internal!)
    else if (externalFree) addExternalReport(opt.external!)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const stepLabels = ['', 'Safety', 'Scope', 'Notes', 'Photos', 'Reports', '']

  return (
    <div className="fa-root">
      {!submitted && (
        <UploadBanner
          total={photoCounts.total}
          saved={photoCounts.saved}
          uploaded={photoCounts.uploaded}
          failed={photoCounts.failed}
          busy={photosBusy}
          online={fieldPhotos.online}
          done={uploadDoneShown}
          onDismissDone={() => setUploadDoneShown(false)}
          onRetry={fieldPhotos.retryFailed}
        />
      )}

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
        {[1, 2, 3, 4, 5].map(i => (
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
                {signature ? (
                  <div className="fa-sig-stamp">
                    <div className="fa-sig-name">{signature.name}</div>
                    <div className="fa-sig-meta">✓ Signed electronically · {formatStamp(signature.at)}</div>
                    <button className="fa-sig-clear" onClick={() => { setSignature(null); armDraft() }}>Undo</button>
                  </div>
                ) : (
                  <button className="fa-sig-btn" onClick={signSafety}>
                    ✍ Tap to sign as {initialData.currentUserName ?? initialData.inspector ?? 'Inspector'}
                  </button>
                )}
              </div>
              {/* Confirm Button */}
              <div style={{ padding: '0 18px 18px' }}>
                <button
                  onClick={completeSafety}
                  style={{ width: '100%', padding: '15px 18px', background: signature ? '#4a7c59' : 'var(--line-tan-2)', color: signature ? 'white' : 'var(--grey-500)', border: 'none', borderRadius: 6, fontFamily: 'var(--font-bebas-neue), sans-serif', fontSize: 20, letterSpacing: '3px', cursor: signature ? 'pointer' : 'not-allowed' }}
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
                  {signature && <p>Signed by {signature.name} · {formatStamp(signature.at)}</p>}
                </div>
                <button className="fa-sc-edit" onClick={() => setSafetyDone(false)}>Edit</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 02 SCOPE NOTES ───────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-scope">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>02</div>
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

      {/* ── 03 REPORT NOTES ──────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-notes">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>03</div>
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
              {['Who you met', 'Property description', 'What was damaged', 'Cause of damage', 'Pre-existing conditions', 'Any maintenance noted', 'Extent of damage', 'Structural concerns'].map(hint => (
                <div key={hint} className="fa-ai-hint">{hint}</div>
              ))}
            </div>
            <div className="fa-ai-dark-body">
              <textarea
                className="fa-ai-dark-ta"
                placeholder="Dictate your raw notes here — who you met on site, property description, damage description, cause, and your findings. AI will structure this into a professional report…"
                style={{ minHeight: 130 }}
                value={raw_report_notes}
                onChange={e => { setRawReportNotes(e.target.value); armDraft() }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 04 PHOTOS ────────────────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-photos">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>04</div>
          <div className="fa-sc-meta"><h3>Photos</h3><p>Upload · label with AI</p></div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}
          {/* AI labels: the server looks at each photo as it uploads */}
          <div className="fa-ai-dark" style={{ marginBottom: 0 }}>
            <div className="fa-ai-dark-head">
              <span style={{ fontSize: 14 }}>📷</span>
              <span className="fa-ai-dark-title">AI Photo Labelling</span>
            </div>
            <div className="fa-ai-dark-body">
              <p style={{ fontSize: 11, color: 'var(--beige-dark)', margin: '0 0 10px' }}>
                Photos are labelled automatically as they upload, and finished with your notes when you submit. The View of Property goes first, then the mud maps / floor plans. Labels in orange are worth a check.
              </p>
              {photoCounts.uploaded > 0 && (
                <p className="fa-ai-status">
                  {fieldPhotos.awaitingLabels
                    ? `Labelling on the server · ${photoCounts.labelled} of ${photoCounts.uploaded}`
                    : `${photoCounts.labelled} of ${photoCounts.uploaded} photos labelled`}
                </p>
              )}
              <button
                className="fa-ai-label-btn"
                onClick={runAILabels}
                disabled={aiLabeling || photosBusy || !photoCounts.uploaded}
              >
                {aiLabeling ? <><span className="fa-spinner" /> Asking…</> : '✦ Re-label All Photos With My Notes'}
              </button>
            </div>
          </div>
          {/* Photo Grid */}
          <div className="fa-photo-grid">
            {shownPhotos.map(photo => {
              const preparing = photo.status === 'waiting' || photo.status === 'converting'
              const unsure = photo.labelSource === 'ai' && !!photo.ai &&
                Math.min(photo.ai.confidence, photo.ai.kind === 'other' ? photo.ai.roomConfidence ?? 1 : 1) < LOW_CONFIDENCE
              return (
                <div key={photo.id} className="fa-photo-card">
                  {photo.previewUrl
                    ? <img className="fa-photo-thumb" src={photo.previewUrl} alt="inspection" loading="lazy" />
                    : <div className="fa-photo-thumb-ph">📷</div>}
                  {preparing && (
                    <div className="fa-photo-status">
                      <span className="fa-spinner" style={{ borderColor: 'var(--beige)', borderTopColor: 'transparent', width: 22, height: 22 }} />
                      <span>{photo.status === 'converting' ? 'Preparing…' : 'Waiting…'}</span>
                    </div>
                  )}
                  {!preparing && (
                    <span className={`fa-photo-badge${photo.status === 'uploaded' ? ' up' : ''}`}>
                      {photo.status === 'uploaded' ? '✓ Uploaded' : photo.status === 'failed' ? 'Not uploaded' : 'Uploading'}
                    </span>
                  )}
                  {!preparing && <button className="fa-photo-del" onClick={() => fieldPhotos.remove(photo.id)}>×</button>}
                  <div className="fa-photo-label-area">
                    <textarea
                      className={`fa-photo-label-ta${unsure ? ' check' : ''}`}
                      rows={1}
                      placeholder={preparing ? 'Preparing…' : photo.status === 'uploaded' && photo.aiStatus !== 'done' ? 'AI label coming…' : 'Add label'}
                      value={photo.label}
                      disabled={preparing}
                      onChange={e => fieldPhotos.setLabel(photo.id, e.target.value)}
                    />
                    {unsure && <div className="fa-photo-check">Check this label</div>}
                    {!preparing && (
                      <div className="fa-photo-tags">
                        {([[VIEW_OF_PROPERTY_LABEL, 'view_of_property', 'Front view'], [MUD_MAP_LABEL, 'mud_map', 'Mud map']] as const).map(([tag, kind, text]) => (
                          <button
                            key={tag}
                            type="button"
                            className={`fa-photo-tag${photoKindOfLabel(photo.label) === kind ? ' on' : ''}`}
                            onClick={() => fieldPhotos.tagPhoto(photo.id, tag)}
                          >
                            {text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
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

      {/* ── 05 ADDITIONAL REPORTS ─────────────────────────────────────────── */}
      <div className={`fa-sc${safetyDone ? '' : ' locked'}`} id="sec-reports">
        <div className="fa-sc-head">
          <div className={`fa-sc-circle${safetyDone ? ' active' : ' pending'}`}>05</div>
          <div className="fa-sc-meta"><h3>Additional Reports</h3><p>Internal reports · external trade reports</p></div>
          <span className="fa-badge opt">Optional</span>
        </div>
        <div className="fa-sc-body">
          {!safetyDone && <div className="fa-lock-notice">🔒 Complete safety section to unlock</div>}

          {/* Add a report */}
          <div className="fa-fg" style={{ paddingTop: 14, marginBottom: 10 }}>
            <select
              className="fa-input fa-report-select"
              value=""
              onChange={e => pickReport(e.target.value)}
            >
              <option value="" disabled>+ Add a report…</option>
              {REPORT_OPTIONS.map(o => {
                const used = (!o.internal || internalReports.includes(o.internal)) && (!o.external || !!extTrades[o.external])
                return <option key={o.id} value={o.id} disabled={used}>{o.name}</option>
              })}
            </select>
            {reportChoice && (() => {
              const opt = REPORT_OPTIONS.find(o => o.id === reportChoice)!
              return (
                <div className="fa-report-choice">
                  <div className="fa-report-choice-q">{opt.name} — internal or external?</div>
                  <div className="fa-rg inline">
                    <button className="fa-ro" onClick={() => { addInternalReport(opt.internal!); setReportChoice(null) }}>Internal</button>
                    <button className="fa-ro" onClick={() => { addExternalReport(opt.external!); setReportChoice(null) }}>External</button>
                  </div>
                  <button className="fa-sig-clear" onClick={() => setReportChoice(null)}>Cancel</button>
                </div>
              )
            })()}
          </div>

          {/* Internal reports added */}
          <div>
            {internalReports.map(key => ({ key, dot: INTERNAL_DOT[key], name: REPORT_OPTIONS.find(o => o.internal === key)?.name ?? key })).map(({ key, dot, name }) => (
              <div key={key}>
                <div
                  className={`fa-ar-item${activePanel === key ? ' active' : ''}`}
                  onClick={() => togglePanel(key)}
                >
                  <div className={`fa-ar-dot ${dot}`} />
                  <div className="fa-ar-info">
                    <div className="fa-ar-name">{name}</div>
                    <div className="fa-ar-sub">Internal · {activePanel === key ? 'tap to collapse' : 'tap to open'}</div>
                  </div>
                  <button className="fa-ar-remove" aria-label={`Remove ${name}`} onClick={e => { e.stopPropagation(); removeInternalReport(key) }}>×</button>
                </div>

                {/* Make Safe Panel */}
                {key === 'make-safe' && activePanel === 'make-safe' && (
                  <div className="fa-internal-panel fa-panel-ms">
                    <div className="fa-panel-title">🚨 Make Safe <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>Fields</span></div>
                    <div style={{ padding: '14px 18px' }}>
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

          {/* External trade reports added — a work order request goes with the inspection */}
          {REPORT_OPTIONS.filter(o => o.external && extTrades[o.external]).map(o => (
            <div key={o.external} className="fa-ext-added">
              <div className="fa-ext-item checked">
                <div className="fa-ext-info">
                  <div className="fa-ext-name">{o.name}</div>
                  <div className="fa-ext-sub">External · {o.extSub}</div>
                </div>
                <button className="fa-ar-remove" aria-label={`Remove ${o.name}`} onClick={() => removeExternalReport(o.external!)}>×</button>
              </div>
              <div style={{ padding: '0 18px 10px' }}>
                <textarea className="fa-ta" style={{ minHeight: 60, fontSize: 14 }} placeholder="Scope / instructions for this trade…" value={extTradeNotes[o.external!] ?? ''} onChange={e => { setExtTradeNotes(prev => ({ ...prev, [o.external!]: e.target.value })); armDraft() }} />
              </div>
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
            disabled={!safetyDone || isSubmitting}
          >
            {isSubmitting ? (photosBusy ? 'Waiting for photos…' : 'Submitting…') : 'Submit Inspection'}
          </button>
        </div>
      )}
    </div>
  )
}
