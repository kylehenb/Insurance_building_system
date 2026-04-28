'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
import { OverviewTab } from './OverviewTab'
import { InspectionsTab } from './InspectionsTab'
import { ReportsTabWrapper } from './ReportsTabWrapper'
import { QuotesTab } from './QuotesTab'
import { PhotosTab } from './PhotosTab'
import { FilesTab } from './FilesTab'
import { InsurerOrdersTab } from './InsurerOrdersTab'
import { InvoicesTab } from './InvoicesTab'
import { JobBudgetTab } from './JobBudgetTab'
import { SafetyTab } from './SafetyTab'
import { WorkOrdersTab } from '../work-orders/WorkOrdersTab'

// — Types ——————————————————————————————————————————————————————————
interface JobHeader {
  id: string
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
  claim_description: string | null
  special_instructions: string | null
  notes: string | null
  contacts: unknown
  adjuster_reference: string | null
  order_sender_name: string | null
  order_sender_email: string | null
  client_id: string | null
}

interface JobDetailShellProps {
  job: JobHeader
  jobId: string
  tenantId: string
  currentUserId: string
  currentUserRole: string
  pendingActionCount: number
  isFlagged: boolean
  stageBanner?: React.ReactNode
}

// — Tab definitions ———————————————————————————————————————————————
const TABS = [
  { id: 'overview',         label: 'Overview' },
  { id: 'inspections',      label: 'Inspections' },
  { id: 'reports',          label: 'Reports' },
  { id: 'quotes',           label: 'Quotes' },
  { id: 'work-orders',      label: 'Work Orders' },
  { id: 'photos',           label: 'Photos' },
  { id: 'files',            label: 'Files' },
  { id: 'insurer-orders',   label: 'Insurer Orders' },
  { id: 'invoices',         label: 'Invoices' },
  { id: 'job-budget',       label: 'Job Budget' },
  { id: 'safety',           label: 'Safety' },
] as const

type TabId = (typeof TABS)[number]['id']

// — Status badge ——————————————————————————————————————————————————
function StatusBadge({ override_stage }: { override_stage: 'on_hold' | 'cancelled' | null }) {
  if (!override_stage) return null
  const label = override_stage === 'on_hold' ? 'On Hold' : 'Cancelled'
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium"
      style={{
        background: override_stage === 'on_hold' ? '#fdf5e8' : '#fdecea',
        color: override_stage === 'on_hold' ? '#8a6020' : '#b91c1c',
        border: '1px solid #e0dbd4',
      }}
    >
      {label}
    </span>
  )
}

// — Flag button ———————————————————————————————————————————————————
function FlagButton({
  isFlagged,
  onToggle,
  disabled,
}: {
  isFlagged: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-200 hover:bg-[#f5f2ee] disabled:opacity-50 disabled:cursor-not-allowed"
      title={isFlagged ? 'Remove flag' : 'Flag this job'}
    >
      <span
        className="text-[16px]"
        style={{
          color: isFlagged ? '#e24b4a' : '#c8b89a',
          opacity: isFlagged ? 1 : 0.6,
        }}
      >
        {isFlagged ? '🚩' : '�️'}
      </span>
    </button>
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
          job={job}
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
    case 'work-orders':
      return null // rendered outside the padded wrapper below
    case 'photos':
      return <PhotosTab jobId={jobId} tenantId={tenantId} />
    case 'files':
      return <FilesTab jobId={jobId} />
    case 'insurer-orders':
      return <InsurerOrdersTab jobId={jobId} tenantId={tenantId} />
    case 'invoices':
      return <InvoicesTab jobId={jobId} tenantId={tenantId} />
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
  isFlagged,
  stageBanner,
}: JobDetailShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const activeTab = (searchParams.get('tab') ?? 'overview') as TabId
  const [pendingTab, setPendingTab] = useState<TabId | null>(null)
  const [flagged, setFlagged] = useState(isFlagged)
  const [togglingFlag, setTogglingFlag] = useState(false)

  useEffect(() => {
    setPendingTab(null)
  }, [activeTab])

  async function toggleFlag() {
    if (togglingFlag) return
    setTogglingFlag(true)

    try {
      if (flagged) {
        // Remove flag
        await supabase
          .from('job_flags')
          .delete()
          .eq('job_id', jobId)
          .eq('user_id', currentUserId)
          .eq('tenant_id', tenantId)
        setFlagged(false)
      } else {
        // Add flag
        await supabase
          .from('job_flags')
          .insert({
            job_id: jobId,
            user_id: currentUserId,
            tenant_id: tenantId,
          })
        setFlagged(true)
      }
    } catch (error) {
      console.error('Failed to toggle flag:', error)
    } finally {
      setTogglingFlag(false)
    }
  }

  function setTab(tabId: TabId) {
    setPendingTab(tabId)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tabId)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="min-h-screen" style={{ background: '#f5f2ee', fontFamily: 'DM Sans, sans-serif' }}>
      <style>{`
        .jds-tab {
          position: relative;
          white-space: nowrap;
          padding: 10px 16px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-bottom: 2px solid transparent;
          background: transparent;
          cursor: pointer;
          transition: color 0.15s, background 0.15s;
          font-family: inherit;
        }
        .jds-tab:hover {
          background: #f5f2ee;
          color: #1a1a1a;
        }
        .jds-tab.active {
          color: #1a1a1a;
          border-bottom-color: #1a1a1a;
        }
        .jds-tab.inactive {
          color: #9e998f;
        }
        .jds-tab.pending:not(.active)::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: #c8b89a;
          animation: tab-pulse 0.8s ease-in-out infinite alternate;
        }
        @keyframes tab-pulse {
          from { opacity: 0.4; }
          to { opacity: 1; }
        }
      `}</style>

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
                <StatusBadge override_stage={job.override_stage} />
                <FlagButton
                  isFlagged={flagged}
                  onToggle={toggleFlag}
                  disabled={togglingFlag}
                />
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

              {/* Compact field strip */}
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-[#9e998f]">
                {[
                  { label: 'Insurer',      value: job.insurer },
                  { label: 'Claim #',      value: job.claim_number },
                  { label: 'Loss Type',    value: job.loss_type },
                  { label: 'Date of Loss', value: job.date_of_loss
                      ? new Date(job.date_of_loss).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—' },
                  { label: 'Adjuster',     value: job.adjuster },
                ].map((item) => (
                  <span
                    key={item.label}
                    className="flex items-center"
                  >
                    <span className="mr-1 text-[#b0a898]">{item.label}:</span>
                    <span className="text-[#3a3530]">{item.value || '—'}</span>
                  </span>
                ))}
              </div>
            </div>
            {/* Stage banner panel */}
            {stageBanner}
          </div>

          {/* Tab bar */}
          <nav className="-mb-px flex gap-0 overflow-x-auto">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              const isPending = pendingTab === tab.id && !isActive
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className={`jds-tab${isActive ? ' active' : ' inactive'}${isPending ? ' pending' : ''}`}
                >
                  {tab.label}
                  {isPending && (
                    <span
                      style={{
                        display: 'inline-block',
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: '#c8b89a',
                        marginLeft: 5,
                        verticalAlign: 'middle',
                        animation: 'tab-pulse 0.8s ease-in-out infinite alternate',
                      }}
                    />
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────── */}
      {activeTab === 'work-orders' ? (
        <div style={{ height: 'auto', overflow: 'auto' }}>
          <WorkOrdersTab jobId={jobId} tenantId={tenantId} />
        </div>
      ) : (
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
      )}
    </div>
  )
}
