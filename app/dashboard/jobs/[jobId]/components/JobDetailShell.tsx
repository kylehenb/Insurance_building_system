'use client'

import React from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { OverviewTab } from './OverviewTab'
import { InspectionsTab } from './InspectionsTab'
import { ReportsTabWrapper } from './ReportsTabWrapper'
import { QuotesTab } from './QuotesTab'
import { TradeWorkOrdersTab } from './TradeWorkOrdersTab'
import { PhotosTab } from './PhotosTab'
import { FilesTab } from './FilesTab'
import { InsurerOrdersTab } from './InsurerOrdersTab'
import { InvoicesTab } from './InvoicesTab'
import { JobBudgetTab } from './JobBudgetTab'
import { SafetyTab } from './SafetyTab'

// — Types ——————————————————————————————————————————————————————————
interface JobHeader {
  id: string
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
}

interface JobDetailShellProps {
  job: JobHeader
  jobId: string
  tenantId: string
  currentUserId: string
  currentUserRole: string
  pendingActionCount: number
}

// — Tab definitions ———————————————————————————————————————————————
const TABS = [
  { id: 'overview',         label: 'Overview' },
  { id: 'inspections',      label: 'Inspections' },
  { id: 'reports',          label: 'Reports' },
  { id: 'quotes',           label: 'Quotes' },
  { id: 'trade-work-orders',label: 'Trade Work Orders' },
  { id: 'photos',           label: 'Photos' },
  { id: 'files',            label: 'Files' },
  { id: 'insurer-orders',   label: 'Insurer Orders' },
  { id: 'invoices',         label: 'Invoices' },
  { id: 'job-budget',       label: 'Job Budget' },
  { id: 'safety',           label: 'Safety' },
] as const

type TabId = (typeof TABS)[number]['id']

// — Helpers ————————————————————————————————————————————————————————
function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(v: number | null) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

// — Status badge ——————————————————————————————————————————————————
function StatusBadge({ status }: { status: string }) {
  const isActive = status === 'active'
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium"
      style={{
        background: isActive ? '#e8f5e9' : '#f5f2ee',
        color: isActive ? '#2e7d32' : '#9e998f',
        border: isActive ? 'none' : '1px solid #e0dbd4',
      }}
    >
      {status === 'active' ? 'Active' : status === 'complete' ? 'Closed' : status}
    </span>
  )
}

// — Tab panel renderer ————————————————————————————————————————————
function TabPanel({
  activeTab,
  jobId,
  tenantId,
  currentUserId,
  currentUserRole,
  job,
}: {
  activeTab: TabId
  jobId: string
  tenantId: string
  currentUserId: string
  currentUserRole: string
  job: JobHeader
}) {
  switch (activeTab) {
    case 'overview':
      return (
        <OverviewTab
          jobId={jobId}
          tenantId={tenantId}
          job={{
            sum_insured: job.sum_insured,
            assigned_to: job.assigned_to,
            created_at: job.created_at,
            excess: job.excess,
          }}
        />
      )
    case 'inspections':
      return <InspectionsTab jobId={jobId} tenantId={tenantId} />
    case 'reports':
      return (
        <ReportsTabWrapper
          jobId={jobId}
          tenantId={tenantId}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      )
    case 'quotes':
      return <QuotesTab jobId={jobId} tenantId={tenantId} />
    case 'trade-work-orders':
      return <TradeWorkOrdersTab jobId={jobId} />
    case 'photos':
      return <PhotosTab jobId={jobId} tenantId={tenantId} />
    case 'files':
      return <FilesTab jobId={jobId} />
    case 'insurer-orders':
      return <InsurerOrdersTab jobId={jobId} tenantId={tenantId} />
    case 'invoices':
      return <InvoicesTab jobId={jobId} />
    case 'job-budget':
      return <JobBudgetTab jobId={jobId} />
    case 'safety':
      return <SafetyTab jobId={jobId} />
    default:
      return null
  }
}

// — JobDetailShell ——————————————————————————————————————————————
export function JobDetailShell({
  job,
  jobId,
  tenantId,
  currentUserId,
  currentUserRole,
  pendingActionCount,
}: JobDetailShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const activeTab = (searchParams.get('tab') ?? 'overview') as TabId

  function setTab(tabId: TabId) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tabId)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="min-h-screen" style={{ background: '#f5f2ee', fontFamily: 'DM Sans, sans-serif' }}>
      {/* ── Job header ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#e0dbd4]">
        <div className="px-6 lg:px-8 pt-6 pb-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1
                  className="text-[22px] font-semibold text-[#1a1a1a]"
                  style={{ fontFamily: 'DM Mono, monospace' }}
                >
                  {job.job_number}
                </h1>
                <StatusBadge status={job.status} />
                {pendingActionCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span className="text-[12px] text-amber-700">
                      {pendingActionCount} action{pendingActionCount !== 1 ? 's' : ''} pending
                    </span>
                  </span>
                )}
              </div>
              {job.insured_name && (
                <p className="text-[14px] font-medium text-[#3a3530]">{job.insured_name}</p>
              )}
              {job.property_address && (
                <p className="text-[13px] text-[#9e998f]">{job.property_address}</p>
              )}
            </div>
          </div>

          {/* Compact field strip */}
          <div
            className="flex items-center flex-wrap gap-0 mb-4 text-[12px] text-[#9e998f]"
          >
            {[
              { label: 'Insurer', value: job.insurer },
              { label: 'Claim #', value: job.claim_number },
              { label: 'Loss Type', value: job.loss_type },
              { label: 'Date of Loss', value: formatDate(job.date_of_loss) },
              { label: 'Adjuster', value: job.adjuster },
              { label: 'Excess', value: formatCurrency(job.excess) },
            ].map((item, i, arr) => (
              <span
                key={item.label}
                className="flex items-center pr-4 mr-4"
                style={{
                  borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none',
                }}
              >
                <span className="mr-1 text-[#b0a898]">{item.label}:</span>
                <span className="text-[#3a3530]">{item.value || '—'}</span>
              </span>
            ))}
          </div>

          {/* Tab bar */}
          <nav className="-mb-px flex gap-0 overflow-x-auto">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className="whitespace-nowrap px-4 py-3 text-[13px] font-medium transition-colors border-b-2"
                  style={{
                    borderBottomColor: isActive ? '#1a1a1a' : 'transparent',
                    color: isActive ? '#1a1a1a' : '#9e998f',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────── */}
      <div className="px-6 lg:px-8 py-6">
        <div className="mx-auto max-w-6xl">
          <TabPanel
            activeTab={activeTab}
            jobId={jobId}
            tenantId={tenantId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            job={job}
          />
        </div>
      </div>
    </div>
  )
}
