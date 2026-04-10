'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// — Types ——————————————————————————————————————————————————————————
interface WorkflowCounts {
  inspections: number
  reports: number
  quotes: number
  scope_items: number
}

interface CommEntry {
  id: string
  type: string
  direction: string | null
  contact_name: string | null
  content: string | null
  created_at: string
}

interface ActionItem {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
}

interface JobDetails {
  sum_insured: number | null
  assigned_to: string | null
  created_at: string
  excess: number | null
}

interface OverviewTabProps {
  jobId: string
  tenantId: string
  job: JobDetails
}

// — Helpers ————————————————————————————————————————————————————————
function formatCurrency(v: number | null) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatRelativeTime(s: string) {
  const diff = Date.now() - new Date(s).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return formatDate(s)
}

// Channel initial → color
const COMM_COLORS: Record<string, string> = {
  email: '#1a73e8',
  sms: '#2e7d32',
  note: '#b45309',
}

function commInitial(type: string) {
  return type.charAt(0).toUpperCase()
}

// — Stat tile ————————————————————————————————————————————————————
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg p-4"
      style={{ background: '#f5f2ee' }}
    >
      <span className="text-2xl font-semibold text-[#3a3530]">{value}</span>
      <span className="mt-1 text-[11px] uppercase tracking-[0.07em] text-[#9e998f]">{label}</span>
    </div>
  )
}

// — Card wrapper —————————————————————————————————————————————————
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border border-[#e0dbd4] bg-white overflow-hidden"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      {children}
    </div>
  )
}

function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0dbd4]">
      <span className="text-[11px] uppercase tracking-[0.07em] text-[#9e998f] font-medium">
        {title}
      </span>
      {action}
    </div>
  )
}

// — Detail pair ——————————————————————————————————————————————————
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-[#f0ece6] last:border-0">
      <span className="w-32 flex-shrink-0 text-[12px] text-[#9e998f]">{label}</span>
      <span className="text-[13px] text-[#3a3530]">{value || '—'}</span>
    </div>
  )
}

// — OverviewTab ——————————————————————————————————————————————————
export function OverviewTab({ jobId, tenantId, job }: OverviewTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [counts, setCounts] = useState<WorkflowCounts>({ inspections: 0, reports: 0, quotes: 0, scope_items: 0 })
  const [comms, setComms] = useState<CommEntry[]>([])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [loadingComms, setLoadingComms] = useState(true)
  const [loadingActions, setLoadingActions] = useState(true)
  const [updatingAction, setUpdatingAction] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [inspRes, repRes, quoRes, actRes, commRes] = await Promise.all([
        supabase.from('inspections').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('tenant_id', tenantId),
        supabase.from('reports').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('tenant_id', tenantId).is('deleted_at', null),
        supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('tenant_id', tenantId),
        supabase.from('action_queue').select('id,title,description,status,priority').eq('job_id', jobId).eq('tenant_id', tenantId).eq('status', 'pending').order('priority', { ascending: true }),
        supabase.from('communications').select('id,type,direction,contact_name,content,created_at').eq('job_id', jobId).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(3),
      ])

      // scope items requires quote IDs — skip for now, show 0
      setCounts({
        inspections: inspRes.count ?? 0,
        reports: repRes.count ?? 0,
        quotes: quoRes.count ?? 0,
        scope_items: 0,
      })

      setActions((actRes.data ?? []) as ActionItem[])
      setLoadingActions(false)

      setComms((commRes.data ?? []) as CommEntry[])
      setLoadingComms(false)
    }

    load()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleActionConfirm(actionId: string) {
    setUpdatingAction(actionId)
    await supabase
      .from('action_queue')
      .update({ status: 'confirmed' })
      .eq('id', actionId)
      .eq('tenant_id', tenantId)
    setActions(prev => prev.filter(a => a.id !== actionId))
    setUpdatingAction(null)
  }

  async function handleActionSkip(actionId: string) {
    setUpdatingAction(actionId)
    await supabase
      .from('action_queue')
      .update({ status: 'skipped' })
      .eq('id', actionId)
      .eq('tenant_id', tenantId)
    setActions(prev => prev.filter(a => a.id !== actionId))
    setUpdatingAction(null)
  }

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 272px', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Left column */}
      <div className="space-y-5">
        {/* Workflow status */}
        <Card>
          <CardHeader title="Workflow Status" />
          <div className="p-4 grid grid-cols-2 gap-3">
            <StatTile label="Inspections" value={counts.inspections} />
            <StatTile label="Reports" value={counts.reports} />
            <StatTile label="Quotes" value={counts.quotes} />
            <StatTile label="Scope Items" value={counts.scope_items} />
          </div>
        </Card>

        {/* Communications */}
        <Card>
          <CardHeader
            title="Communications"
            action={
              <button className="text-[11px] text-[#c8b89a] hover:text-[#b0a88a] transition-colors">
                Full feed →
              </button>
            }
          />
          <div className="divide-y divide-[#f0ece6]">
            {loadingComms ? (
              <div className="px-4 py-6 text-[13px] text-[#9e998f] text-center">Loading…</div>
            ) : comms.length === 0 ? (
              <div className="px-4 py-6 text-[13px] text-[#9e998f] text-center">No communications yet</div>
            ) : (
              comms.map(c => {
                const color = COMM_COLORS[c.type] ?? '#9e998f'
                const initial = commInitial(c.type)
                const dirLabel = c.direction === 'inbound' ? 'Inbound' : c.direction === 'outbound' ? 'Outbound' : 'Note'
                return (
                  <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-semibold"
                      style={{ background: color }}
                    >
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[13px] font-medium text-[#3a3530]">
                          {c.contact_name || 'Unknown'}
                        </span>
                        <span className="text-[11px] text-[#9e998f]">{formatRelativeTime(c.created_at)}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: '#f5f2ee', color: '#9e998f' }}
                        >
                          {dirLabel}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#9e998f] truncate">
                        {c.content || '(no content)'}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Card>
      </div>

      {/* Right column */}
      <div className="space-y-5">
        {/* Action queue */}
        <Card>
          <CardHeader title="Action Queue" />
          <div className="p-4 space-y-3">
            {loadingActions ? (
              <p className="text-[13px] text-[#9e998f] text-center py-2">Loading…</p>
            ) : actions.length === 0 ? (
              <p className="text-[13px] text-[#9e998f] text-center py-4">No pending actions</p>
            ) : (
              actions.map(a => (
                <div
                  key={a.id}
                  className="rounded-lg border border-[#e0dbd4] p-3 space-y-2"
                  style={{ background: '#faf9f7' }}
                >
                  <p className="text-[13px] font-medium text-[#3a3530]">{a.title}</p>
                  {a.description && (
                    <p className="text-[12px] text-[#9e998f]">{a.description}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleActionConfirm(a.id)}
                      disabled={updatingAction === a.id}
                      className="flex-1 py-1.5 rounded text-[12px] font-medium text-white transition-colors"
                      style={{ background: '#3a3530' }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => handleActionSkip(a.id)}
                      disabled={updatingAction === a.id}
                      className="flex-1 py-1.5 rounded text-[12px] font-medium text-[#9e998f] border border-[#e0dbd4] hover:bg-[#f5f2ee] transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Job details */}
        <Card>
          <CardHeader title="Job Details" />
          <div className="px-4 py-2">
            <DetailRow label="Sum Insured" value={formatCurrency(job.sum_insured)} />
            <DetailRow label="Excess" value={formatCurrency(job.excess)} />
            <DetailRow label="Assigned To" value={job.assigned_to ?? ''} />
            <DetailRow label="Order Received" value={formatDate(job.created_at)} />
          </div>
        </Card>
      </div>
    </div>
  )
}
