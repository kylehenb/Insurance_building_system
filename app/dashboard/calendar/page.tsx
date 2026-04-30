'use client'

import React, { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { Calendar, Clock, Users, Filter } from 'lucide-react'

type CalendarMode = 'inspections' | 'trades'
type ViewType = 'week' | 'month'

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
          .order('created_at', { ascending: true })

        setWorkOrders((workOrdersData as any) || [])
        setInspections([])
      }

      setLoading(false)
    }

    loadData()
  }, [tenantId, mode, supabase])

  const reloadInspections = async () => {
    if (!tenantId) return
    const tid = tenantId!

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
      .eq('tenant_id', tid)
      .in('status', ['unscheduled', 'proposed', 'confirmed', 'awaiting_reschedule'])
      .order('scheduled_date', { ascending: true, nullsFirst: false })

    setInspections((inspectionsData as any) || [])
  }

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
          onInspectionUpdate={reloadInspections}
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
  onInspectionUpdate,
}: {
  scheduledInspections: Inspection[]
  unscheduledInspections: Inspection[]
  tenantId: string | null
  supabase: any
  schedulingRules: SchedulingRules | null
  onInspectionUpdate: () => void
}) {
  const [viewType, setViewType] = useState<ViewType>('week')
  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [draggedInspection, setDraggedInspection] = useState<Inspection | null>(null)

  // Get week dates (Monday to Sunday)
  const getWeekDates = (date: Date) => {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust to make Monday first
    const monday = new Date(d.setDate(diff))
    
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday)
      day.setDate(monday.getDate() + i)
      return day
    })
  }

  // Get month dates
  const getMonthDates = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    
    const dates: Date[] = []
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - startDate.getDay() + 1) // Start from Monday
    
    const endDate = new Date(lastDay)
    if (endDate.getDay() !== 0) {
      endDate.setDate(endDate.getDate() + (7 - endDate.getDay()))
    }
    
    let current = new Date(startDate)
    while (current <= endDate) {
      dates.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    
    return dates
  }

  // Generate time slots (30min intervals from 8:00 to 17:00)
  const timeSlots = Array.from({ length: 19 }, (_, i) => {
    const hour = 8 + Math.floor(i / 2)
    const minute = (i % 2) * 30
    return { hour, minute, label: `${hour}:${minute.toString().padStart(2, '0')}` }
  })

  // Check if date is weekend
  const isWeekend = (date: Date) => {
    const day = date.getDay()
    return day === 0 || day === 6 // Sunday or Saturday
  }

  // Group inspections by date and time
  const inspectionsByDateTime: Record<string, Inspection[]> = {}
  const inspectionsByDate: Record<string, Inspection[]> = {}
  scheduledInspections.forEach(inspection => {
    if (inspection.scheduled_date) {
      // Group by date and time for time slots
      const key = `${inspection.scheduled_date}-${inspection.scheduled_time || ''}`
      if (!inspectionsByDateTime[key]) {
        inspectionsByDateTime[key] = []
      }
      inspectionsByDateTime[key].push(inspection)
      
      // Also group by date only for inspections without times
      if (!inspection.scheduled_time) {
        if (!inspectionsByDate[inspection.scheduled_date]) {
          inspectionsByDate[inspection.scheduled_date] = []
        }
        inspectionsByDate[inspection.scheduled_date].push(inspection)
      }
    }
  })

  const handleDragStart = (inspection: Inspection) => {
    setDraggedInspection(inspection)
  }

  const handleDragEnd = async (date: Date, time: string | null = null) => {
    if (!draggedInspection || !tenantId) return

    const dateStr = date.toISOString().split('T')[0]
    
    const { error } = await supabase
      .from('inspections')
      .update({ 
        scheduled_date: dateStr,
        scheduled_time: time
      })
      .eq('id', draggedInspection.id)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('Error updating inspection:', error)
      return
    }

    setDraggedInspection(null)
    onInspectionUpdate()
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

  const weekDates = getWeekDates(currentDate)
  const monthDates = getMonthDates(currentDate)

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {/* Calendar */}
      <div style={{ flex: 1 }}>
        {/* Header with view toggle */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={16} style={{ color: '#9e998f' }} />
          
          {/* Navigation buttons */}
          <button
            onClick={() => {
              const newDate = new Date(currentDate)
              if (viewType === 'week') {
                newDate.setDate(newDate.getDate() - 7)
              } else {
                newDate.setMonth(newDate.getMonth() - 1)
              }
              setCurrentDate(newDate)
            }}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              background: 'transparent',
              color: '#1a1a1a',
              border: '1px solid #e0dbd4',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            ←
          </button>
          
          <button
            onClick={() => setCurrentDate(new Date())}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              background: 'transparent',
              color: '#1a1a1a',
              border: '1px solid #e0dbd4',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Today
          </button>
          
          <button
            onClick={() => {
              const newDate = new Date(currentDate)
              if (viewType === 'week') {
                newDate.setDate(newDate.getDate() + 7)
              } else {
                newDate.setMonth(newDate.getMonth() + 1)
              }
              setCurrentDate(newDate)
            }}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              background: 'transparent',
              color: '#1a1a1a',
              border: '1px solid #e0dbd4',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            →
          </button>
          
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {viewType === 'week' 
              ? `${weekDates[0].toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })} - ${weekDates[6].toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : currentDate.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
            }
          </span>
          
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={() => setViewType('week')}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 500,
                background: viewType === 'week' ? '#1a1a1a' : 'transparent',
                color: viewType === 'week' ? '#f5f0e8' : '#1a1a1a',
                border: '1px solid #e0dbd4',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Week
            </button>
            <button
              onClick={() => setViewType('month')}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 500,
                background: viewType === 'month' ? '#1a1a1a' : 'transparent',
                color: viewType === 'month' ? '#f5f0e8' : '#1a1a1a',
                border: '1px solid #e0dbd4',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Month
            </button>
          </div>
          
          {schedulingRules && (
            <span style={{ marginLeft: 16, fontSize: 11, color: '#9e998f' }}>
              Max: {schedulingRules.max_daily_inspections}/day · {schedulingRules.scheduling_mode} mode
            </span>
          )}
        </div>

        {/* Week View */}
        {viewType === 'week' && (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', minWidth: 800 }}>
              {/* Time column header */}
              <div></div>
              
              {/* Day headers */}
              {weekDates.map(date => {
                const dateStr = date.toISOString().split('T')[0]
                const isWeekendDay = isWeekend(date)
                const dayInspectionsNoTime = inspectionsByDate[dateStr] || []
                return (
                  <div
                    key={dateStr}
                    style={{
                      padding: '8px 4px',
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: 12,
                      background: isWeekendDay ? '#f5f0e8' : '#fff',
                      borderBottom: '1px solid #e0dbd4',
                      borderRight: '1px solid #e0dbd4',
                      minHeight: 60,
                      position: 'relative',
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDragEnd(date, null)}
                  >
                    <div style={{ color: isWeekendDay ? '#9e998f' : '#1a1a1a' }}>
                      {date.toLocaleDateString('en-AU', { weekday: 'short' })}
                    </div>
                    <div style={{ fontSize: 11, color: isWeekendDay ? '#9e998f' : '#1a1a1a' }}>
                      {date.getDate()}
                    </div>
                    {dayInspectionsNoTime.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {dayInspectionsNoTime.map(inspection => {
                          const statusColor = getStatusColor(inspection.status)
                          return (
                            <div
                              key={inspection.id}
                              draggable
                              onDragStart={() => handleDragStart(inspection)}
                              style={{
                                background: statusColor.bg,
                                border: `1px solid ${statusColor.border}`,
                                borderRadius: 3,
                                padding: '2px 4px',
                                cursor: 'grab',
                                fontSize: 9,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: statusColor.text,
                              }}
                              title={`${inspection.jobs.job_number} - ${inspection.jobs.insured_name}`}
                            >
                              {inspection.jobs.job_number}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Time slots */}
              {timeSlots.map(slot => (
                <React.Fragment key={slot.label}>
                  {/* Time label */}
                  <div
                    style={{
                      padding: '4px 8px',
                      fontSize: 10,
                      color: '#9e998f',
                      textAlign: 'right',
                      borderBottom: '1px solid #f0ebe4',
                      height: 30,
                    }}
                  >
                    {slot.label}
                  </div>
                  
                  {/* Day columns */}
                  {weekDates.map(date => {
                    const dateStr = date.toISOString().split('T')[0]
                    const timeStr = `${slot.hour.toString().padStart(2, '0')}:${slot.minute.toString().padStart(2, '0')}`
                    const key = `${dateStr}-${timeStr}`
                    const slotInspections = inspectionsByDateTime[key] || []
                    const isWeekendDay = isWeekend(date)
                    
                    return (
                      <div
                        key={key}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDragEnd(date, timeStr)}
                        style={{
                          padding: 2,
                          borderBottom: '1px solid #f0ebe4',
                          borderRight: '1px solid #e0dbd4',
                          background: isWeekendDay ? '#f9f8f6' : '#fff',
                          height: 30,
                          position: 'relative',
                          ...(draggedInspection ? { background: isWeekendDay ? '#f0ebe4' : '#f5f0e8' } : {}),
                        }}
                      >
                        {slotInspections.map(inspection => {
                          const statusColor = getStatusColor(inspection.status)
                          return (
                            <div
                              key={inspection.id}
                              draggable
                              onDragStart={() => handleDragStart(inspection)}
                              style={{
                                background: statusColor.bg,
                                border: `1px solid ${statusColor.border}`,
                                borderRadius: 3,
                                padding: '2px 4px',
                                cursor: 'grab',
                                fontSize: 10,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: statusColor.text,
                              }}
                              title={`${inspection.jobs.job_number} - ${inspection.jobs.insured_name}`}
                            >
                              {inspection.jobs.job_number}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Month View */}
        {viewType === 'month' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {/* Day headers */}
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <div
                key={day}
                style={{
                  padding: '8px',
                  textAlign: 'center',
                  fontWeight: 600,
                  fontSize: 12,
                  background: '#f5f0e8',
                }}
              >
                {day}
              </div>
            ))}
            
            {/* Month grid */}
            {monthDates.map(date => {
              const dateStr = date.toISOString().split('T')[0]
              const isWeekendDay = isWeekend(date)
              const isCurrentMonth = date.getMonth() === currentDate.getMonth()
              const dayInspections = scheduledInspections.filter(i => i.scheduled_date === dateStr)
              
              return (
                <div
                  key={dateStr}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDragEnd(date)}
                  style={{
                    minHeight: 80,
                    padding: 4,
                    background: isCurrentMonth ? '#fff' : '#f9f8f6',
                    border: '1px solid #e0dbd4',
                    ...(isWeekendDay ? { background: isCurrentMonth ? '#f5f0e8' : '#ebe6de' } : {}),
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4, color: isCurrentMonth ? '#1a1a1a' : '#9e998f' }}>
                    {date.getDate()}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {dayInspections.slice(0, 3).map(inspection => {
                      const statusColor = getStatusColor(inspection.status)
                      return (
                        <div
                          key={inspection.id}
                          draggable
                          onDragStart={() => handleDragStart(inspection)}
                          style={{
                            background: statusColor.bg,
                            border: `1px solid ${statusColor.border}`,
                            borderRadius: 2,
                            padding: '2px 4px',
                            cursor: 'grab',
                            fontSize: 9,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            color: statusColor.text,
                          }}
                          title={`${inspection.jobs.job_number} - ${inspection.jobs.insured_name}`}
                        >
                          {inspection.jobs.job_number}
                        </div>
                      )
                    })}
                    {dayInspections.length > 3 && (
                      <div style={{ fontSize: 9, color: '#9e998f' }}>
                        +{dayInspections.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
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

          <div style={{ background: '#f9f8f6', border: '1px solid #e0dbd4', borderRadius: 8, padding: 16, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
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
