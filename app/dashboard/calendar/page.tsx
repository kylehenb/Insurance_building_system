'use client'

import React, { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { Calendar, Clock, Users, Filter } from 'lucide-react'

type CalendarMode = 'inspections' | 'trades'

interface Inspection {
  id: string
  job_id: string
  inspection_ref: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  status: string | null
  inspector_id: string | null
  jobs: {
    job_number: string | null
    insured_name: string | null
    property_address: string | null
    insurer: string | null
  }
  users: {
    name: string | null
  } | null
}

interface WorkOrder {
  id: string
  work_order_ref: string | null
  work_type: string | null
  status: string | null
  trades: {
    business_name: string | null
    primary_trade: string | null
  } | null
  jobs: {
    job_number: string | null
    property_address: string | null
  }
  work_order_visits: Array<{
    id: string
    visit_number: number
    scheduled_date: string | null
    status: string | null
  }>
}

interface SchedulingRules {
  max_daily_inspections: number
  first_appointment_time: string
  last_appointment_time: string
  inspection_buffer_minutes: number
  scheduling_mode: string
}

export default function GlobalCalendarPage() {
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [mode, setMode] = useState<CalendarMode>('inspections')
  const [loading, setLoading] = useState(true)
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [schedulingRules, setSchedulingRules] = useState<SchedulingRules | null>(null)

  useEffect(() => {
    async function loadTenant() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('tenant_id')
          .eq('id', user.id)
          .single()
        
        if (userData?.tenant_id) {
          setTenantId(userData.tenant_id)
        }
      }
    }
    loadTenant()
  }, [supabase])

  useEffect(() => {
    if (!tenantId) return

    async function loadData() {
      setLoading(true)
      // Non-null assertion is safe here because we check tenantId above
      const tid = tenantId!

      // Fetch scheduling rules
      const { data: rulesData } = await supabase
        .from('inspection_scheduling_rules')
        .select('max_daily_inspections, first_appointment_time, last_appointment_time, inspection_buffer_minutes, scheduling_mode')
        // @ts-ignore - tid is guaranteed to be string after the null check above
        .eq('tenant_id', tid!)
        .single()

      if (rulesData) {
        setSchedulingRules(rulesData as SchedulingRules)
      }

      if (mode === 'inspections') {
        const { data: inspectionsData } = await supabase
          .from('inspections')
          .select(`
            id,
            job_id,
            inspection_ref,
            scheduled_date,
            scheduled_time,
            status,
            inspector_id,
            jobs (
              job_number,
              insured_name,
              property_address,
              insurer
            ),
            users (
              name
            )
          `)
          // @ts-ignore - tid is guaranteed to be string after the null check above
          .eq('tenant_id', tid!)
          .in('status', ['unscheduled', 'proposed', 'confirmed', 'awaiting_reschedule'])
          .order('scheduled_date', { ascending: true, nullsFirst: false })

        setInspections((inspectionsData as any) || [])
        setWorkOrders([])
      } else {
        const { data: workOrdersData } = await supabase
          .from('work_orders')
          .select(`
            id,
            work_order_ref,
            work_type,
            status,
            trades (
              business_name,
              primary_trade
            ),
            jobs (
              job_number,
              property_address
            ),
            work_order_visits (
              id,
              visit_number,
              scheduled_date,
              status
            )
          `)
          // @ts-ignore - tid is guaranteed to be string after the null check above
          .eq('tenant_id', tid!)
          .in('status', ['pending', 'engaged', 'works_complete'])
          .order('created_at', { ascending: false })

        setWorkOrders((workOrdersData as any) || [])
        setInspections([])
      }

      setLoading(false)
    }

    loadData()
  }, [tenantId, mode, supabase])

  const scheduledInspections = inspections.filter(i => i.scheduled_date)
  const unscheduledInspections = inspections.filter(i => !i.scheduled_date)

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1a1a1a' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Calendar
        </h1>
        <p style={{ color: '#9e998f', fontSize: 14 }}>
          Schedule inspections and track trade work
        </p>
      </div>

      {/* Mode Toggle */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, background: '#f5f0e8', padding: 4, borderRadius: 8, width: 'fit-content' }}>
          <button
            onClick={() => setMode('inspections')}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              background: mode === 'inspections' ? '#1a1a1a' : 'transparent',
              color: mode === 'inspections' ? '#f5f0e8' : '#1a1a1a',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            <Calendar size={16} />
            Inspections
          </button>
          <button
            onClick={() => setMode('trades')}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              background: mode === 'trades' ? '#1a1a1a' : 'transparent',
              color: mode === 'trades' ? '#f5f0e8' : '#1a1a1a',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            <Users size={16} />
            Trades
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9e998f' }}>
          Loading…
        </div>
      ) : mode === 'inspections' ? (
        <InspectionsCalendar
          scheduledInspections={scheduledInspections}
          unscheduledInspections={unscheduledInspections}
          tenantId={tenantId}
          supabase={supabase}
          schedulingRules={schedulingRules}
        />
      ) : (
        <TradesCalendar workOrders={workOrders} />
      )}
    </div>
  )
}

function InspectionsCalendar({
  scheduledInspections,
  unscheduledInspections,
  tenantId,
  supabase,
  schedulingRules,
}: {
  scheduledInspections: Inspection[]
  unscheduledInspections: Inspection[]
  tenantId: string | null
  supabase: any
  schedulingRules: SchedulingRules | null
}) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [draggedInspection, setDraggedInspection] = useState<Inspection | null>(null)

  // Group inspections by date
  const inspectionsByDate: Record<string, Inspection[]> = {}
  scheduledInspections.forEach(inspection => {
    if (inspection.scheduled_date) {
      const dateKey = inspection.scheduled_date
      if (!inspectionsByDate[dateKey]) {
        inspectionsByDate[dateKey] = []
      }
      inspectionsByDate[dateKey].push(inspection)
    }
  })

  // Get next 7 days
  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() + i)
    return date
  })

  const handleDragStart = (inspection: Inspection) => {
    setDraggedInspection(inspection)
  }

  const handleDragEnd = async (date: Date) => {
    if (!draggedInspection || !tenantId) return

    const dateStr = date.toISOString().split('T')[0]
    
    await supabase
      .from('inspections')
      .update({ scheduled_date: dateStr })
      .eq('id', draggedInspection.id)
      .eq('tenant_id', tenantId)

    setDraggedInspection(null)
    // Reload data
    window.location.reload()
  }

  const formatDate = (date: Date) => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    
    return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const formatTime = (time: string | null) => {
    if (!time) return ''
    const [hours, minutes] = time.split(':')
    const hour = parseInt(hours)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `${hour12}:${minutes} ${ampm}`
  }

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'confirmed':
        return { bg: '#d4edda', text: '#155724', border: '#c3e6cb' }
      case 'proposed':
        return { bg: '#fff3cd', text: '#856404', border: '#ffeaa7' }
      case 'awaiting_reschedule':
        return { bg: '#f8d7da', text: '#721c24', border: '#f5c6cb' }
      default:
        return { bg: '#e2e3e5', text: '#383d41', border: '#d6d8db' }
    }
  }

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {/* Calendar Grid */}
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={16} style={{ color: '#9e998f' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Next 7 Days</span>
          {schedulingRules && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9e998f' }}>
              Max: {schedulingRules.max_daily_inspections}/day · {schedulingRules.scheduling_mode} mode
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
          {next7Days.map(date => {
            const dateStr = date.toISOString().split('T')[0]
            const dayInspections = inspectionsByDate[dateStr] || []

            return (
              <div
                key={dateStr}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDragEnd(date)}
                style={{
                  background: '#fff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 8,
                  padding: 16,
                  minHeight: 200,
                  ...(draggedInspection ? { background: '#f9f8f6' } : {}),
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
                  {formatDate(date)}
                </div>

                {dayInspections.length === 0 ? (
                  <div style={{ color: '#9e998f', fontSize: 12, fontStyle: 'italic' }}>
                    No inspections
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dayInspections.map(inspection => {
                      const statusColor = getStatusColor(inspection.status)
                      return (
                        <div
                          key={inspection.id}
                          draggable
                          onDragStart={() => handleDragStart(inspection)}
                          style={{
                            background: statusColor.bg,
                            border: `1px solid ${statusColor.border}`,
                            borderRadius: 6,
                            padding: 10,
                            cursor: 'grab',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: statusColor.text, marginBottom: 4 }}>
                            {inspection.jobs.job_number}
                          </div>
                          <div style={{ color: '#1a1a1a', marginBottom: 4 }}>
                            {inspection.jobs.insured_name}
                          </div>
                          <div style={{ color: '#9e998f', fontSize: 11, marginBottom: 4 }}>
                            {inspection.jobs.property_address}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            {inspection.scheduled_time && (
                              <span style={{ color: '#1a1a1a' }}>
                                {formatTime(inspection.scheduled_time)}
                              </span>
                            )}
                            {inspection.users?.name && (
                              <span style={{ color: '#9e998f' }}>
                                · {inspection.users.name}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Unscheduled */}
      {unscheduledInspections.length > 0 && (
        <div style={{ width: 300, flexShrink: 0 }}>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={16} style={{ color: '#9e998f' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              Unscheduled ({unscheduledInspections.length})
            </span>
          </div>

          <div style={{ background: '#f9f8f6', border: '1px solid #e0dbd4', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unscheduledInspections.map(inspection => (
                <div
                  key={inspection.id}
                  draggable
                  onDragStart={() => handleDragStart(inspection)}
                  style={{
                    background: '#fff',
                    border: '1px solid #e0dbd4',
                    borderRadius: 6,
                    padding: 10,
                    cursor: 'grab',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {inspection.jobs.job_number}
                  </div>
                  <div style={{ color: '#1a1a1a', marginBottom: 4 }}>
                    {inspection.jobs.insured_name}
                  </div>
                  <div style={{ color: '#9e998f', fontSize: 11 }}>
                    {inspection.jobs.property_address}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TradesCalendar({ workOrders }: { workOrders: WorkOrder[] }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#9e998f' }}>
      <div style={{ fontSize: 16, marginBottom: 8 }}>Trades Calendar</div>
      <div style={{ fontSize: 13 }}>
        This view will show work orders in a timeline format.
        <br />
        Coming soon.
      </div>
      <div style={{ marginTop: 24, fontSize: 12 }}>
        {workOrders.length} work orders loaded
      </div>
    </div>
  )
}
