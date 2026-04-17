'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { AccordionList } from './shared/AccordionList'

type WorkOrderRow = Database['public']['Tables']['work_orders']['Row']
type WorkOrderVisitRow = Database['public']['Tables']['work_order_visits']['Row']
type TradeRow = Database['public']['Tables']['trades']['Row']

interface WorkOrderWithDetails extends WorkOrderRow {
  visits: WorkOrderVisitRow[]
  trade: TradeRow | null
}

interface TradeWorkOrdersTabProps {
  jobId: string
}

function WorkOrderStatusBadge({ status, garyState }: { status: string | null; garyState: string | null }) {
  const getStatusColor = () => {
    if (status === 'pending') return { bg: '#f5f2ee', color: '#9e998f' }
    if (status === 'engaged') return { bg: '#e8f5e9', color: '#2e7d32' }
    if (status === 'works_complete') return { bg: '#e3f2fd', color: '#1976d2' }
    if (status === 'invoice_received') return { bg: '#f3e5f5', color: '#7b1fa2' }
    return { bg: '#f5f2ee', color: '#9e998f' }
  }

  const { bg, color } = getStatusColor()

  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          background: bg,
          color: color,
          fontSize: 11,
          fontWeight: 500,
          padding: '2px 7px',
          borderRadius: 4,
        }}
      >
        {status || 'Pending'}
      </span>
      {garyState && garyState !== 'not_started' && (
        <span
          style={{
            background: '#fff3e0',
            color: '#e65100',
            fontSize: 10,
          }}
          className="px-2 py-0.5 rounded"
        >
          Gary: {garyState}
        </span>
      )}
    </div>
  )
}

function VisitStatusBadge({ status }: { status: string | null }) {
  const getStatusColor = () => {
    if (status === 'unscheduled') return { bg: '#f5f2ee', color: '#9e998f' }
    if (status === 'gary_sent') return { bg: '#fff3e0', color: '#e65100' }
    if (status === 'proposed') return { bg: '#e3f2fd', color: '#1976d2' }
    if (status === 'confirmed') return { bg: '#e8f5e9', color: '#2e7d32' }
    if (status === 'complete') return { bg: '#f3f4f6', color: '#6b7280' }
    return { bg: '#f5f2ee', color: '#9e998f' }
  }

  const { bg, color } = getStatusColor()

  return (
    <span
      style={{
        background: bg,
        color: color,
        fontSize: 10,
        fontWeight: 500,
        padding: '1px 5px',
        borderRadius: 3,
      }}
    >
      {status || 'Unscheduled'}
    </span>
  )
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function TradeWorkOrdersTab({ jobId }: TradeWorkOrdersTabProps) {
  const [workOrders, setWorkOrders] = useState<WorkOrderWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function fetchWorkOrders() {
      const { data: woData } = await supabase
        .from('work_orders')
        .select(`
          *,
          trade:trades(business_name, primary_trade)
        `)
        .eq('job_id', jobId)
        .order('sequence_order', { ascending: true, nullsFirst: false })

      if (!woData) {
        setWorkOrders([])
        setLoading(false)
        return
      }

      const workOrderIds = woData.map(wo => wo.id)

      const { data: visitsData } = await supabase
        .from('work_order_visits')
        .select('*')
        .in('work_order_id', workOrderIds)
        .order('visit_number', { ascending: true })

      const visitsMap = new Map<string, WorkOrderVisitRow[]>()
      visitsData?.forEach(visit => {
        if (!visitsMap.has(visit.work_order_id)) {
          visitsMap.set(visit.work_order_id, [])
        }
        visitsMap.get(visit.work_order_id)!.push(visit)
      })

      const formattedData = (woData as any[])?.map(wo => ({
        ...wo,
        visits: visitsMap.get(wo.id) || [],
        trade: wo.trade,
      })) || []

      setWorkOrders(formattedData)
      setLoading(false)
    }

    fetchWorkOrders()
  }, [jobId, supabase])

  return (
    <AccordionList title="Trade Work Orders">
      {loading ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[13px] text-[#9e998f]">Loading work orders...</p>
        </div>
      ) : workOrders.length === 0 ? (
        <div
          className="px-4 py-12 text-center"
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        >
          <p className="text-[13px] text-[#9e998f]">
            No work orders yet. Work orders are created once a quote is approved.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#f0ece6]">
          {workOrders.map((wo) => (
            <div key={wo.id} className="p-4">
              {/* Work Order Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium text-[#1a1a1a]">
                      {wo.trade?.business_name || 'Unassigned Trade'}
                    </h3>
                    {wo.trade?.primary_trade && (
                      <span className="text-xs text-[#9e998f]">
                        {wo.trade.primary_trade}
                      </span>
                    )}
                  </div>
                  {wo.work_type && (
                    <p className="text-xs text-[#1a1a1a]/60 mt-0.5">
                      {wo.work_type}
                    </p>
                  )}
                </div>
                <WorkOrderStatusBadge status={wo.status} garyState={wo.gary_state} />
              </div>

              {/* Work Order Details */}
              <div className="grid grid-cols-3 gap-4 mb-3 text-xs">
                <div>
                  <span className="text-[#b0a898]">Sequence:</span>
                  <span className="ml-2 text-[#1a1a1a]">
                    {wo.sequence_order ?? '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#b0a898]">Est. Hours:</span>
                  <span className="ml-2 text-[#1a1a1a]">
                    {wo.estimated_hours ?? '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#b0a898]">Visits:</span>
                  <span className="ml-2 text-[#1a1a1a]">
                    {wo.current_visit || 0} / {wo.total_visits || 1}
                  </span>
                </div>
              </div>

              {/* Visits */}
              {wo.visits.length > 0 && (
                <div className="mt-3 border-t border-[#f0ece6] pt-3">
                  <p className="text-xs font-medium text-[#b0a898] mb-2">Visits</p>
                  <div className="space-y-2">
                    {wo.visits.map((visit) => (
                      <div
                        key={visit.id}
                        className="flex items-center justify-between text-xs bg-[#faf9f7] p-2 rounded"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-[#1a1a1a]">
                            Visit {visit.visit_number}
                          </span>
                          {visit.estimated_hours && (
                            <span className="text-[#9e998f]">
                              {visit.estimated_hours}h
                            </span>
                          )}
                          {visit.lag_description && (
                            <span className="text-[#9e998f]">
                              +{visit.lag_days_after}d {visit.lag_description}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {visit.scheduled_date && (
                            <span className="text-[#1a1a1a]/70">
                              {formatDate(visit.scheduled_date)}
                            </span>
                          )}
                          <VisitStatusBadge status={visit.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {wo.notes && (
                <div className="mt-3 border-t border-[#f0ece6] pt-3">
                  <p className="text-xs text-[#9e998f]">{wo.notes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AccordionList>
  )
}
