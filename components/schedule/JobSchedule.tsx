'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

interface JobScheduleProps {
  jobId: string
  tenantId: string
}

interface WorkOrderWithTrade {
  id: string
  trade_id: string | null
  status: string | null
  gary_state: string | null
  sequence_order: number | null
  predecessor_work_order_id: string | null
  estimated_hours: number | null
  proximity_range: string | null
  work_type: string | null
  trades: {
    business_name: string | null
    primary_trade: string | null
    contact_mobile: string | null
  } | null
  visits: WorkOrderVisit[]
}

interface WorkOrderVisit {
  id: string | null
  visit_number: number
  scheduled_date: string | null
  confirmed_date: string | null
  status: string | null
  lag_days_after: number | null
  lag_description: string | null
  estimated_hours: number | null
}

interface Blueprint {
  id: string
  status: string | null
  draft_data: any
}

export default function JobSchedule({ jobId, tenantId }: JobScheduleProps) {
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [workOrders, setWorkOrders] = useState<WorkOrderWithTrade[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      setLoading(true)

      // Fetch confirmed blueprint
      const { data: blueprintData } = await supabase
        .from('job_schedule_blueprints')
        .select('id, status, draft_data')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('status', 'confirmed')
        .single()

      setBlueprint(blueprintData)

      // Fetch work orders with trade info
      const { data: workOrdersData } = await supabase
        .from('work_orders')
        .select(`
          id,
          trade_id,
          status,
          gary_state,
          sequence_order,
          predecessor_work_order_id,
          estimated_hours,
          proximity_range,
          work_type,
          trades (
            business_name,
            primary_trade,
            contact_mobile
          )
        `)
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)

      if (workOrdersData) {
        // Fetch visits for each work order
        const workOrderIds = workOrdersData.map(wo => wo.id)
        const { data: visitsData } = await supabase
          .from('work_order_visits')
          .select('*')
          .in('work_order_id', workOrderIds)
          .eq('tenant_id', tenantId)
          .order('visit_number', { ascending: true })

        // Group visits by work order
        const visitsByWorkOrder: Record<string, WorkOrderVisit[]> = {}
        if (visitsData) {
          visitsData.forEach(visit => {
            if (!visitsByWorkOrder[visit.work_order_id]) {
              visitsByWorkOrder[visit.work_order_id] = []
            }
            visitsByWorkOrder[visit.work_order_id].push(visit)
          })
        }

        const workOrdersWithVisits: WorkOrderWithTrade[] = workOrdersData.map((wo: any) => ({
          id: wo.id,
          trade_id: wo.trade_id,
          status: wo.status,
          gary_state: wo.gary_state,
          sequence_order: wo.sequence_order,
          predecessor_work_order_id: wo.predecessor_work_order_id,
          estimated_hours: wo.estimated_hours,
          proximity_range: wo.proximity_range,
          work_type: wo.work_type,
          trades: wo.trades,
          visits: visitsByWorkOrder[wo.id] || []
        }))

        setWorkOrders(workOrdersWithVisits)
      }

      setLoading(false)
    }

    loadData()
  }, [jobId, tenantId, supabase])

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading schedule…
      </div>
    )
  }

  if (!blueprint) {
    return (
      <div
        style={{
          background: '#fff',
          border: '1px solid #e0dbd4',
          borderRadius: 8,
          padding: '40px',
          textAlign: 'center',
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: '#9e998f',
            marginBottom: 8,
          }}
        >
          No schedule confirmed yet
        </div>
        <div
          style={{
            fontSize: 11,
            color: '#9e998f',
          }}
        >
          Confirm a blueprint to activate the schedule and Gary.
        </div>
      </div>
    )
  }

  // Separate scheduled and unscheduled work orders
  const scheduledWorkOrders = workOrders.filter(
    wo => wo.sequence_order !== null
  ).sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0))

  const unscheduledWorkOrders = workOrders.filter(
    wo => wo.sequence_order === null
  )

  return (
    <div
      style={{
        fontFamily: 'DM Sans, sans-serif',
        fontSize: 13,
        color: '#1a1a1a',
      }}
    >
      {/* Main schedule */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {scheduledWorkOrders.map((wo, index) => (
          <WorkOrderCard
            key={wo.id}
            workOrder={wo}
            index={index}
            isLast={index === scheduledWorkOrders.length - 1}
          />
        ))}
      </div>

      {/* Unscheduled section */}
      {unscheduledWorkOrders.length > 0 && (
        <div
          style={{
            marginTop: 24,
            borderTop: '2px dashed #e0dbd4',
            paddingTop: 16,
            background: '#f9f8f6',
            borderRadius: 8,
            padding: '16px',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: '#9e998f',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            Unscheduled
            <span
              style={{
                background: '#e0dbd4',
                color: '#6b7280',
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 12,
              }}
            >
              {unscheduledWorkOrders.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unscheduledWorkOrders.map(wo => (
              <UnscheduledCard key={wo.id} workOrder={wo} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// — Work Order Card ———————————————————————————————————————————————————————

function WorkOrderCard({
  workOrder,
  index,
  isLast,
}: {
  workOrder: WorkOrderWithTrade
  index: number
  isLast: boolean
}) {
  const statusColor = getStatusColor(workOrder.status || 'pending', workOrder.gary_state || 'not_started')
  const tradeName = workOrder.trades?.business_name || workOrder.trades?.primary_trade || 'Unknown Trade'
  const tradeType = workOrder.trades?.primary_trade || 'trade'

  const visitCount = workOrder.visits.length
  const estimatedHours = workOrder.estimated_hours

  // Get last or next date
  const dates = workOrder.visits
    .map(v => v.confirmed_date || v.scheduled_date)
    .filter((d): d is string => d !== null)
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : null

  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {/* Gutter */}
      <div
        style={{
          width: 48,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* Sequence circle */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: statusColor.circle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'DM Mono, monospace',
            fontSize: 11,
            fontWeight: 600,
            color: statusColor.text,
            zIndex: 1,
          }}
        >
          {index + 1}
        </div>

        {/* Vertical line */}
        {!isLast && (
          <div
            style={{
              width: 2,
              flex: 1,
              background: '#e0dbd4',
              marginTop: 4,
              position: 'relative',
            }}
          />
        )}
      </div>

      {/* Card */}
      <div
        style={{
          flex: 1,
          background: '#fff',
          border: '1px solid #e0dbd4',
          borderRadius: 8,
          position: 'relative',
          marginBottom: isLast ? 0 : 16,
          padding: '12px 14px 12px 18px',
          borderLeft: `4px solid ${statusColor.circle}`,
        }}
      >
        {/* Row 1: Trade name + type pill + proximity + status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#1a1a1a',
            }}
          >
            {tradeName}
          </span>
          <span
            style={{
              fontSize: 8.5,
              textTransform: 'uppercase',
              fontWeight: 700,
              background: '#e8e0d0',
              color: '#9e998f',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {tradeType}
          </span>
          {workOrder.proximity_range === 'extended' && (
            <span
              style={{
                fontSize: 9,
                background: '#fef3c7',
                color: '#92400e',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 500,
              }}
            >
              Extended
            </span>
          )}
          <div style={{ flex: 1 }} />
          <StatusChip status={workOrder.status || 'pending'} garyState={workOrder.gary_state || 'not_started'} />
        </div>

        {/* Row 2: Meta line */}
        <div
          style={{
            fontSize: 11,
            color: '#9e998f',
            marginBottom: 8,
          }}
        >
          {visitCount > 0 && `${visitCount} visit${visitCount > 1 ? 's' : ''} · `}
          {estimatedHours && `${estimatedHours}h · `}
          {lastDate && formatDate(lastDate)}
        </div>

        {/* Visit pills */}
        {workOrder.visits.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workOrder.visits.map((visit, vIndex) => (
              <div key={visit.id || vIndex}>
                <VisitPill visit={visit} />
                {(visit.lag_days_after || 0) > 0 && vIndex < workOrder.visits.length - 1 && (
                  <LagRow
                    lagDays={visit.lag_days_after || 0}
                    description={visit.lag_description}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// — Unscheduled Card —————————————————————————————————————————————————————

function UnscheduledCard({ workOrder }: { workOrder: WorkOrderWithTrade }) {
  const tradeName = workOrder.trades?.business_name || workOrder.trades?.primary_trade || 'Unknown Trade'
  const tradeType = workOrder.trades?.primary_trade || 'trade'

  return (
    <div
      style={{
        background: '#fff',
        border: '1px dashed #e0dbd4',
        borderRadius: 7,
        padding: '10px 14px',
        borderLeft: '3px solid #e0dbd4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
            {tradeName}
          </span>
          <span
            style={{
              fontSize: 8.5,
              textTransform: 'uppercase',
              fontWeight: 700,
              background: '#e8e0d0',
              color: '#9e998f',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {tradeType}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            fontStyle: 'italic',
            color: '#9e998f',
          }}
        >
          Not yet placed in schedule
        </div>
      </div>
      <button
        style={{
          fontSize: 11,
          color: '#c9a96e',
          background: 'transparent',
          border: '1px solid #e8d9c0',
          borderRadius: 6,
          padding: '4px 12px',
          cursor: 'pointer',
          fontFamily: 'DM Sans, sans-serif',
          fontWeight: 500,
        }}
      >
        + Add to schedule
      </button>
    </div>
  )
}

// — Visit Pill ————————————————————————————————————————————————————————————

function VisitPill({ visit }: { visit: WorkOrderVisit }) {
  const date = visit.confirmed_date || visit.scheduled_date

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11,
      }}
    >
      <span
        style={{
          fontFamily: 'DM Mono, monospace',
          fontSize: 10,
          fontWeight: 600,
          color: '#1a1a1a',
        }}
      >
        V{visit.visit_number}
      </span>
      {date && (
        <span style={{ color: '#6b7280' }}>
          {formatDate(date)}
        </span>
      )}
      <VisitStatusChip status={visit.status || 'unscheduled'} />
    </div>
  )
}

// — Lag Row ———————————————————————————————————————————————————————————————

function LagRow({ lagDays, description }: { lagDays: number; description: string | null }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontFamily: 'DM Mono, monospace',
        color: '#9e998f',
        background: '#fef9f0',
        borderLeft: '3px solid #f0ddb8',
        padding: '4px 8px',
        marginTop: 2,
      }}
    >
      <span>⏳</span>
      <span>{description || 'Waiting period'}</span>
      <span>{lagDays}d</span>
    </div>
  )
}

// — Status Chip ——————————————————————————————————————————————————————————

function StatusChip({ status, garyState }: { status: string; garyState: string }) {
  const config = getStatusChipConfig(status, garyState)

  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        background: config.bg,
        color: config.text,
        padding: '3px 8px',
        borderRadius: 12,
      }}
    >
      {config.label}
    </span>
  )
}

function VisitStatusChip({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    unscheduled: { bg: '#f9fafb', text: '#6b7280', label: 'Unscheduled' },
    gary_sent: { bg: '#fffbeb', text: '#d97706', label: 'Gary Sent' },
    proposed: { bg: '#f0fdf4', text: '#16a34a', label: 'Proposed' },
    confirmed: { bg: '#f0fdf4', text: '#16a34a', label: 'Confirmed' },
    complete: { bg: '#f0f9ff', text: '#0284c7', label: 'Complete' },
  }

  const cfg = config[status] || config.unscheduled

  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.text,
        padding: '3px 8px',
        borderRadius: 12,
      }}
    >
      {cfg.label}
    </span>
  )
}

// — Helpers ———————————————————————————————————————————————————————————————

function getStatusColor(status: string, garyState: string) {
  if (status === 'works_complete' || status === 'invoice_received') {
    return { circle: '#0284c7', text: '#fff' }
  }
  if (status === 'engaged' || garyState === 'confirmed') {
    return { circle: '#16a34a', text: '#fff' }
  }
  if (garyState === 'waiting_reply' || garyState === 'gary_sent') {
    return { circle: '#d97706', text: '#fff' }
  }
  return { circle: '#e5e7eb', text: '#6b7280' }
}

function getStatusChipConfig(status: string, garyState: string) {
  if (status === 'works_complete' || status === 'invoice_received') {
    return { bg: '#f0f9ff', text: '#0284c7', label: 'Complete' }
  }
  if (status === 'engaged' || garyState === 'confirmed') {
    return { bg: '#f0fdf4', text: '#16a34a', label: 'Confirmed' }
  }
  if (garyState === 'waiting_reply' || garyState === 'gary_sent') {
    return { bg: '#fffbeb', text: '#d97706', label: 'Waiting' }
  }
  if (garyState === 'waiting_on_dependent') {
    return { bg: '#faf5ff', text: '#7c3aed', label: 'Blocked' }
  }
  return { bg: '#f9fafb', text: '#6b7280', label: 'Pending' }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}
