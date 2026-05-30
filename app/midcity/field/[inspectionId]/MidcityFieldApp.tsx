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

async function processPhotoForUpload(file: File): Promise<File> {
  const TARGET_BYTES = 500 * 1024
  const MAX_DIM = 2048

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
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const compress = (quality: number) => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return }
          if (blob.size > TARGET_BYTES && quality > 0.55) { compress(Math.round((quality - 0.08) * 100) / 100); return }
          const baseName = file.name.replace(/\.(heic|heif)$/i, '')
          const jpegName = baseName.match(/\.(jpe?g)$/i) ? file.name : `${baseName}.jpg`
          resolve(new File([blob], jpegName, { type: 'image/jpeg', lastModified: Date.now() }))
        }, 'image/jpeg', quality)
      }
      compress(0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file) }
    img.src = objUrl
  })
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MidcityFieldApp({ initialData }: { initialData: InitialData }) {
  const base = `/api/field/${initialData.inspectionId}`

  // ─── Common fields ────────────────────────────────────────────────────────
  const [personMet, setPersonMet] = useState(initialData.personMet ?? initialData.insuredName ?? '')
  const [relation, setRelation] = useState('')
  const [propDesc, setPropDesc] = useState('')

  // ─── Report enable states (pill checkboxes) ───────────────────────────────
  const [barEnabled, setBarEnabled] = useState(false)
  const [makeSafeEnabled, setMakeSafeEnabled] = useState(false)
  const [roofEnabled, setRoofEnabled] = useState(false)

  // ─── BAR fields ───────────────────────────────────────────────────────────
  const [scopeRooms, setScopeRooms] = useState<ScopeRoom[]>([])
  const [rawReportNotes, setRawReportNotes] = useState('')

  // ─── Make Safe fields ─────────────────────────────────────────────────────
  const [msWorksCompleted, setMsWorksCompleted] = useState('')
  const [msTempFixes, setMsTempFixes] = useState('')
  const [msHours, setMsHours] = useState('')

  // ─── Roof Report fields ───────────────────────────────────────────────────
  const [roofRawNotes, setRoofRawNotes] = useState('')
  const [roofPhotos, setRoofPhotos] = useState<PhotoEntry[]>([])
  const [roofPhotoContext, setRoofPhotoContext] = useState('')
  const [roofAiLabeling, setRoofAiLabeling] = useState(false)
  const [roofAiLabelDone, setRoofAiLabelDone] = useState(false)
  const roofPhotoInputRef = useRef<HTMLInputElement>(null)

  // ─── Save / export state ─────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState('')
  const [barExporting, setBarExporting] = useState(false)
  const [makeSafeExporting, setMakeSafeExporting] = useState(false)
  const [roofExporting, setRoofExporting] = useState(false)

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocusRoomRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingFocusRoomRef.current) return
    const roomId = pendingFocusRoomRef.current
    pendingFocusRoomRef.current = null
    setTimeout(() => {
      const inputs = document.querySelectorAll(`[data-room-id="${roomId}"] .fa-scope-input`)
      ;(inputs[inputs.length - 1] as HTMLInputElement | undefined)?.focus()
    }, 0)
  }, [scopeRooms])

  function focusNextInput(current: HTMLElement) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="file"]):not([type="hidden"]), textarea:not([disabled])'
    ))
    const idx = all.indexOf(current)
    if (idx >= 0 && idx < all.length - 1) all[idx + 1].focus()
  }

  // ─── Draft Save/Restore ───────────────────────────────────────────────────
  const collectDraft = useCallback(() => ({
    personMet, relation, propDesc,
    barEnabled, makeSafeEnabled, roofEnabled,
    scopeRooms: scopeRooms.map(r => ({ ...r, items: r.items.map(i => i.text) })),
    rawReportNotes,
    msWorksCompleted, msTempFixes, msHours,
    roofRawNotes, roofPhotoContext,
  }), [personMet, relation, propDesc, barEnabled, makeSafeEnabled, roofEnabled, scopeRooms, rawReportNotes, msWorksCompleted, msTempFixes, msHours, roofRawNotes, roofPhotoContext])

  const armDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: collectDraft() }) })
        setSaveStatus('Saved')
        setTimeout(() => setSaveStatus(''), 2000)
      } catch { setSaveStatus('Save failed') }
    }, 3000)
  }, [base, collectDraft])

  useEffect(() => {
    const flush = () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      const blob = new Blob([JSON.stringify({ draft: collectDraft() })], { type: 'application/json' })
      navigator.sendBeacon(`${base}/draft`, blob)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [base, collectDraft])

  useEffect(() => {
    const d = initialData.fieldDraft as Record<string, unknown> | null
    if (!d) return
    if (d.personMet) setPersonMet(d.personMet as string)
    if (d.relation) setRelation(d.relation as string)
    if (d.propDesc) setPropDesc(d.propDesc as string)
    if (d.barEnabled) setBarEnabled(d.barEnabled as boolean)
    if (d.makeSafeEnabled) setMakeSafeEnabled(d.makeSafeEnabled as boolean)
    if (d.roofEnabled) setRoofEnabled(d.roofEnabled as boolean)
    if (d.rawReportNotes) setRawReportNotes(d.rawReportNotes as string)
    if (d.msWorksCompleted) setMsWorksCompleted(d.msWorksCompleted as string)
    if (d.msTempFixes) setMsTempFixes(d.msTempFixes as string)
    if (d.msHours) setMsHours(d.msHours as string)
    if (d.roofRawNotes) setRoofRawNotes(d.roofRawNotes as string)
    if (d.roofPhotoContext) setRoofPhotoContext(d.roofPhotoContext as string)
    if (d.scopeRooms) {
      const rooms = (d.scopeRooms as Array<{ id?: string; name: string; l: string; w: string; h: string; items: string[] }>)
      setScopeRooms(rooms.map(r => ({ id: r.id ?? uid(), name: r.name, l: r.l, w: r.w, h: r.h, items: r.items.map(text => ({ id: uid(), text })) })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Room helpers ─────────────────────────────────────────────────────────
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

  // ─── Roof photo helpers ───────────────────────────────────────────────────
  const handleRoofPhotos = (files: FileList | null) => {
    if (!files) return
    setRoofAiLabelDone(false)
    Array.from(files).forEach(file => {
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
  }

  const removeRoofPhoto = (id: string) => {
    setRoofPhotos(prev => {
      const p = prev.find(x => x.id === id)
      if (p) URL.revokeObjectURL(p.previewUrl)
      return prev.filter(x => x.id !== id)
    })
    armDraft()
  }

  const runRoofAILabels = async () => {
    if (!roofPhotoContext.trim()) { alert('Add a photo description first.'); return }
    if (!roofPhotos.length) { alert('No photos to label.'); return }
    if (roofPhotos.some(p => p.processing)) { alert('Photos are still processing — please wait a moment.'); return }
    setRoofAiLabeling(true)
    try {
      const res = await fetch(`${base}/ai-label-roof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: roofPhotoContext, photoCount: roofPhotos.length, jobContext: { lossType: initialData.lossType, insurer: 'Midcity', address: initialData.address } }),
      })
      const data = await res.json()
      if (data.ok && data.labels?.length) {
        setRoofPhotos(prev => prev.map((p, i) => ({ ...p, label: data.labels[i] ?? p.label })))
        setRoofAiLabelDone(true)
      }
    } catch { /* keep existing labels */ }
    setRoofAiLabeling(false)
  }

  // ─── Export handlers (wired up separately) ────────────────────────────────
  const handleExportBAR = async () => {
    setBarExporting(true)
    // TODO: wire up BAR export
    setBarExporting(false)
  }

  const handleExportMakeSafe = async () => {
    setMakeSafeExporting(true)
    // TODO: wire up Make Safe export
    setMakeSafeExporting(false)
  }

  const handleExportRoof = async () => {
    setRoofExporting(true)
    // TODO: wire up Roof Report export — upload roof photos first
    for (const photo of roofPhotos) {
      const fd = new FormData()
      fd.append('file', photo.file)
      fd.append('label', photo.label)
      fd.append('isRoofPhoto', 'true')
      await fetch(`${base}/photos`, { method: 'POST', body: fd })
    }
    setRoofExporting(false)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fa-root">

      {/* HEADER */}
      <div className="fa-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="fa-logo"><span>MC</span></div>
          <div className="fa-job-pill">{initialData.jobNumber ?? '—'}</div>
        </div>
        <div className="fa-hdr-right">
          Midcity · {initialData.jobNumber ?? '—'}
          <br />
          <span style={{ fontSize: 9 }}>
            {initialData.inspectionRef ?? initialData.inspectionId} · {formatDate(initialData.scheduledDate)}
          </span>
          {saveStatus && <div className="fa-save-indicator">{saveStatus}</div>}
        </div>
      </div>

      {/* JOB BANNER */}
      <div className="fa-banner">
        <div className="fa-bgrid">
          <div className="fa-bf full"><label>Property</label><span>{initialData.address ?? '—'}</span></div>
          <div className="fa-bf"><label>Client</label><span>Midcity</span></div>
          <div className="fa-bf"><label>Inspector</label><span>{initialData.inspector ?? '—'}</span></div>
          {initialData.scheduledTime && (
            <div className="fa-bf"><label>Time</label><span>{initialData.scheduledTime}</span></div>
          )}
          {initialData.lossType && (
            <div className="fa-bf"><label>Loss Type</label><span>{initialData.lossType}</span></div>
          )}
          {initialData.dateOfLoss && (
            <div className="fa-bf"><label>Date of Loss</label><span>{formatDate(initialData.dateOfLoss)}</span></div>
          )}
        </div>
        <div className="fa-type-badge">Midcity</div>
      </div>

      {/* ── 01 SITE DETAILS ───────────────────────────────────────────────── */}
      <div className="fa-sc" id="sec-details">
        <div className="fa-sc-head">
          <div className="fa-sc-circle active">01</div>
          <div className="fa-sc-meta">
            <h3>Site Details</h3>
            <p>Person met · property description</p>
          </div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          <div style={{ padding: '16px 0' }}>
            <div className="fa-fg">
              <label className="fa-fl">Person Met On Site <span className="req">*</span></label>
              <input
                className="fa-input"
                type="text"
                value={personMet}
                onChange={e => { setPersonMet(e.target.value); armDraft() }}
                placeholder="Full name"
                enterKeyHint="next"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }}
              />
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

      {/* ── 02 REPORTS ───────────────────────────────────────────────────── */}
      <div className="fa-sc" id="sec-reports">
        <div className="fa-sc-head">
          <div className="fa-sc-circle active">02</div>
          <div className="fa-sc-meta">
            <h3>Reports</h3>
            <p>Tick to activate · complete · export</p>
          </div>
        </div>
        <div className="fa-sc-body">
          <div className="mc-pills-wrap">

            {/* ── BAR ────────────────────────────────────────────────────── */}
            <div className={`mc-pill${barEnabled ? ' enabled' : ''}`}>
              <div className="mc-pill-header" onClick={() => { setBarEnabled(p => !p); armDraft() }}>
                <div className="mc-pill-check">{barEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Building Assessment Report</div>
                  <div className="mc-pill-sub">BAR · Scope notes + damage assessment</div>
                </div>
                <div className="mc-pill-arrow">{barEnabled ? '▾' : '›'}</div>
              </div>

              {barEnabled && (
                <div className="mc-pill-body">

                  {/* Scope Notes */}
                  <div className="mc-section-head">Scope Notes</div>
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
                      <button onClick={addRoom} className="mc-add-room-btn">+ Add Room</button>
                    </div>
                  </div>

                  {/* Raw Report Notes */}
                  <div className="mc-section-head">Report Notes</div>
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
                        value={rawReportNotes}
                        onChange={e => { setRawReportNotes(e.target.value); armDraft() }}
                      />
                    </div>
                  </div>

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportBAR}
                      disabled={barExporting}
                    >
                      {barExporting ? <><span className="fa-spinner" /> Exporting…</> : 'Export Report'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── MAKE SAFE ────────────────────────────────────────────────── */}
            <div className={`mc-pill${makeSafeEnabled ? ' enabled' : ''}`}>
              <div className="mc-pill-header" onClick={() => { setMakeSafeEnabled(p => !p); armDraft() }}>
                <div className="mc-pill-check">{makeSafeEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Make Safe</div>
                  <div className="mc-pill-sub">Emergency works completed on site</div>
                </div>
                <div className="mc-pill-arrow">{makeSafeEnabled ? '▾' : '›'}</div>
              </div>

              {makeSafeEnabled && (
                <div className="mc-pill-body">
                  <div className="mc-section-head">Make Safe Fields</div>
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

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportMakeSafe}
                      disabled={makeSafeExporting}
                    >
                      {makeSafeExporting ? <><span className="fa-spinner" /> Exporting…</> : 'Export Report'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── ROOF REPORT ──────────────────────────────────────────────── */}
            <div className={`mc-pill${roofEnabled ? ' enabled' : ''}`} style={{ marginBottom: 8 }}>
              <div className="mc-pill-header" onClick={() => { setRoofEnabled(p => !p); armDraft() }}>
                <div className="mc-pill-check">{roofEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Roof Report</div>
                  <div className="mc-pill-sub">Roof-specific inspection and assessment</div>
                </div>
                <div className="mc-pill-arrow">{roofEnabled ? '▾' : '›'}</div>
              </div>

              {roofEnabled && (
                <div className="mc-pill-body">
                  <div className="mc-section-head">Roof Report</div>

                  {/* Raw Notes */}
                  <div className="fa-ai-dark">
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

                  {/* Photo Context */}
                  <div className="fa-ai-dark" style={{ marginTop: 2 }}>
                    <div className="fa-ai-dark-head">
                      <span style={{ fontSize: 14 }}>📷</span>
                      <span className="fa-ai-dark-title">Roof Photo Context</span>
                    </div>
                    <div className="fa-ai-dark-body">
                      <textarea
                        className="fa-ai-dark-ta"
                        placeholder="Describe your roof photos in order…"
                        style={{ minHeight: 80 }}
                        value={roofPhotoContext}
                        onChange={e => { setRoofPhotoContext(e.target.value); armDraft() }}
                      />
                      <button
                        className={`fa-ai-label-btn${roofAiLabelDone ? ' done' : ''}`}
                        onClick={runRoofAILabels}
                        disabled={roofAiLabeling || roofPhotos.some(p => p.processing)}
                      >
                        {roofPhotos.some(p => p.processing)
                          ? <><span className="fa-spinner" /> Converting photos…</>
                          : roofAiLabeling
                          ? <><span className="fa-spinner" /> Labelling…</>
                          : roofAiLabelDone
                          ? '✓ Labels Applied'
                          : '✦ AI Label All Photos'}
                      </button>
                    </div>
                  </div>

                  {/* Roof Photos */}
                  <div className="fa-photo-grid">
                    {roofPhotos.map(photo => (
                      <div key={photo.id} className="fa-photo-card">
                        <img className="fa-photo-thumb" src={photo.previewUrl} alt="roof inspection" />
                        {photo.processing && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(44,26,14,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <span className="fa-spinner" style={{ borderColor: 'var(--beige)', borderTopColor: 'transparent', width: 22, height: 22 }} />
                            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, color: 'var(--beige)', letterSpacing: 1 }}>Converting…</span>
                          </div>
                        )}
                        {!photo.processing && <button className="fa-photo-del" onClick={() => removeRoofPhoto(photo.id)}>×</button>}
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
                    <button type="button" onClick={() => roofPhotoInputRef.current?.click()} className="fa-upload-slot">
                      <span style={{ fontSize: 24 }}>📷</span>
                      <span>Add Photo</span>
                    </button>
                    <input
                      ref={roofPhotoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => handleRoofPhotos(e.target.files)}
                    />
                  </div>

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportRoof}
                      disabled={roofExporting}
                    >
                      {roofExporting ? <><span className="fa-spinner" /> Exporting…</> : 'Export Report'}
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>
  )
}
