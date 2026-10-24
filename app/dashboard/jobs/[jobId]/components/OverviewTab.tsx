'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import JobSchedule from '@/components/schedule/JobSchedule'
import { CommsFeed } from '@/components/comms/CommsFeed'
import ContactsEditor from '@/components/contacts/ContactsEditor'
import InsurerEmailFields from '@/components/contacts/InsurerEmailFields'
import { InsurerSelect } from '@/components/clients/InsurerSelect'
import { InvoiceToSelect } from '@/components/clients/InvoiceToSelect'
import { JobContact } from '@/lib/types/contacts'
import { applyContactDefaults } from '@/lib/contacts/defaults'
import { LOSS_TYPES } from '@/lib/loss-types'
import { ExcessDecisionBadge } from '@/components/jobs/ExcessDecisionBadge'
import { JobCards } from '@/components/actions/ActionsView'

// ── Types ──────────────────────────────────────────────────────────────────

interface JobDetails {
  job_number: string
  insured_name: string | null
  property_address: string | null
  override_stage: 'on_hold' | 'cancelled' | null
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
  contacts: unknown
  adjuster_reference: string | null
  order_sender_name: string | null
  order_sender_email: string | null
  claim_description: string | null
  special_instructions: string | null
  notes: string | null
  client_id: string | null
  invoice_to: string | null
  job_type: string | null
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

// ── Shared CSS ─────────────────────────────────────────────────────────────

const OVERVIEW_CSS = `
  .ov-detail-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 0.5px solid var(--line-faint); }
  .ov-detail-row:last-child { border-bottom: none; }
  .ov-detail-label { width: 120px; flex-shrink: 0; font-size: 12px; color: var(--subtle); padding-top: 3px; }
  .ov-detail-value { font-size: 13px; color: var(--body); }
  .ov-edit-input { font-size: 13px; color: var(--ink); border: 0.5px solid var(--line-2); border-radius: 5px; padding: 3px 8px; background: var(--surface-7); font-family: inherit; outline: none; flex: 1; transition: border-color 0.15s; }
  .ov-edit-input:focus { border-color: var(--tan); background: var(--paper); }
  .ov-edit-textarea { font-size: 12px; color: var(--ink); border: 0.5px solid var(--line-2); border-radius: 5px; padding: 6px 8px; background: var(--surface-7); font-family: inherit; outline: none; width: 100%; resize: vertical; line-height: 1.6; min-height: 68px; transition: border-color 0.15s; }
  .ov-edit-textarea:focus { border-color: var(--tan); background: var(--paper); }

`

// ── Job Details Accordion ──────────────────────────────────────────────────

type EditFields = {
  insurer: string
  client_id: string | null
  claim_number: string
  loss_type: string
  date_of_loss: string
  adjuster: string
  sum_insured: string
  excess: string
  assigned_to: string
  claim_description: string
  special_instructions: string
  insured_name: string
  insured_phone: string
  insured_email: string
  property_address: string
  notes: string
  adjuster_reference: string
  order_sender_name: string
  order_sender_email: string
  invoice_to: string
  contacts: JobContact[]
}

function jobToEditFields(job: JobDetails): EditFields {
  return {
    insurer: job.insurer ?? '',
    client_id: job.client_id,
    claim_number: job.claim_number ?? '',
    loss_type: job.loss_type ?? '',
    date_of_loss: job.date_of_loss ?? '',
    adjuster: job.adjuster ?? '',
    sum_insured: job.sum_insured != null ? String(job.sum_insured) : '',
    excess: job.excess != null ? String(job.excess) : '',
    assigned_to: job.assigned_to ?? '',
    claim_description: job.claim_description ?? '',
    special_instructions: job.special_instructions ?? '',
    insured_name: job.insured_name ?? '',
    insured_phone: job.insured_phone ?? '',
    insured_email: job.insured_email ?? '',
    property_address: job.property_address ?? '',
    notes: job.notes ?? '',
    adjuster_reference: job.adjuster_reference ?? '',
    order_sender_name: job.order_sender_name ?? '',
    order_sender_email: job.order_sender_email ?? '',
    invoice_to: job.invoice_to ?? '',
    contacts: applyContactDefaults((job.contacts as unknown as JobContact[]) || []),
  }
}

function JobDetailsAccordion({
  job,
  jobId,
  tenantId,
}: {
  job: JobDetails
  jobId: string
  tenantId: string
}) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [vals, setVals] = useState<EditFields>(() => jobToEditFields(job))
  const [saved, setSaved] = useState<JobDetails>(job)

  function set(field: keyof EditFields, value: string | null) {
    setVals(prev => ({ ...prev, [field]: value }))
  }

  function cancelEdit() {
    setVals(jobToEditFields(saved))
    setEditing(false)
  }

  async function saveEdit() {
    setSaving(true)
    const patch = {
      insurer: vals.insurer || null,
      client_id: vals.client_id,
      claim_number: vals.claim_number || null,
      loss_type: vals.loss_type || null,
      date_of_loss: vals.date_of_loss || null,
      adjuster: vals.adjuster || null,
      sum_insured: vals.sum_insured !== '' ? parseFloat(vals.sum_insured) : null,
      excess: vals.excess !== '' ? parseFloat(vals.excess) : null,
      assigned_to: vals.assigned_to || null,
      claim_description: vals.claim_description || null,
      special_instructions: vals.special_instructions || null,
      insured_name: vals.insured_name || null,
      insured_phone: vals.insured_phone || null,
      insured_email: vals.insured_email || null,
      property_address: vals.property_address || null,
      notes: vals.notes || null,
      adjuster_reference: vals.adjuster_reference || null,
      order_sender_name: vals.order_sender_name || null,
      order_sender_email: vals.order_sender_email || null,
      invoice_to: vals.invoice_to || null,
      contacts: vals.contacts as unknown as JobDetails['contacts'],
    }
    await supabase.from('jobs').update(patch).eq('id', jobId).eq('tenant_id', tenantId)
    setSaved(prev => ({ ...prev, ...patch }))
    setEditing(false)
    setSaving(false)
  }

  // Shared sub-section label style
  const subLabel = (extra?: React.CSSProperties): React.CSSProperties => ({
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: '#9e998f',
    fontWeight: 600,
    marginBottom: 10,
    ...extra,
  })

  const accentLabel = (extra?: React.CSSProperties): React.CSSProperties => ({
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#c8b89a',
    fontWeight: 500,
    marginBottom: 6,
    ...extra,
  })

  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '0.5px solid var(--line-2)',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 16px',
          background: open ? 'var(--surface-3)' : 'var(--paper)',
          borderBottom: open ? '0.5px solid var(--line-2)' : 'none',
          transition: 'background 0.15s',
          gap: 12,
        }}
      >
        {/* Clickable left side — toggles open */}
        <button
          onClick={() => { if (!editing) setOpen(!open) }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: editing ? 'default' : 'pointer',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--subtle)',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          Job Details
        </button>

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {open && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                fontSize: 11,
                color: 'var(--brown-500)',
                background: 'transparent',
                border: '1px solid var(--line-strong-3)',
                borderRadius: 20,
                padding: '3px 12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              Edit
            </button>
          )}
          {open && editing && (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{
                  fontSize: 11,
                  color: 'var(--paper)',
                  background: 'var(--teal)',
                  border: '1px solid var(--teal)',
                  borderRadius: 20,
                  padding: '3px 14px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  opacity: saving ? 0.7 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                style={{
                  fontSize: 11,
                  color: 'var(--subtle-3)',
                  background: 'transparent',
                  border: '1px solid var(--line-5)',
                  borderRadius: 20,
                  padding: '3px 12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                Cancel
              </button>
            </>
          )}

          {/* Expand/collapse — hidden in edit mode to prevent accidental collapse */}
          {!editing && (
            <button
              onClick={() => setOpen(!open)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--tan)',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {open ? 'Collapse' : 'Expand'}
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                stroke="#9e998f"
                strokeWidth="1.8"
                style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
              >
                <path d="M2 5l5 5 5-5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0 40px',
            padding: '16px 20px 20px',
            background: editing ? 'var(--surface-7)' : 'var(--paper)',
            transition: 'background 0.2s',
          }}
        >
          {/* Left: Job information */}
          <div>
            <div style={subLabel()}>Job Information</div>

            {/* Insurer Select */}
            <div className="ov-detail-row">
              <span className="ov-detail-label">Insurer</span>
              {editing ? (
                <div style={{ flex: 1 }}>
                  <InsurerSelect
                    tenantId={tenantId}
                    value={vals.insurer}
                    onSave={(name, clientId) => {
                      set('insurer', name || '')
                      set('client_id', clientId)
                    }}
                  />
                </div>
              ) : (
                <span className="ov-detail-value">{saved.insurer || '—'}</span>
              )}
            </div>

            {/* Invoice To Select */}
            <div className="ov-detail-row">
              <span className="ov-detail-label">Invoice to</span>
              {editing ? (
                <div style={{ flex: 1 }}>
                  <InvoiceToSelect
                    tenantId={tenantId}
                    insurer={vals.insurer}
                    adjuster={vals.adjuster}
                    value={vals.invoice_to}
                    onSave={v => set('invoice_to', v || '')}
                  />
                </div>
              ) : (
                <span className="ov-detail-value">{saved.invoice_to || '—'}</span>
              )}
            </div>

            {/* Text fields */}
            {(
              [
                { label: 'Claim #', field: 'claim_number' },
                { label: 'Loss Type', field: 'loss_type' },
                { label: 'Adjuster', field: 'adjuster' },
                { label: 'Adjuster Reference', field: 'adjuster_reference' },
                { label: 'Claim Manager Name', field: 'order_sender_name' },
                { label: 'Claim Manager Email', field: 'order_sender_email' },
                { label: 'Assigned To', field: 'assigned_to' },
              ] as { label: string; field: Exclude<keyof EditFields, 'contacts'> }[]
            ).map(({ label, field }) => (
              <div key={label} className="ov-detail-row">
                <span className="ov-detail-label">{label}</span>
                {editing ? (
                  field === 'loss_type' ? (
                    <select
                      className="ov-edit-input"
                      value={vals.loss_type || ''}
                      onChange={e => set('loss_type', e.target.value)}
                    >
                      <option value="">—</option>
                      {LOSS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <input
                      className="ov-edit-input"
                      type={field === 'order_sender_email' ? 'email' : 'text'}
                      value={vals[field] || ''}
                      onChange={e => set(field, e.target.value)}
                    />
                  )
                ) : (
                  <span className="ov-detail-value">{(saved[field as keyof JobDetails] as string) || '—'}</span>
                )}
              </div>
            ))}

            {/* Date of Loss */}
            <div className="ov-detail-row">
              <span className="ov-detail-label">Date of Loss</span>
              {editing ? (
                <input
                  type="date"
                  className="ov-edit-input"
                  value={vals.date_of_loss}
                  onChange={e => set('date_of_loss', e.target.value)}
                />
              ) : (
                <span className="ov-detail-value">{formatDate(saved.date_of_loss)}</span>
              )}
            </div>

            {/* Sum Insured */}
            <div className="ov-detail-row">
              <span className="ov-detail-label">Sum Insured</span>
              {editing ? (
                <input
                  type="number"
                  className="ov-edit-input"
                  value={vals.sum_insured}
                  onChange={e => set('sum_insured', e.target.value)}
                  placeholder="0.00"
                />
              ) : (
                <span className="ov-detail-value">{formatCurrency(saved.sum_insured)}</span>
              )}
            </div>

            {/* Excess */}
            <div className="ov-detail-row">
              <span className="ov-detail-label">Excess</span>
              {editing ? (
                <input
                  type="number"
                  className="ov-edit-input"
                  value={vals.excess}
                  onChange={e => set('excess', e.target.value)}
                  placeholder="0.00"
                />
              ) : (
                <span className="ov-detail-value">
                  {formatCurrency(saved.excess)}
                  <span className="mt-1 block"><ExcessDecisionBadge jobId={jobId} /></span>
                </span>
              )}
            </div>

            {/* Order Received — read-only always */}
            <div className="ov-detail-row">
              <span className="ov-detail-label">Order Received</span>
              <span className="ov-detail-value">{formatDate(saved.created_at)}</span>
            </div>

            {/* Claim Description */}
            <div style={subLabel({ marginTop: 16 })}>Claim Description</div>
            {editing ? (
              <textarea
                className="ov-edit-textarea"
                value={vals.claim_description}
                onChange={e => set('claim_description', e.target.value)}
                placeholder="Enter claim description…"
              />
            ) : (
              <p style={{ fontSize: 12, color: 'var(--body)', lineHeight: 1.65, margin: 0 }}>
                {saved.claim_description || '—'}
              </p>
            )}

            {/* Special Instructions */}
            <div style={subLabel({ marginTop: 16 })}>Special Instructions</div>
            {editing ? (
              <textarea
                className="ov-edit-textarea"
                value={vals.special_instructions}
                onChange={e => set('special_instructions', e.target.value)}
                placeholder="Enter special instructions…"
              />
            ) : (
              <p style={{ fontSize: 12, color: 'var(--body)', lineHeight: 1.65, margin: 0 }}>
                {saved.special_instructions || '—'}
              </p>
            )}
          </div>

          {/* Right: Contacts */}
          <div>
            <div style={subLabel()}>Contacts</div>
            <div style={accentLabel()}>Insured</div>

            {(
              [
                { label: 'Name', field: 'insured_name' },
                { label: 'Phone', field: 'insured_phone' },
                { label: 'Email', field: 'insured_email' },
                { label: 'Address', field: 'property_address' },
              ] as { label: string; field: Exclude<keyof EditFields, 'contacts'> }[]
            ).map(({ label, field }) => (
              <div key={label} className="ov-detail-row">
                <span className="ov-detail-label">{label}</span>
                {editing ? (
                  <input
                    className="ov-edit-input"
                    type={field === 'insured_email' ? 'email' : 'text'}
                    value={vals[field] || ''}
                    onChange={e => set(field, e.target.value)}
                  />
                ) : (
                  <span className="ov-detail-value">
                    {(saved[field as keyof JobDetails] as string) || '—'}
                  </span>
                )}
              </div>
            ))}

            {/* Contacts Editor */}
            <div style={accentLabel({ marginTop: 14 })}>Additional Contacts</div>
            {editing ? (
              <ContactsEditor
                contacts={vals.contacts}
                onChange={(contacts) => setVals(prev => ({ ...prev, contacts }))}
                hideInsured={true}
              />
            ) : (
              (() => {
                const additional = saved.contacts as unknown as JobContact[] | null
                const extras = (additional || []).filter(c => c.slot !== 'insured' && (c.name || c.phone || c.email))
                if (extras.length === 0) {
                  return (
                    <p style={{ fontSize: 12, color: 'var(--subtle)', lineHeight: 1.65, margin: 0 }}>
                      No additional contacts.
                    </p>
                  )
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {extras.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--body)', lineHeight: 1.65 }}>
                        <strong>{c.type ? c.type.replace('_', ' ') : 'Contact'}</strong>
                        {c.name ? ` — ${c.name}` : ''}
                        {c.phone ? ` · ${c.phone}` : ''}
                        {c.email ? ` · ${c.email}` : ''}
                        {c.roles.length > 0 ? ` (${c.roles.join(', ')})` : ''}
                      </div>
                    ))}
                  </div>
                )
              })()
            )}


            {/* Notes */}
            <div style={subLabel({ marginTop: 16 })}>Notes</div>
            {editing ? (
              <textarea
                className="ov-edit-textarea"
                value={vals.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Enter notes…"
              />
            ) : (
              <p style={{ fontSize: 12, color: 'var(--body)', lineHeight: 1.65, margin: 0 }}>
                {saved.notes || '—'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Automation Overrides Section ────────────────────────────────────────────

interface AutomationOverrides {
  time_mode_override?: 'business_hours' | 'waking_hours' | 'urgent' | 'send_window' | null
  insured_contact_window_start?: string
  insured_contact_window_end?: string
  insured_contact_all_days?: boolean
  trade_contact_overrides?: Record<string, {
    contact_window_start?: string
    contact_window_end?: string
    contact_all_days?: boolean
  }>
}

function AutomationOverridesAccordion({
  jobId,
  tenantId,
}: {
  jobId: string
  tenantId: string
}) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [overrides, setOverrides] = useState<AutomationOverrides>({})
  const [savedOverrides, setSavedOverrides] = useState<AutomationOverrides>({})
  const [trades, setTrades] = useState<Array<{ id: string; business_name: string; primary_trade: string }>>([])

  useEffect(() => {
    async function loadOverrides() {
      const { data } = await supabase
        .from('jobs')
        .select('automation_overrides')
        .eq('id', jobId)
        .single()
      
      if (data?.automation_overrides) {
        setOverrides(data.automation_overrides as AutomationOverrides)
        setSavedOverrides(data.automation_overrides as AutomationOverrides)
      }
    }
    loadOverrides()
  }, [jobId, supabase])

  useEffect(() => {
    async function loadTrades() {
      const { data } = await supabase
        .from('work_orders')
        .select('trade_id, trades(id, business_name, primary_trade)')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
      
      if (data) {
        const uniqueTrades = new Map()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.forEach((wo: any) => {
          if (wo.trades && !uniqueTrades.has(wo.trades.id)) {
            uniqueTrades.set(wo.trades.id, wo.trades)
          }
        })
        setTrades(Array.from(uniqueTrades.values()))
      }
    }
    if (open) {
      loadTrades()
    }
  }, [jobId, tenantId, open, supabase])

  async function saveOverrides() {
    setSaving(true)
    await supabase
      .from('jobs')
      .update({ automation_overrides: overrides })
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
    setSavedOverrides(overrides)
    setEditing(false)
    setSaving(false)
  }

  function cancelEdit() {
    setOverrides(savedOverrides)
    setEditing(false)
  }

  const subLabel = (extra?: React.CSSProperties): React.CSSProperties => ({
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: '#9e998f',
    fontWeight: 600,
    marginBottom: 10,
    ...extra,
  })

  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '0.5px solid var(--line-2)',
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
          padding: '13px 16px',
          background: open ? 'var(--surface-3)' : 'var(--paper)',
          borderBottom: open ? '0.5px solid var(--line-2)' : 'none',
          transition: 'background 0.15s',
          gap: 12,
        }}
      >
        <button
          onClick={() => { if (!editing) setOpen(!open) }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: editing ? 'default' : 'pointer',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--subtle)',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          Automation Overrides
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {open && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                fontSize: 11,
                color: 'var(--brown-500)',
                background: 'transparent',
                border: '1px solid var(--line-strong-3)',
                borderRadius: 20,
                padding: '3px 12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              Edit
            </button>
          )}
          {open && editing && (
            <>
              <button
                onClick={saveOverrides}
                disabled={saving}
                style={{
                  fontSize: 11,
                  color: 'var(--paper)',
                  background: 'var(--teal)',
                  border: '1px solid var(--teal)',
                  borderRadius: 20,
                  padding: '3px 14px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  opacity: saving ? 0.7 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                style={{
                  fontSize: 11,
                  color: 'var(--subtle-3)',
                  background: 'transparent',
                  border: '1px solid var(--line-5)',
                  borderRadius: 20,
                  padding: '3px 12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                Cancel
              </button>
            </>
          )}

          {!editing && (
            <button
              onClick={() => setOpen(!open)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--tan)',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {open ? 'Collapse' : 'Expand'}
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                stroke="#9e998f"
                strokeWidth="1.8"
                style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
              >
                <path d="M2 5l5 5 5-5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {open && (
        <div
          style={{
            padding: '16px 20px 20px',
            background: editing ? 'var(--surface-7)' : 'var(--paper)',
            transition: 'background 0.2s',
          }}
        >
          {/* Time Mode Override */}
          <div style={subLabel()}>Time Mode Override</div>
          <div className="ov-detail-row">
            <span className="ov-detail-label">Override Mode</span>
            {editing ? (
              <select
                className="ov-edit-input"
                value={overrides.time_mode_override || ''}
                onChange={e => setOverrides(prev => ({ ...prev, time_mode_override: e.target.value as any || null }))}
              >
                <option value="">(no override)</option>
                <option value="business_hours">Business Hours</option>
                <option value="waking_hours">Waking Hours</option>
                <option value="urgent">Urgent</option>
                <option value="send_window">Send Window</option>
              </select>
            ) : (
              <span className="ov-detail-value">
                {savedOverrides.time_mode_override || '(no override)'}
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--subtle-3)', marginTop: 6 }}>
            Overrides the time mode for all automations on this job. Use Urgent for CAT events. Leave blank for standard behaviour.
          </p>

          {/* Custom Insured Contact Window */}
          <div style={subLabel({ marginTop: 20 })}>Custom Insured Contact Window</div>
          <div className="ov-detail-row">
            <span className="ov-detail-label">Enabled</span>
            {editing ? (
              <input
                type="checkbox"
                checked={!!overrides.insured_contact_window_start}
                onChange={e => {
                  if (e.target.checked) {
                    setOverrides(prev => ({ 
                      ...prev, 
                      insured_contact_window_start: '07:00',
                      insured_contact_window_end: '20:00',
                      insured_contact_all_days: false
                    }))
                  } else {
                    setOverrides(prev => ({ 
                      ...prev, 
                      insured_contact_window_start: undefined,
                      insured_contact_window_end: undefined,
                      insured_contact_all_days: undefined
                    }))
                  }
                }}
              />
            ) : (
              <span className="ov-detail-value">
                {savedOverrides.insured_contact_window_start ? 'Yes' : 'No'}
              </span>
            )}
          </div>
          {overrides.insured_contact_window_start && (
            <>
              <div className="ov-detail-row">
                <span className="ov-detail-label">Start time</span>
                {editing ? (
                  <input
                    type="time"
                    className="ov-edit-input"
                    value={overrides.insured_contact_window_start}
                    onChange={e => setOverrides(prev => ({ ...prev, insured_contact_window_start: e.target.value }))}
                  />
                ) : (
                  <span className="ov-detail-value">{savedOverrides.insured_contact_window_start}</span>
                )}
              </div>
              <div className="ov-detail-row">
                <span className="ov-detail-label">End time</span>
                {editing ? (
                  <input
                    type="time"
                    className="ov-edit-input"
                    value={overrides.insured_contact_window_end}
                    onChange={e => setOverrides(prev => ({ ...prev, insured_contact_window_end: e.target.value }))}
                  />
                ) : (
                  <span className="ov-detail-value">{savedOverrides.insured_contact_window_end}</span>
                )}
              </div>
              <div className="ov-detail-row">
                <span className="ov-detail-label">Any day</span>
                {editing ? (
                  <input
                    type="checkbox"
                    checked={!!overrides.insured_contact_all_days}
                    onChange={e => setOverrides(prev => ({ ...prev, insured_contact_all_days: e.target.checked }))}
                  />
                ) : (
                  <span className="ov-detail-value">{savedOverrides.insured_contact_all_days ? 'Yes' : 'No'}</span>
                )}
              </div>
            </>
          )}
          <p style={{ fontSize: 11, color: 'var(--subtle-3)', marginTop: 6 }}>
            For night-shift workers or contacts with non-standard hours. Example: set 2pm–10pm for a night-shift worker. Overrides global waking hours for this job's insured contact only.
          </p>

          {/* Trade-Specific Contact Windows */}
          {trades.length > 0 && (
            <>
              <div style={subLabel({ marginTop: 20 })}>Trade-Specific Contact Windows</div>
              <p style={{ fontSize: 11, color: 'var(--subtle-3)', marginBottom: 10 }}>
                Override contact hours for a specific trade on this job only. Gary's global send window covers most cases — use this only for trades with confirmed non-standard availability.
              </p>
              {trades.map(trade => (
                <div key={trade.id} style={{ marginBottom: 16, padding: 12, background: 'var(--surface-3)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>
                    {trade.business_name} ({trade.primary_trade})
                  </div>
                  <div className="ov-detail-row">
                    <span className="ov-detail-label">Start time</span>
                    {editing ? (
                      <input
                        type="time"
                        className="ov-edit-input"
                        value={overrides.trade_contact_overrides?.[trade.id]?.contact_window_start || ''}
                        onChange={e => setOverrides(prev => ({
                          ...prev,
                          trade_contact_overrides: {
                            ...prev.trade_contact_overrides,
                            [trade.id]: {
                              ...prev.trade_contact_overrides?.[trade.id],
                              contact_window_start: e.target.value
                            }
                          }
                        }))}
                      />
                    ) : (
                      <span className="ov-detail-value">
                        {savedOverrides.trade_contact_overrides?.[trade.id]?.contact_window_start || '—'}
                      </span>
                    )}
                  </div>
                  <div className="ov-detail-row">
                    <span className="ov-detail-label">End time</span>
                    {editing ? (
                      <input
                        type="time"
                        className="ov-edit-input"
                        value={overrides.trade_contact_overrides?.[trade.id]?.contact_window_end || ''}
                        onChange={e => setOverrides(prev => ({
                          ...prev,
                          trade_contact_overrides: {
                            ...prev.trade_contact_overrides,
                            [trade.id]: {
                              ...prev.trade_contact_overrides?.[trade.id],
                              contact_window_end: e.target.value
                            }
                          }
                        }))}
                      />
                    ) : (
                      <span className="ov-detail-value">
                        {savedOverrides.trade_contact_overrides?.[trade.id]?.contact_window_end || '—'}
                      </span>
                    )}
                  </div>
                  <div className="ov-detail-row">
                    <span className="ov-detail-label">Any day</span>
                    {editing ? (
                      <input
                        type="checkbox"
                        checked={!!overrides.trade_contact_overrides?.[trade.id]?.contact_all_days}
                        onChange={e => setOverrides(prev => ({
                          ...prev,
                          trade_contact_overrides: {
                            ...prev.trade_contact_overrides,
                            [trade.id]: {
                              ...prev.trade_contact_overrides?.[trade.id],
                              contact_all_days: e.target.checked
                            }
                          }
                        }))}
                      />
                    ) : (
                      <span className="ov-detail-value">
                        {savedOverrides.trade_contact_overrides?.[trade.id]?.contact_all_days ? 'Yes' : 'No'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
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
        background: 'var(--paper)',
        border: '0.5px solid var(--line-2)',
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
          borderBottom: '0.5px solid var(--line-2)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--subtle)',
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
              color: 'var(--subtle)',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
              transition: 'color 0.15s',
            }}
          >
            ‹
          </button>
          <span style={{ fontSize: 12, color: 'var(--body)', fontWeight: 500, minWidth: 115, textAlign: 'center' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--subtle)',
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
                color: 'var(--faint)',
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
                    color: todayDay ? 'var(--paper)' : 'var(--body)',
                    background: todayDay ? 'var(--ink)' : 'transparent',
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
          <div style={{ marginTop: 14, borderTop: '0.5px solid var(--line-faint)', paddingTop: 12 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: 'var(--subtle)',
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
                  borderBottom: i < upcomingEvents.length - 1 ? '0.5px solid var(--surface)' : 'none',
                }}
              >
                <div
                  style={{ width: 6, height: 6, borderRadius: '50%', background: e.color, flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: 'var(--body)' }}>{e.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--subtle)',
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
            style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: 'var(--faint)', padding: '8px 0' }}
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
        <JobDetailsAccordion job={job} jobId={jobId} tenantId={tenantId} />

        {/* 2. Automation Overrides accordion — per-job time mode settings */}
        <AutomationOverridesAccordion jobId={jobId} tenantId={tenantId} />

        {/* 3. Action cards — this job's to-do list (components/actions) */}
        <div>
          <JobCards jobId={jobId} />
        </div>

        {/* 4. Full-width communications feed */}
        <CommsFeed jobId={jobId} />

        {/* 5. Calendar */}
        <JobSchedule jobId={jobId} tenantId={tenantId} />
      </div>
    </div>
  )
}
