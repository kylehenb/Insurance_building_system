'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// ── Types ──────────────────────────────────────────────────────────────────

interface JobDetails {
  job_number: string
  insured_name: string | null
  property_address: string | null
  status: string
  insurer: string | null
  claim_number: string | null
  loss_type: string | null
  date_of_loss: string | null
  adjuster: string | null
  excess: number | null
  sum_insured: number | null
  assigned_to: string | null
  created_at: string
  insured_phone: string | null
  insured_email: string | null
  additional_contacts: string | null
  claim_description: string | null
  special_instructions: string | null
  notes: string | null
}

interface ActionCard {
  id: string
  job_id: string
  job_number: string
  rule_key: string
  title: string
  description: string | null
  ai_draft: Record<string, unknown> | null
  status: string
  priority: number
  created_at: string
  type: string
}

interface CommEntry {
  id: string
  type: string
  direction: string | null
  contact_name: string | null
  content: string | null
  created_at: string
}

interface CalendarEvent {
  date: string
  label: string
  color: string
}

interface OverviewTabProps {
  jobId: string
  tenantId: string
  job: JobDetails
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(v: number | null) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function formatDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatRelativeTime(s: string) {
  const diff = Date.now() - new Date(s).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return formatDate(s)
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}hr${h > 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

function inferCardType(ruleKey: string): string {
  if (ruleKey.includes('email') || ruleKey.includes('comms') || ruleKey.includes('notify')) return 'comms'
  if (ruleKey.includes('quote') || ruleKey.includes('approval')) return 'quote'
  if (ruleKey.includes('status')) return 'status'
  if (ruleKey.includes('alert')) return 'notification'
  return 'task'
}

const COMM_COLORS: Record<string, string> = {
  email: '#1a73e8',
  sms: '#2e7d32',
  note: '#b45309',
}

function commInitial(type: string) {
  return type.charAt(0).toUpperCase()
}

// ── Shared CSS ─────────────────────────────────────────────────────────────

const OVERVIEW_CSS = `
  .ov-detail-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 0.5px solid #f0ece6; }
  .ov-detail-row:last-child { border-bottom: none; }
  .ov-detail-label { width: 120px; flex-shrink: 0; font-size: 12px; color: #9e998f; }
  .ov-detail-value { font-size: 13px; color: #3a3530; }

  .aq-list { display: flex; flex-direction: column; gap: 10px; }
  .aq-card { background: #fff; border: 0.5px solid #e4dfd8; border-radius: 8px; overflow: hidden; transition: border-color 0.2s, opacity 0.35s, max-height 0.5s; }
  .aq-card:hover { border-color: #d0cbc4; }
  .aq-card.snoozed { opacity: 0.45; }
  .aq-card.removing { opacity: 0; max-height: 0; }
  .aq-row { display: grid; grid-template-columns: minmax(0,1.1fr) 1px minmax(0,1fr); }
  .aq-div { background: #ede8e2; }
  .aq-left { padding: 15px 16px; display: flex; gap: 10px; }
  .aq-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 7px; }
  .dot-hi { background: #d4524a; } .dot-md { background: #d4924a; } .dot-lo { background: #5a9a52; }
  .aq-body { flex: 1; min-width: 0; }
  .aq-type { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #c8b89a; margin-bottom: 4px; font-weight: 400; }
  .aq-title { font-size: 13px; font-weight: 500; color: #1a1a1a; margin-bottom: 4px; line-height: 1.3; }
  .aq-desc { font-size: 12px; color: #7a7167; line-height: 1.55; font-weight: 300; }
  .aq-meta { display: flex; gap: 12px; margin-top: 8px; }
  .aq-job { font-family: 'DM Mono', monospace; font-size: 10px; color: #c8b89a; }
  .aq-age { font-size: 10px; color: #c8c0b8; font-weight: 300; }
  .aq-right { padding: 15px 16px; display: flex; flex-direction: column; gap: 10px; }
  .ai-lbl { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #c8b89a; display: flex; align-items: center; gap: 5px; }
  .ai-pip { width: 5px; height: 5px; border-radius: 50%; background: #c8b89a; flex-shrink: 0; }
  .ai-text { font-size: 12px; color: #3a3530; line-height: 1.55; font-weight: 300; flex: 1; }
  .btn-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .btn { font-size: 11px; padding: 5px 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; line-height: 1.4; }
  .btn-confirm { background: #2a6b50; color: #fff; border-color: #2a6b50; }
  .btn-confirm:hover { background: #235a42; }
  .btn-edit { background: transparent; color: #7a6a58; border-color: #d4cfc8; }
  .btn-edit:hover { border-color: #9a7a50; color: #9a7a50; }
  .btn-snooze { background: transparent; color: #9a9088; border-color: #e8e3dc; }
  .btn-snooze:hover { color: #5a534a; border-color: #c8c0b8; }
  .btn-dismiss { background: transparent; border: none; color: #c8c0b8; font-size: 16px; padding: 3px 5px; cursor: pointer; line-height: 1; }
  .btn-dismiss:hover { color: #a0524a; }
  .inline-edit { border-top: 0.5px solid #f0ece6; padding: 13px 16px; background: #fdfcfb; }
  .ie-lbl { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #b8b0a8; margin-bottom: 9px; font-weight: 500; }
  .ie-input { font-size: 12px; padding: 6px 11px; border: 0.5px solid #e4dfd8; border-radius: 6px; background: #fff; color: #1a1a1a; font-family: inherit; font-weight: 300; outline: none; transition: border-color 0.2s; }
  .ie-input:focus { border-color: #c8b89a; }
  .ie-actions { display: flex; gap: 6px; margin-top: 10px; }
  .steps-edit { border-top: 0.5px solid #f0ece6; padding: 13px 16px; background: #fdfcfb; }
  .step-row { display: flex; align-items: flex-start; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid #f5f2ee; }
  .step-row:last-of-type { border-bottom: none; }
  .step-txt { font-size: 12px; color: #3a3530; line-height: 1.45; flex: 1; font-weight: 300; }
  .step-n { width: 17px; height: 17px; border-radius: 50%; background: #f0ece6; color: #9a9088; font-size: 9px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
  .step-cb { width: 14px; height: 14px; accent-color: #c8b89a; flex-shrink: 0; margin-top: 2px; cursor: pointer; }
  .step-edit-icon { color: #c8b89a; font-size: 13px; cursor: pointer; padding: 0 3px; opacity: 0.6; transition: opacity 0.15s; background: none; border: none; }
  .step-edit-icon:hover { opacity: 1; }
  .step-inline-input { flex: 1; font-size: 11px; padding: 5px 8px; border: 0.5px solid #c8b89a; border-radius: 5px; background: #fff; color: #1a1a1a; font-family: inherit; outline: none; }
  .ai-recheck { font-size: 10px; color: #9a7a50; margin-top: 5px; font-style: italic; }
  .snooze-bar { font-size: 11px; color: #9a9088; background: #faf9f7; padding: 8px 16px; border-top: 0.5px solid #f0ece6; font-weight: 300; }
  .snooze-undo { cursor: pointer; color: #c8b89a; border-bottom: 0.5px solid #c8b89a; background: none; border-left: none; border-right: none; border-top: none; font-family: inherit; font-size: 11px; padding: 0; }
  .aq-empty { padding: 32px; text-align: center; font-size: 13px; color: #b0a898; font-weight: 300; background: #fff; border: 0.5px solid #e4dfd8; border-radius: 8px; }
  .sort-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
  .sort-label { font-size: 11px; color: #b0a898; font-weight: 500; }
  .sort-btn { font-size: 11px; padding: 4px 12px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 0.5px solid #e0dbd4; background: transparent; color: #9a9088; transition: all 0.15s; white-space: nowrap; }
  .sort-btn:hover { border-color: #c8b89a; color: #7a6a58; }
  .sort-btn.active { background: #1a1a1a; color: #c8b89a; border-color: #1a1a1a; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(15,12,10,0.55); z-index: 200; display: flex; align-items: center; justify-content: center; }
  .email-modal { background: #fff; border-radius: 10px; width: 620px; max-width: 92vw; border: 0.5px solid #e4dfd8; overflow: hidden; display: flex; flex-direction: column; max-height: 80vh; }
  .em-header { padding: 16px 20px; border-bottom: 0.5px solid #f0ece6; display: flex; align-items: center; justify-content: space-between; background: #fdfdfc; flex-shrink: 0; }
  .em-title { font-size: 13px; font-weight: 500; color: #1a1a1a; }
  .em-close { background: none; border: none; cursor: pointer; color: #b0a898; font-size: 20px; line-height: 1; transition: color 0.15s; }
  .em-close:hover { color: #5a534a; }
  .em-field { display: flex; align-items: center; border-bottom: 0.5px solid #f5f2ee; flex-shrink: 0; }
  .em-field-lbl { font-size: 10px; color: #b0a898; font-weight: 500; padding: 9px 14px; min-width: 56px; letter-spacing: 0.5px; flex-shrink: 0; text-transform: uppercase; }
  .em-field-input { flex: 1; border: none; padding: 9px 10px 9px 0; font-size: 13px; color: #1a1a1a; font-family: inherit; outline: none; background: transparent; font-weight: 300; }
  .em-body-area { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .em-body-ta { width: 100%; border: none; padding: 16px 20px; font-size: 13px; color: #1a1a1a; font-family: inherit; font-weight: 300; resize: none; outline: none; line-height: 1.75; min-height: 200px; background: #fff; flex: 1; }
  .em-footer { padding: 12px 20px; border-top: 0.5px solid #f0ece6; display: flex; gap: 8px; align-items: center; background: #fdfdfc; flex-shrink: 0; }
`

// ── Job Details Accordion ──────────────────────────────────────────────────

function JobDetailsAccordion({ job }: { job: JobDetails }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        background: '#fff',
        border: '0.5px solid #e4dfd8',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 16px',
          background: open ? '#faf9f7' : '#fff',
          border: 'none',
          borderBottom: open ? '0.5px solid #e4dfd8' : 'none',
          cursor: 'pointer',
          transition: 'background 0.15s',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: '#9e998f',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            Job Details
          </span>
          {job.insured_name && (
            <span style={{ fontSize: 13, color: '#3a3530', fontWeight: 500 }}>{job.insured_name}</span>
          )}
          {job.property_address && (
            <span
              style={{
                fontSize: 12,
                color: '#9e998f',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {job.property_address}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#c8b89a' }}>{open ? 'Collapse' : 'Expand'}</span>
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="#9e998f"
            strokeWidth="1.8"
            style={{
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path d="M2 5l5 5 5-5" />
          </svg>
        </div>
      </button>

      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0 40px',
            padding: '16px 20px 20px',
          }}
        >
          {/* Left: Job information */}
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#9e998f',
                fontWeight: 600,
                marginBottom: 10,
              }}
            >
              Job Information
            </div>
            {[
              { label: 'Insurer', value: job.insurer },
              { label: 'Claim #', value: job.claim_number },
              { label: 'Loss Type', value: job.loss_type },
              { label: 'Date of Loss', value: formatDate(job.date_of_loss) },
              { label: 'Adjuster', value: job.adjuster },
              { label: 'Sum Insured', value: formatCurrency(job.sum_insured) },
              { label: 'Excess', value: formatCurrency(job.excess) },
              { label: 'Assigned To', value: job.assigned_to },
              { label: 'Order Received', value: formatDate(job.created_at) },
            ].map(item => (
              <div key={item.label} className="ov-detail-row">
                <span className="ov-detail-label">{item.label}</span>
                <span className="ov-detail-value">{item.value || '—'}</span>
              </div>
            ))}

            {job.claim_description && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: '#9e998f',
                    fontWeight: 600,
                    marginTop: 16,
                    marginBottom: 8,
                  }}
                >
                  Claim Description
                </div>
                <p style={{ fontSize: 12, color: '#3a3530', lineHeight: 1.65, margin: 0 }}>
                  {job.claim_description}
                </p>
              </>
            )}

            {job.special_instructions && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: '#9e998f',
                    fontWeight: 600,
                    marginTop: 16,
                    marginBottom: 8,
                  }}
                >
                  Special Instructions
                </div>
                <p style={{ fontSize: 12, color: '#3a3530', lineHeight: 1.65, margin: 0 }}>
                  {job.special_instructions}
                </p>
              </>
            )}
          </div>

          {/* Right: Contacts */}
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#9e998f',
                fontWeight: 600,
                marginBottom: 10,
              }}
            >
              Contacts
            </div>

            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#c8b89a',
                fontWeight: 500,
                marginBottom: 6,
              }}
            >
              Insured
            </div>
            {[
              { label: 'Name', value: job.insured_name },
              { label: 'Phone', value: job.insured_phone },
              { label: 'Email', value: job.insured_email },
              { label: 'Address', value: job.property_address },
            ].map(item => (
              <div key={item.label} className="ov-detail-row">
                <span className="ov-detail-label">{item.label}</span>
                <span className="ov-detail-value">{item.value || '—'}</span>
              </div>
            ))}

            {job.additional_contacts && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#c8b89a',
                    fontWeight: 500,
                    marginTop: 14,
                    marginBottom: 6,
                  }}
                >
                  Additional Contacts
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: '#3a3530',
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                  }}
                >
                  {job.additional_contacts}
                </p>
              </>
            )}

            {job.notes && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: '#9e998f',
                    fontWeight: 600,
                    marginTop: 16,
                    marginBottom: 8,
                  }}
                >
                  Notes
                </div>
                <p style={{ fontSize: 12, color: '#3a3530', lineHeight: 1.65, margin: 0 }}>
                  {job.notes}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Action Cards Section ───────────────────────────────────────────────────

function ActionCardsSection({ jobId, tenantId }: { jobId: string; tenantId: string }) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [actionCards, setActionCards] = useState<ActionCard[]>([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [snoozedCards, setSnoozedCards] = useState<Set<string>>(new Set())
  const [removingCards, setRemovingCards] = useState<Set<string>>(new Set())
  const [expandedEdit, setExpandedEdit] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<string | null>(null)
  const [stepEdits, setStepEdits] = useState<Record<string, string>>({})
  const [savedSteps, setSavedSteps] = useState<Record<string, boolean>>({})
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailCard, setEmailCard] = useState<ActionCard | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('action_queue')
        .select('*, jobs(job_number)')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('priority', { ascending: true })

      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setActionCards(data.map((row: any) => ({
          id: row.id,
          job_id: row.job_id,
          job_number: row.jobs?.job_number ?? '',
          rule_key: row.rule_key,
          title: row.title,
          description: row.description,
          ai_draft: row.ai_draft,
          status: row.status,
          priority: row.priority,
          created_at: row.created_at,
          type: inferCardType(row.rule_key ?? ''),
        })))
      }
    }
    load()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmCard(id: string) {
    setRemovingCards(s => new Set(s).add(id))
    try {
      await fetch('/api/ai/execute-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch {
      // optimistic
    }
    setTimeout(() => {
      setActionCards(prev => prev.filter(c => c.id !== id))
      setRemovingCards(s => { const n = new Set(s); n.delete(id); return n })
    }, 600)
  }

  async function dismissCard(id: string) {
    setRemovingCards(s => new Set(s).add(id))
    await supabase.from('action_queue').update({ status: 'skipped' }).eq('id', id)
    setTimeout(() => {
      setActionCards(prev => prev.filter(c => c.id !== id))
      setRemovingCards(s => { const n = new Set(s); n.delete(id); return n })
    }, 350)
  }

  async function snoozeCard(id: string) {
    const tomorrow9am = new Date()
    tomorrow9am.setDate(tomorrow9am.getDate() + 1)
    tomorrow9am.setHours(9, 0, 0, 0)
    setSnoozedCards(s => new Set(s).add(id))
    await supabase
      .from('action_queue')
      .update({ status: 'snoozed', snoozed_until: tomorrow9am.toISOString() })
      .eq('id', id)
  }

  function unsnoozeCard(id: string) {
    setSnoozedCards(s => { const n = new Set(s); n.delete(id); return n })
    supabase
      .from('action_queue')
      .update({ status: 'pending', snoozed_until: null })
      .eq('id', id)
  }

  const filteredCards = actionCards.filter(c => activeFilter === 'all' || c.type === activeFilter)
  const pendingCount = actionCards.filter(c => !snoozedCards.has(c.id)).length

  return (
    <>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', letterSpacing: -0.5, lineHeight: 1 }}>
          To do
        </span>
        {pendingCount > 0 && (
          <span
            style={{
              fontSize: 11,
              color: '#c8b89a',
              fontWeight: 600,
              background: '#faf5ee',
              border: '0.5px solid #e8ddd0',
              padding: '2px 9px',
              borderRadius: 20,
            }}
          >
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="sort-bar">
        <span className="sort-label">Filter:</span>
        {[
          { key: 'all', label: 'All' },
          { key: 'notification', label: 'Notifications' },
          { key: 'quote', label: 'Quotes' },
          { key: 'task', label: 'Tasks' },
          { key: 'comms', label: 'Comms' },
          { key: 'status', label: 'Status changes' },
        ].map(f => (
          <button
            key={f.key}
            className={`sort-btn${activeFilter === f.key ? ' active' : ''}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="aq-list">
        {filteredCards.length === 0 && (
          <div className="aq-empty">
            {actionCards.length === 0 ? 'No pending actions — all clear ✓' : 'No items match this filter'}
          </div>
        )}

        {filteredCards.map(card => {
          const isSnoozed = snoozedCards.has(card.id)
          const isRemoving = removingCards.has(card.id)
          const isEmailType = card.type === 'comms' || card.type === 'notification'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const isMultiStep = card.ai_draft && Array.isArray((card.ai_draft as any).steps)
          const isTaskType = card.type === 'task'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const steps: string[] = isMultiStep ? (card.ai_draft as any).steps : []
          const dotClass = card.priority <= 1 ? 'dot-hi' : card.priority <= 2 ? 'dot-md' : 'dot-lo'
          const isStepsOpen = expandedSteps === card.id
          const isEditOpen = expandedEdit === card.id

          return (
            <div
              key={card.id}
              className={`aq-card${isSnoozed ? ' snoozed' : ''}${isRemoving ? ' removing' : ''}`}
            >
              <div className="aq-row">
                {/* Left */}
                <div className="aq-left">
                  <div className={`aq-dot ${dotClass}`} />
                  <div className="aq-body">
                    <div className="aq-type">{card.type}</div>
                    <div className="aq-title">{card.title}</div>
                    <div className="aq-desc">{card.description}</div>
                    <div className="aq-meta">
                      <span className="aq-job">{card.job_number}</span>
                      <span className="aq-age">{timeAgo(card.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="aq-div" />

                {/* Right */}
                <div className="aq-right">
                  <div>
                    <div className="ai-lbl">
                      <div className="ai-pip" />
                      {isMultiStep ? 'AI suggested steps' : 'AI suggested action'}
                    </div>
                    {isMultiStep ? (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {steps.map((s, i) => (
                          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                            <div className="step-n">{i + 1}</div>
                            <div className="ai-text" style={{ margin: 0 }}>{s}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="ai-text" style={{ marginTop: 6 }}>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(card.ai_draft as any)?.text ?? card.description ?? 'Review and confirm this action.'}
                      </div>
                    )}
                  </div>

                  <div className="btn-row">
                    <button className="btn btn-confirm" onClick={() => confirmCard(card.id)}>
                      {isMultiStep ? 'Confirm all' : isEmailType ? 'Confirm & send' : 'Confirm'}
                    </button>

                    {isEmailType && (
                      <button
                        className="btn btn-edit"
                        onClick={() => { setEmailCard(card); setEmailModalOpen(true) }}
                      >
                        Edit draft
                      </button>
                    )}

                    {isMultiStep && (
                      <button
                        className="btn btn-edit"
                        onClick={() => setExpandedSteps(isStepsOpen ? null : card.id)}
                      >
                        Edit steps
                      </button>
                    )}

                    {isTaskType && (
                      <button
                        className="btn btn-edit"
                        onClick={() => setExpandedEdit(isEditOpen ? null : card.id)}
                      >
                        Change date
                      </button>
                    )}

                    {!isMultiStep && (
                      <button
                        className="btn btn-snooze"
                        onClick={() => isSnoozed ? unsnoozeCard(card.id) : snoozeCard(card.id)}
                      >
                        Snooze
                      </button>
                    )}

                    <button className="btn btn-dismiss" onClick={() => dismissCard(card.id)}>
                      &#x2715;
                    </button>
                  </div>
                </div>
              </div>

              {/* Steps editor */}
              {isMultiStep && isStepsOpen && (
                <div className="steps-edit">
                  <div className="ie-lbl">Review, tick or edit steps</div>
                  {steps.map((s, i) => {
                    const stepKey = `${card.id}-${i}`
                    const isEditing = !!stepEdits[stepKey]
                    const isSaved = !!savedSteps[stepKey]
                    return (
                      <div key={i} className="step-row">
                        <input type="checkbox" className="step-cb" defaultChecked />
                        <div className="step-n">{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="step-txt">{stepEdits[`${stepKey}-saved`] ?? s}</div>
                          {isEditing && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <input
                                className="step-inline-input"
                                defaultValue={stepEdits[`${stepKey}-saved`] ?? s}
                                id={`sinput-${stepKey}`}
                              />
                              <button
                                className="btn btn-confirm"
                                style={{ fontSize: 10, padding: '4px 10px' }}
                                onClick={() => {
                                  const el = document.getElementById(`sinput-${stepKey}`) as HTMLInputElement
                                  setStepEdits(prev => ({ ...prev, [`${stepKey}-saved`]: el.value }))
                                  setSavedSteps(prev => ({ ...prev, [stepKey]: true }))
                                  setStepEdits(prev => { const n = { ...prev }; delete n[stepKey]; return n })
                                }}
                              >
                                Save
                              </button>
                            </div>
                          )}
                          {isSaved && !isEditing && (
                            <div className="ai-recheck">AI will re-verify this step before executing.</div>
                          )}
                        </div>
                        <button
                          className="step-edit-icon"
                          onClick={() =>
                            setStepEdits(prev =>
                              prev[stepKey]
                                ? (({ [stepKey]: _, ...rest }) => rest)(prev)
                                : { ...prev, [stepKey]: 'open' }
                            )
                          }
                        >
                          ✎
                        </button>
                      </div>
                    )
                  })}
                  <div className="ie-actions" style={{ marginTop: 12 }}>
                    <button className="btn btn-confirm" onClick={() => confirmCard(card.id)}>
                      Confirm selected
                    </button>
                    <button className="btn btn-edit" onClick={() => setExpandedSteps(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Date picker */}
              {isTaskType && isEditOpen && (
                <div className="inline-edit">
                  <div className="ie-lbl">Select inspection date</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <input
                      className="ie-input"
                      type="date"
                      defaultValue={new Date().toISOString().split('T')[0]}
                      style={{ width: 155 }}
                    />
                    <select className="ie-input" style={{ width: 165 }}>
                      <option>Morning (8am – 12pm)</option>
                      <option>Afternoon (12pm – 5pm)</option>
                    </select>
                  </div>
                  <div className="ie-actions">
                    <button className="btn btn-confirm" onClick={() => confirmCard(card.id)}>
                      Confirm
                    </button>
                    <button className="btn btn-edit" onClick={() => setExpandedEdit(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Snooze bar */}
              {isSnoozed && (
                <div className="snooze-bar">
                  Snoozed until tomorrow 9:00 am &nbsp;·&nbsp;{' '}
                  <button className="snooze-undo" onClick={() => unsnoozeCard(card.id)}>
                    Undo
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Email modal */}
      {emailModalOpen && emailCard && (
        <div
          className="modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) setEmailModalOpen(false) }}
        >
          <div className="email-modal">
            <div className="em-header">
              <span className="em-title">Edit email draft — {emailCard.job_number}</span>
              <button className="em-close" onClick={() => setEmailModalOpen(false)}>&times;</button>
            </div>
            <div className="em-field">
              <span className="em-field-lbl">To</span>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <input className="em-field-input" defaultValue={(emailCard.ai_draft as any)?.to ?? ''} placeholder="Recipient…" />
            </div>
            <div className="em-field">
              <span className="em-field-lbl">CC</span>
              <input className="em-field-input" placeholder="Add CC…" />
            </div>
            <div className="em-field">
              <span className="em-field-lbl">Subject</span>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <input className="em-field-input" defaultValue={(emailCard.ai_draft as any)?.subject ?? `RE: ${emailCard.job_number}`} />
            </div>
            <div className="em-body-area">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <textarea className="em-body-ta" rows={9} defaultValue={(emailCard.ai_draft as any)?.body ?? emailCard.description ?? ''} />
            </div>
            <div className="em-footer">
              <button className="btn btn-confirm" onClick={() => { confirmCard(emailCard.id); setEmailModalOpen(false) }}>
                Confirm &amp; send
              </button>
              <button className="btn btn-edit" onClick={() => setEmailModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Communications Card ────────────────────────────────────────────────────

function CommunicationsCard({ jobId, tenantId }: { jobId: string; tenantId: string }) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [comms, setComms] = useState<CommEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('communications')
        .select('id,type,direction,contact_name,content,created_at')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(6)
      setComms((data ?? []) as CommEntry[])
      setLoading(false)
    }
    load()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        background: '#fff',
        border: '0.5px solid #e4dfd8',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '0.5px solid #e4dfd8',
        }}
      >
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: '#9e998f',
            fontWeight: 500,
          }}
        >
          Communications
        </span>
        <button
          style={{
            fontSize: 11,
            color: '#c8b89a',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Full feed →
        </button>
      </div>

      <div>
        {loading ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: '#9e998f' }}>
            Loading…
          </div>
        ) : comms.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: '#9e998f' }}>
            No communications yet
          </div>
        ) : (
          comms.map(c => {
            const color = COMM_COLORS[c.type] ?? '#9e998f'
            const initial = commInitial(c.type)
            const dirLabel =
              c.direction === 'inbound' ? 'Inbound' : c.direction === 'outbound' ? 'Outbound' : 'Note'
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '11px 16px',
                  borderBottom: '0.5px solid #f0ece6',
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: color,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {initial}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#3a3530' }}>
                      {c.contact_name || 'Unknown'}
                    </span>
                    <span style={{ fontSize: 11, color: '#9e998f' }}>{formatRelativeTime(c.created_at)}</span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: '#f5f2ee',
                        color: '#9e998f',
                      }}
                    >
                      {dirLabel}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: '#9e998f', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.content || '(no content)'}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Calendar Card ──────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function CalendarCard({ jobId, tenantId }: { jobId: string; tenantId: string }) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const today = new Date()
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [events, setEvents] = useState<CalendarEvent[]>([])

  useEffect(() => {
    async function loadEvents() {
      const { data } = await supabase
        .from('inspections')
        .select('id, scheduled_date, status')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .not('scheduled_date', 'is', null)

      const evts: CalendarEvent[] = []
      if (data) {
        for (const insp of data) {
          if (insp.scheduled_date) {
            evts.push({ date: insp.scheduled_date, label: 'Inspection', color: '#1a73e8' })
          }
        }
      }
      setEvents(evts)
    }
    loadEvents()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

  const eventsOnDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return events.filter(e => e.date.startsWith(dateStr))
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const upcomingEvents = events
    .filter(e => new Date(e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)

  return (
    <div
      style={{
        background: '#fff',
        border: '0.5px solid #e4dfd8',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '0.5px solid #e4dfd8',
        }}
      >
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: '#9e998f',
            fontWeight: 500,
          }}
        >
          Calendar
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9e998f',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
              transition: 'color 0.15s',
            }}
          >
            ‹
          </button>
          <span style={{ fontSize: 12, color: '#3a3530', fontWeight: 500, minWidth: 115, textAlign: 'center' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9e998f',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
              transition: 'color 0.15s',
            }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ padding: '12px 14px' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DAY_NAMES.map(d => (
            <div
              key={d}
              style={{
                textAlign: 'center',
                fontSize: 10,
                color: '#b0a898',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                paddingBottom: 6,
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px 0' }}>
          {cells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} />
            const dayEvents = eventsOnDay(day)
            const todayDay = isToday(day)
            return (
              <div
                key={day}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 0' }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    fontSize: 12,
                    color: todayDay ? '#fff' : '#3a3530',
                    background: todayDay ? '#1a1a1a' : 'transparent',
                    fontWeight: todayDay ? 600 : 400,
                  }}
                >
                  {day}
                </span>
                {dayEvents.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, marginTop: 1 }}>
                    {dayEvents.slice(0, 3).map((e, idx) => (
                      <div
                        key={idx}
                        title={e.label}
                        style={{ width: 4, height: 4, borderRadius: '50%', background: e.color }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Upcoming events */}
        {upcomingEvents.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '0.5px solid #f0ece6', paddingTop: 12 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#9e998f',
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              Upcoming
            </div>
            {upcomingEvents.map((e, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 0',
                  borderBottom: i < upcomingEvents.length - 1 ? '0.5px solid #f5f2ee' : 'none',
                }}
              >
                <div
                  style={{ width: 6, height: 6, borderRadius: '50%', background: e.color, flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: '#3a3530' }}>{e.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: '#9e998f',
                    marginLeft: 'auto',
                    fontFamily: 'DM Mono, monospace',
                  }}
                >
                  {formatDate(e.date)}
                </span>
              </div>
            ))}
          </div>
        )}

        {upcomingEvents.length === 0 && events.length === 0 && (
          <div
            style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: '#b0a898', padding: '8px 0' }}
          >
            No scheduled events
          </div>
        )}
      </div>
    </div>
  )
}

// ── OverviewTab ────────────────────────────────────────────────────────────

export function OverviewTab({ jobId, tenantId, job }: OverviewTabProps) {
  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <style>{OVERVIEW_CSS}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 1. Job Details accordion — full width */}
        <JobDetailsAccordion job={job} />

        {/* 2. Action Cards — full width */}
        <div>
          <ActionCardsSection jobId={jobId} tenantId={tenantId} />
        </div>

        {/* 3. Two equal columns: Communications + Calendar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <CommunicationsCard jobId={jobId} tenantId={tenantId} />
          <CalendarCard jobId={jobId} tenantId={tenantId} />
        </div>
      </div>
    </div>
  )
}
