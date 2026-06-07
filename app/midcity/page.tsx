'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

type MidcityJob = {
  id: string
  job_number: string | null
  property_address: string | null
  created_at: string | null
  inspections: Array<{ id: string; start_time: string | null }>
}

type BulkJobEntry = {
  job_number: string
  property_address: string
  start_time: string
}

type BulkStep = 'upload' | 'parsing' | 'review' | 'creating'

function formatSectionDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatDisplayTime(startTime: string | null, createdAt: string | null): string {
  if (startTime?.trim()) return startTime.trim()
  if (!createdAt) return '—'
  return new Date(createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
}

export default function MidcityDashboard() {
  const router = useRouter()
  const [jobs, setJobs] = useState<MidcityJob[]>([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState<string | null>(null)

  // Single job modal
  const [showModal, setShowModal] = useState(false)
  const [jobNumber, setJobNumber] = useState('')
  const [address, setAddress] = useState('')
  const [time, setTime] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const jobNumberRef = useRef<HTMLInputElement>(null)

  // Bulk import modal
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkStep, setBulkStep] = useState<BulkStep>('upload')
  const [bulkJobs, setBulkJobs] = useState<BulkJobEntry[]>([])
  const [bulkError, setBulkError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
      if (!profile) { router.push('/login'); return }
      setTenantId(profile.tenant_id)
    }
    bootstrap()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tenantId) return
    fetchJobs(tenantId)
  }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showModal) setTimeout(() => jobNumberRef.current?.focus(), 100)
  }, [showModal])

  async function fetchJobs(tid: string) {
    setLoading(true)
    const { data } = await supabase
      .from('jobs')
      .select('id, job_number, property_address, created_at, inspections(id, start_time)')
      .eq('tenant_id', tid)
      .eq('insurer', 'Midcity')
      .order('created_at', { ascending: false })
    setJobs((data as unknown as MidcityJob[]) ?? [])
    setLoading(false)
  }

  // Group jobs by calendar day
  const grouped: Array<{ dateKey: string; jobs: MidcityJob[] }> = []
  for (const job of jobs) {
    const dateKey = job.created_at ? new Date(job.created_at).toDateString() : 'Unknown'
    const existing = grouped.find(g => g.dateKey === dateKey)
    if (existing) {
      existing.jobs.push(job)
    } else {
      grouped.push({ dateKey, jobs: [job] })
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!jobNumber.trim() || !address.trim()) return
    setCreating(true)
    setFormError('')
    try {
      const res = await fetch('/api/midcity/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_number: jobNumber, property_address: address, start_time: time || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error || 'Failed to create job')
        setCreating(false)
        return
      }
      setShowModal(false)
      setJobNumber('')
      setAddress('')
      setTime('')
      router.push(`/midcity/field/${data.inspectionId}`)
    } catch {
      setFormError('Network error — please try again')
      setCreating(false)
    }
  }

  function closeModal() {
    if (creating) return
    setShowModal(false)
    setFormError('')
  }

  // Bulk import handlers
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await parseSchedule(file)
  }

  async function parseSchedule(file: File) {
    setBulkStep('parsing')
    setBulkError('')

    const fd = new FormData()
    fd.append('file', file)

    try {
      const res = await fetch('/api/midcity/parse-schedule', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setBulkError(data.error || 'Failed to parse schedule')
        setBulkStep('upload')
        return
      }
      if (!data.jobs || data.jobs.length === 0) {
        setBulkError('No jobs found in this image. Try a clearer screenshot.')
        setBulkStep('upload')
        return
      }
      setBulkJobs(data.jobs)
      setBulkStep('review')
    } catch {
      setBulkError('Network error — please try again')
      setBulkStep('upload')
    }
  }

  function updateBulkJob(index: number, field: keyof BulkJobEntry, value: string) {
    setBulkJobs(prev => prev.map((j, i) => i === index ? { ...j, [field]: value } : j))
  }

  function removeBulkJob(index: number) {
    setBulkJobs(prev => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) setBulkStep('upload')
      return next
    })
  }

  async function handleBulkCreate() {
    const validJobs = bulkJobs.filter(j => j.job_number.trim() && j.property_address.trim())
    if (validJobs.length === 0) return
    setBulkStep('creating')
    setBulkError('')

    try {
      const res = await fetch('/api/midcity/bulk-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: validJobs }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBulkError(data.error || 'Failed to create jobs')
        setBulkStep('review')
        return
      }
      setShowBulkModal(false)
      setBulkStep('upload')
      setBulkJobs([])
      setBulkError('')
      if (tenantId) fetchJobs(tenantId)
    } catch {
      setBulkError('Network error — please try again')
      setBulkStep('review')
    }
  }

  function closeBulkModal() {
    if (bulkStep === 'parsing' || bulkStep === 'creating') return
    setShowBulkModal(false)
    setBulkStep('upload')
    setBulkJobs([])
    setBulkError('')
  }

  const canSubmit = jobNumber.trim().length > 0 && address.trim().length > 0
  const validBulkCount = bulkJobs.filter(j => j.job_number.trim() && j.property_address.trim()).length

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ee', fontFamily: 'var(--font-dm-sans), sans-serif' }}>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#1a1a1a', padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '2px solid #c8b89a',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-bebas-neue), sans-serif', fontSize: 22, letterSpacing: 3, color: '#c8b89a' }}>
            Bindi Co
          </div>
          <div style={{ fontFamily: 'var(--font-dm-mono), monospace', fontSize: 9, letterSpacing: 2, color: '#7a6f65', textTransform: 'uppercase' }}>
            Midcity Jobs
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Import from screenshot */}
          <button
            onClick={() => setShowBulkModal(true)}
            aria-label="Import schedule from screenshot"
            title="Import from screenshot"
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'transparent', border: '1.5px solid #c8b89a',
              color: '#c8b89a', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          {/* Add single job */}
          <button
            onClick={() => setShowModal(true)}
            aria-label="Add job"
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#c8b89a', border: 'none', color: '#1a1a1a',
              fontSize: 26, lineHeight: 1, fontWeight: 300,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Job list */}
      <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 32 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 56, color: '#7a6f65', fontSize: 13 }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 72 }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📋</div>
            <div style={{ fontSize: 17, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>No jobs yet</div>
            <div style={{ fontSize: 13, color: '#7a6f65' }}>Tap + to add your first Midcity job</div>
          </div>
        ) : (
          grouped.map(({ dateKey, jobs: dayJobs }) => (
            <div key={dateKey}>
              <div style={{
                padding: '16px 18px 6px',
                fontFamily: 'var(--font-dm-mono), monospace',
                fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#7a6f65',
              }}>
                {formatSectionDate(dateKey)}
              </div>
              {dayJobs.map(job => {
                const inspection = job.inspections?.[0]
                const displayTime = inspection
                  ? formatDisplayTime(inspection.start_time, job.created_at)
                  : formatDisplayTime(null, job.created_at)
                return (
                  <div
                    key={job.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => inspection && router.push(`/midcity/field/${inspection.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter' && inspection) router.push(`/midcity/field/${inspection.id}`) }}
                    style={{
                      margin: '5px 12px',
                      background: 'white',
                      borderRadius: 12,
                      padding: '14px 16px',
                      cursor: inspection ? 'pointer' : 'default',
                      boxShadow: '0 2px 8px rgba(0,0,0,.07)',
                      border: '1px solid #e8e4df',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{
                          fontFamily: 'var(--font-dm-mono), monospace',
                          fontSize: 12, fontWeight: 500, color: '#c8b89a',
                        }}>
                          {job.job_number ?? '—'}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-dm-mono), monospace',
                          fontSize: 10, color: '#b0a898',
                        }}>
                          {displayTime}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 14, color: '#1a1a1a',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {job.property_address ?? '—'}
                      </div>
                    </div>
                    <div style={{ color: '#c8b89a', fontSize: 20, flexShrink: 0 }}>›</div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Add Job Modal — bottom sheet */}
      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.45)',
            display: 'flex', alignItems: 'flex-end',
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div style={{
            background: 'white', width: '100%', maxWidth: 600, margin: '0 auto',
            borderRadius: '18px 18px 0 0', padding: '24px 20px 44px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div style={{
                fontFamily: 'var(--font-bebas-neue), sans-serif',
                fontSize: 22, letterSpacing: 2, color: '#1a1a1a',
              }}>
                New Midcity Job
              </div>
              <button
                onClick={closeModal}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#7a6f65', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block',
                  fontFamily: 'var(--font-dm-mono), monospace',
                  fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#7a6f65',
                  marginBottom: 7,
                }}>
                  Job Number <span style={{ color: '#c0622a' }}>*</span>
                </label>
                <input
                  ref={jobNumberRef}
                  type="text"
                  value={jobNumber}
                  onChange={e => setJobNumber(e.target.value)}
                  placeholder="e.g. MC1001"
                  required
                  style={{
                    width: '100%', padding: '13px 14px',
                    border: '1.5px solid #ddd5c8', borderRadius: 8,
                    fontSize: 16, fontFamily: 'inherit',
                    outline: 'none', background: '#faf8f5', color: '#1a1a1a',
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block',
                  fontFamily: 'var(--font-dm-mono), monospace',
                  fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#7a6f65',
                  marginBottom: 7,
                }}>
                  Property Address <span style={{ color: '#c0622a' }}>*</span>
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="123 Example St, Suburb NSW 2000"
                  required
                  style={{
                    width: '100%', padding: '13px 14px',
                    border: '1.5px solid #ddd5c8', borderRadius: 8,
                    fontSize: 16, fontFamily: 'inherit',
                    outline: 'none', background: '#faf8f5', color: '#1a1a1a',
                  }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: 'block',
                  fontFamily: 'var(--font-dm-mono), monospace',
                  fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#7a6f65',
                  marginBottom: 7,
                }}>
                  Time{' '}
                  <span style={{ color: '#b0a898', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    optional
                  </span>
                </label>
                <input
                  type="text"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  placeholder="e.g. 10:30am"
                  style={{
                    width: '100%', padding: '13px 14px',
                    border: '1.5px solid #ddd5c8', borderRadius: 8,
                    fontSize: 16, fontFamily: 'inherit',
                    outline: 'none', background: '#faf8f5', color: '#1a1a1a',
                  }}
                />
              </div>

              {formError && (
                <div style={{
                  marginBottom: 14, padding: '10px 14px',
                  background: '#fdf0f0', border: '1px solid #f0cdb0',
                  borderRadius: 6, fontSize: 13, color: '#a63030',
                }}>
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={creating || !canSubmit}
                style={{
                  width: '100%', padding: '16px 18px',
                  background: creating || !canSubmit ? '#ddd5c8' : '#1a1a1a',
                  color: creating || !canSubmit ? '#7a6f65' : '#c8b89a',
                  border: 'none', borderRadius: 8,
                  fontFamily: 'var(--font-bebas-neue), sans-serif',
                  fontSize: 20, letterSpacing: 3,
                  cursor: creating ? 'wait' : canSubmit ? 'pointer' : 'not-allowed',
                }}
              >
                {creating ? 'Creating…' : 'Create Job'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal — bottom sheet */}
      {showBulkModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.45)',
            display: 'flex', alignItems: 'flex-end',
          }}
          onClick={e => { if (e.target === e.currentTarget) closeBulkModal() }}
        >
          <div style={{
            background: 'white', width: '100%', maxWidth: 600, margin: '0 auto',
            borderRadius: '18px 18px 0 0',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          }}>
            {/* Modal header */}
            <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{
                  fontFamily: 'var(--font-bebas-neue), sans-serif',
                  fontSize: 22, letterSpacing: 2, color: '#1a1a1a',
                }}>
                  Import Schedule
                </div>
                <button
                  onClick={closeBulkModal}
                  disabled={bulkStep === 'parsing' || bulkStep === 'creating'}
                  style={{
                    background: 'none', border: 'none', fontSize: 22,
                    cursor: bulkStep === 'parsing' || bulkStep === 'creating' ? 'default' : 'pointer',
                    color: '#7a6f65', lineHeight: 1,
                    opacity: bulkStep === 'parsing' || bulkStep === 'creating' ? 0.4 : 1,
                  }}
                >
                  ✕
                </button>
              </div>
              {bulkStep === 'review' && (
                <div style={{
                  fontFamily: 'var(--font-dm-mono), monospace',
                  fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#7a6f65',
                  marginBottom: 16,
                }}>
                  {bulkJobs.length} job{bulkJobs.length !== 1 ? 's' : ''} found — review and confirm
                </div>
              )}
            </div>

            {/* Modal body (scrollable) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

              {/* Upload step */}
              {bulkStep === 'upload' && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    style={{ display: 'none' }}
                    onChange={handleFileSelected}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
                    style={{
                      border: '2px dashed #ddd5c8',
                      borderRadius: 12,
                      padding: '40px 24px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: '#faf8f5',
                    }}
                  >
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c8b89a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px', display: 'block' }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>
                      Tap to select screenshot
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-dm-mono), monospace',
                      fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#b0a898',
                    }}>
                      PNG · JPG · WEBP
                    </div>
                  </div>
                  {bulkError && (
                    <div style={{
                      marginTop: 14, padding: '10px 14px',
                      background: '#fdf0f0', border: '1px solid #f0cdb0',
                      borderRadius: 6, fontSize: 13, color: '#a63030',
                    }}>
                      {bulkError}
                    </div>
                  )}
                </>
              )}

              {/* Parsing step */}
              {bulkStep === 'parsing' && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{
                    width: 40, height: 40, margin: '0 auto 16px',
                    border: '3px solid #e8e4df',
                    borderTopColor: '#c8b89a',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500, marginBottom: 6 }}>
                    Parsing schedule…
                  </div>
                  <div style={{ fontSize: 12, color: '#7a6f65' }}>
                    Extracting jobs from your screenshot
                  </div>
                </div>
              )}

              {/* Review step */}
              {bulkStep === 'review' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {bulkJobs.map((job, i) => (
                    <div key={i} style={{
                      background: '#faf8f5',
                      border: '1.5px solid #ddd5c8',
                      borderRadius: 10,
                      padding: '12px 12px 12px 14px',
                    }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                          type="text"
                          value={job.job_number}
                          onChange={e => updateBulkJob(i, 'job_number', e.target.value)}
                          placeholder="Job #"
                          style={{
                            flex: '0 0 100px', padding: '8px 10px',
                            border: '1px solid #ddd5c8', borderRadius: 6,
                            fontSize: 13, fontFamily: 'var(--font-dm-mono), monospace',
                            background: 'white', color: '#1a1a1a', outline: 'none',
                          }}
                        />
                        <input
                          type="text"
                          value={job.start_time}
                          onChange={e => updateBulkJob(i, 'start_time', e.target.value)}
                          placeholder="Time"
                          style={{
                            flex: 1, padding: '8px 10px',
                            border: '1px solid #ddd5c8', borderRadius: 6,
                            fontSize: 13, fontFamily: 'var(--font-dm-mono), monospace',
                            background: 'white', color: '#1a1a1a', outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => removeBulkJob(i)}
                          style={{
                            flexShrink: 0, width: 32, height: 32,
                            background: 'none', border: '1px solid #ddd5c8',
                            borderRadius: 6, cursor: 'pointer',
                            color: '#b0a898', fontSize: 14,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      <input
                        type="text"
                        value={job.property_address}
                        onChange={e => updateBulkJob(i, 'property_address', e.target.value)}
                        placeholder="Property address"
                        style={{
                          width: '100%', padding: '8px 10px',
                          border: '1px solid #ddd5c8', borderRadius: 6,
                          fontSize: 13, fontFamily: 'inherit',
                          background: 'white', color: '#1a1a1a', outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ))}
                  {bulkError && (
                    <div style={{
                      padding: '10px 14px',
                      background: '#fdf0f0', border: '1px solid #f0cdb0',
                      borderRadius: 6, fontSize: 13, color: '#a63030',
                    }}>
                      {bulkError}
                    </div>
                  )}
                </div>
              )}

              {/* Creating step */}
              {bulkStep === 'creating' && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{
                    width: 40, height: 40, margin: '0 auto 16px',
                    border: '3px solid #e8e4df',
                    borderTopColor: '#c8b89a',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>
                    Creating jobs…
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            {(bulkStep === 'review') && (
              <div style={{ padding: '12px 20px 44px', flexShrink: 0, borderTop: '1px solid #f0ece7' }}>
                <button
                  onClick={handleBulkCreate}
                  disabled={validBulkCount === 0}
                  style={{
                    width: '100%', padding: '16px 18px',
                    background: validBulkCount === 0 ? '#ddd5c8' : '#1a1a1a',
                    color: validBulkCount === 0 ? '#7a6f65' : '#c8b89a',
                    border: 'none', borderRadius: 8,
                    fontFamily: 'var(--font-bebas-neue), sans-serif',
                    fontSize: 20, letterSpacing: 3,
                    cursor: validBulkCount === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  Create {validBulkCount} Job{validBulkCount !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
