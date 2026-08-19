'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface InvoiceRow {
  id: string
  invoice_ref: string | null
  invoice_type: string
  direction: string
  status: string | null
  amount_inc_gst: number | null
  issued_date: string | null
  job_id: string
  tenant_id: string
  created_at: string | null
  job_number?: string
  insurer?: string | null
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#fff8e1', text: '#b45309' },
  sent: { bg: '#e8f0fe', text: '#1a73e8' },
  paid: { bg: '#e8f5e9', text: '#2e7d32' },
  voided: { bg: '#fce8e6', text: '#c5221f' },
}

const TYPE_LABELS: Record<string, string> = {
  assessment: 'Assessment',
  repair: 'Repair',
  make_safe: 'Make Safe',
  excess: 'Excess',
  balance: 'Balance',
  progress: 'Progress',
  standard: 'Standard',
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function InvoicesPage() {
  const router = useRouter()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single()
      if (!profile) { router.push('/login'); return }
      setTenantId((profile as { tenant_id: string }).tenant_id)
    }
    init()
  }, [router])

  const loadInvoices = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    try {
      let query = supabase
        .from('invoices')
        .select('id, invoice_ref, invoice_type, direction, status, amount_inc_gst, issued_date, job_id, tenant_id, created_at, jobs(job_number, insurer)')
        .eq('tenant_id', tenantId)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(200)

      if (statusFilter !== 'all') query = query.eq('status', statusFilter)
      if (typeFilter !== 'all') query = query.eq('invoice_type', typeFilter)
      if (dateFrom) query = query.gte('issued_date', dateFrom)
      if (dateTo) query = query.lte('issued_date', dateTo)

      const { data } = await query

      const rows: InvoiceRow[] = (data ?? []).map((row: Record<string, unknown>) => {
        const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
        return {
          id: row.id as string,
          invoice_ref: row.invoice_ref as string | null,
          invoice_type: row.invoice_type as string,
          direction: row.direction as string,
          status: row.status as string | null,
          amount_inc_gst: row.amount_inc_gst as number | null,
          issued_date: row.issued_date as string | null,
          job_id: row.job_id as string,
          tenant_id: row.tenant_id as string,
          created_at: row.created_at as string | null,
          job_number: (job as { job_number?: string } | null)?.job_number,
          insurer: (job as { insurer?: string | null } | null)?.insurer,
        }
      })
      setInvoices(rows)
    } finally {
      setLoading(false)
    }
  }, [tenantId, statusFilter, typeFilter, dateFrom, dateTo])

  useEffect(() => {
    if (!tenantId) return
    loadInvoices()
  }, [tenantId, loadInvoices])

  const markSent = useCallback(async (e: React.MouseEvent, invoice: InvoiceRow) => {
    e.stopPropagation()
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: tenantId!, status: 'sent' }),
    })
    if (res.ok) loadInvoices()
  }, [tenantId, loadInvoices])

  const uniqueTypes = Array.from(new Set(invoices.map(i => i.invoice_type)))

  return (
    <>
      <style>{`
        .inv-page { padding: 32px 36px 48px; font-family: 'DM Sans', sans-serif; }
        .inv-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 24px; }
        .inv-title { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.3px; }
        .inv-filter-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .inv-filter-btn { font-size: 12px; padding: 5px 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 500; border: 1px solid #e0dbd4; background: transparent; color: #9e998f; transition: all 0.15s; white-space: nowrap; }
        .inv-filter-btn:hover { border-color: #c8b89a; color: #3a3530; }
        .inv-filter-btn.active { background: #3a3530; color: #fff; border-color: #3a3530; }
        .inv-select { font-size: 12px; padding: 5px 10px; border-radius: 6px; border: 1px solid #e0dbd4; background: #fff; color: #3a3530; font-family: inherit; }
        .inv-date-input { font-size: 12px; padding: 5px 10px; border-radius: 6px; border: 1px solid #e0dbd4; background: #fff; color: #3a3530; font-family: inherit; }
        .inv-sep { width: 1px; height: 20px; background: #e0dbd4; }
        .inv-table-wrap { background: #fff; border: 1px solid #e0dbd4; border-radius: 8px; overflow: hidden; }
        .inv-table { width: 100%; border-collapse: collapse; }
        .inv-table th { font-size: 11px; font-weight: 600; color: #9e998f; text-align: left; padding: 10px 14px; border-bottom: 1px solid #e0dbd4; background: #fafaf8; white-space: nowrap; }
        .inv-table td { font-size: 13px; color: #3a3530; padding: 12px 14px; border-bottom: 1px solid #f0ece6; }
        .inv-table tr:last-child td { border-bottom: none; }
        .inv-table tbody tr:hover td { background: #faf9f7; cursor: pointer; }
        .inv-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
        .inv-type-badge { background: #e8e0d0; color: #3a3530; }
        .inv-mono { font-family: 'DM Mono', monospace; font-size: 12px; color: #c8b89a; }
        .inv-amount { font-weight: 600; }
        .inv-action-btn { font-size: 11px; font-weight: 500; color: #fff; background: #3a3530; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
        .inv-action-btn:hover { background: #2a2520; }
        .inv-empty { padding: 48px 24px; text-align: center; font-size: 13px; color: #9e998f; }
        .inv-loading { padding: 48px 24px; text-align: center; font-size: 13px; color: #9e998f; }
      `}</style>

      <div className="inv-page">
        <div className="inv-header">
          <span className="inv-title">Invoices</span>
        </div>

        {/* Filter bar */}
        <div className="inv-filter-bar">
          {['all', 'draft', 'sent', 'paid', 'voided'].map(s => (
            <button
              key={s}
              className={`inv-filter-btn${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <div className="inv-sep" />
          <select
            className="inv-select"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="all">All types</option>
            {uniqueTypes.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
          <div className="inv-sep" />
          <input
            type="date"
            className="inv-date-input"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            title="Invoice date from"
          />
          <span style={{ fontSize: 12, color: '#9e998f' }}>to</span>
          <input
            type="date"
            className="inv-date-input"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            title="Invoice date to"
          />
        </div>

        {/* Table */}
        <div className="inv-table-wrap">
          {loading ? (
            <div className="inv-loading">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="inv-empty">No invoices found</div>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Invoice Ref</th>
                  <th>Job</th>
                  <th>Insurer</th>
                  <th>Type</th>
                  <th>Invoice Date</th>
                  <th style={{ textAlign: 'right' }}>Amount inc GST</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const statusStyle = STATUS_STYLES[inv.status ?? 'draft'] ?? STATUS_STYLES.draft
                  return (
                    <tr key={inv.id} onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}>
                      <td><span className="inv-mono">{inv.invoice_ref ?? '—'}</span></td>
                      <td>
                        <span
                          className="inv-mono"
                          onClick={e => { e.stopPropagation(); router.push(`/dashboard/jobs/${inv.job_id}`) }}
                          style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          {inv.job_number ?? '—'}
                        </span>
                      </td>
                      <td>{inv.insurer ?? '—'}</td>
                      <td>
                        <span className="inv-badge inv-type-badge">
                          {TYPE_LABELS[inv.invoice_type] ?? inv.invoice_type}
                        </span>
                      </td>
                      <td>{fmtDate(inv.issued_date)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="inv-amount">{fmt(inv.amount_inc_gst ?? 0)}</span>
                      </td>
                      <td>
                        <span
                          className="inv-badge"
                          style={{ background: statusStyle.bg, color: statusStyle.text }}
                        >
                          {(inv.status ?? 'draft').charAt(0).toUpperCase() + (inv.status ?? 'draft').slice(1)}
                        </span>
                      </td>
                      <td>
                        {inv.status === 'draft' && (
                          <button className="inv-action-btn" onClick={e => markSent(e, inv)}>
                            Send
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
