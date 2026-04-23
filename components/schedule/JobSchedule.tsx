'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface JobScheduleProps {
  jobId: string
  tenantId: string
  // Optional interactive props for Work Orders tab
  workOrders?: any[]
  trades?: any[]
  expandedIds?: Set<string>
  onToggleExpand?: (id: string) => void
  onPlace?: (id: string) => void
  onUnplace?: (id: string) => void
  onSendOne?: (id: string) => void
  onCancel?: (id: string) => void
  onUpdate?: (id: string, u: any) => void
  onAddVisit?: (id: string) => void
  onDeleteVisit?: (workOrderId: string, visitId: string) => void
  onSetPred?: (id: string, predId: string | null) => void
  onReorder?: (orderedIds: string[]) => void
  onSetParent?: (id: string, parentId: string | null, offsetDays: number) => void
  onDraftGenerated?: () => void
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
  trades?: any
  visits: WorkOrderVisit[]
  scopeItems?: any[]
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

export default function JobSchedule({
  jobId,
  tenantId,
  workOrders: providedWorkOrders,
  trades: providedTrades,
  expandedIds,
  onToggleExpand,
  onPlace,
  onUnplace,
  onSendOne,
  onCancel,
  onUpdate,
  onAddVisit,
  onDeleteVisit,
  onSetPred,
  onReorder,
  onSetParent,
  onDraftGenerated,
}: JobScheduleProps) {
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [workOrders, setWorkOrders] = useState<WorkOrderWithTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Determine if we're in interactive mode (Work Orders tab) or read-only mode (Calendar tab)
  const isInteractive = !!providedWorkOrders

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Small movement required to start drag for smoother UX
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // If dropping on the same item, do nothing
    if (activeId === overId) return

    // Compute scheduled and unscheduled work orders from current state
    const scheduledWorkOrders = workOrders.filter(
      wo => wo.sequence_order !== null
    ).sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0))

    const unscheduledWorkOrders = workOrders.filter(
      wo => wo.sequence_order === null
    )

    // Find the visit cards for the active and over items
    const activeVC = scheduledVisitCards.find(vc => (vc.visit.id || `${vc.workOrder.id}-${vc.index}`) === activeId)
    const overVC = scheduledVisitCards.find(vc => (vc.visit.id || `${vc.workOrder.id}-${vc.index}`) === overId)

    if (!activeVC || !overVC) {
      // Try to find in unscheduled
      const unscheduledActive = unscheduledWorkOrders.find(wo => wo.id === activeId)
      const unscheduledOver = unscheduledWorkOrders.find(wo => wo.id === overId)

      if (unscheduledActive && overVC) {
        // Unscheduled card dropped on scheduled card -> place it
        if (onPlace) {
          onPlace(unscheduledActive.id)
        }
        return
      }

      if (activeVC && unscheduledOver) {
        // Scheduled card dropped on unscheduled card -> unplace it
        if (onUnplace) {
          onUnplace(activeVC.workOrder.id)
        }
        return
      }

      return
    }

    // Reordering within scheduled visit cards - allow independent visit movement
    const activeIndex = scheduledVisitCards.indexOf(activeVC)
    const overIndex = scheduledVisitCards.indexOf(overVC)

    if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
      // Reorder the visit cards independently
      const reorderedVisitCards = arrayMove(scheduledVisitCards, activeIndex, overIndex)
      
      // Reconstruct work orders based on the new visit order
      // Each work order's visits should be in the order they appear in the new sequence
      const newWorkOrderOrder: string[] = []
      const seenWorkOrders = new Set<string>()
      
      reorderedVisitCards.forEach(vc => {
        if (!seenWorkOrders.has(vc.workOrder.id)) {
          seenWorkOrders.add(vc.workOrder.id)
          newWorkOrderOrder.push(vc.workOrder.id)
        }
      })

      if (onReorder && newWorkOrderOrder.length > 0) {
        onReorder(newWorkOrderOrder)
      }
    }
  }

  useEffect(() => {
    // If workOrders are provided (interactive mode), use them directly
    if (providedWorkOrders && providedTrades) {
      const workOrdersWithVisits: WorkOrderWithTrade[] = providedWorkOrders.map((wo: any) => ({
        id: wo.id,
        trade_id: wo.trade_id,
        status: wo.status,
        gary_state: wo.gary_state,
        sequence_order: wo.sequence_order,
        predecessor_work_order_id: wo.predecessor_work_order_id,
        estimated_hours: wo.estimated_hours,
        proximity_range: wo.proximity_range,
        work_type: wo.work_type,
        trades: wo.trade || providedTrades.find((t: any) => t.id === wo.trade_id),
        visits: wo.visits || []
      }))
      setWorkOrders(workOrdersWithVisits)
      setLoading(false)

      // Fetch blueprint separately
      supabase
        .from('job_schedule_blueprints')
        .select('id, status, draft_data')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('status', 'confirmed')
        .single()
        .then(({ data }) => setBlueprint(data))
      return
    }

    // Otherwise fetch data (read-only mode)
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
  }, [jobId, tenantId, providedWorkOrders, providedTrades, supabase])

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

  // Flatten scheduled work orders into visit cards
  const scheduledVisitCards: Array<{ workOrder: WorkOrderWithTrade; visit: WorkOrderVisit; index: number; totalVisits: number }> = []
  scheduledWorkOrders.forEach(wo => {
    if (wo.visits.length > 0) {
      wo.visits.forEach((visit, vIndex) => {
        scheduledVisitCards.push({
          workOrder: wo,
          visit,
          index: vIndex,
          totalVisits: wo.visits.length,
        })
      })
    } else {
      // Work order with no visits - show as a placeholder card
      scheduledVisitCards.push({
        workOrder: wo,
        visit: {
          id: `${wo.id}-placeholder`,
          visit_number: 1,
          status: 'unscheduled',
        } as WorkOrderVisit,
        index: 0,
        totalVisits: 1,
      })
    }
  })

  const scheduledIds = scheduledVisitCards.map((vc, i) => vc.visit.id || `${vc.workOrder.id}-${vc.index}`)
  const unscheduledIds = unscheduledWorkOrders.map(wo => wo.id)
  const allIds = [...scheduledIds, ...unscheduledIds]

  return (
    <div
      style={{
        fontFamily: 'DM Sans, sans-serif',
        fontSize: 13,
        color: '#1a1a1a',
      }}
    >
      {isInteractive ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            {/* Main schedule */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '75%', maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                {scheduledVisitCards.map((vc, index) => (
                  <SortableVisitCard
                    key={vc.visit.id}
                    workOrder={vc.workOrder}
                    visit={vc.visit}
                    visitIndex={vc.index}
                    totalVisits={vc.totalVisits}
                    sequenceIndex={index}
                    isLast={index === scheduledVisitCards.length - 1}
                    onAddVisit={onAddVisit}
                    onDeleteVisit={onDeleteVisit}
                  />
                ))}
              </div>
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
                      background: '#e8e0d0',
                      color: '#9e998f',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 9,
                    }}
                  >
                    {unscheduledWorkOrders.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unscheduledWorkOrders.map(wo => (
                    <UnscheduledCard key={wo.id} workOrder={wo} onPlace={onPlace} />
                  ))}
                </div>
              </div>
            )}
          </SortableContext>
          <DragOverlay>
            {activeId ? (
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 8,
                  padding: '12px 14px 12px 18px',
                  opacity: 0.8,
                }}
              >
                {scheduledWorkOrders.find(wo => wo.id === activeId)?.trades?.business_name ||
                 unscheduledWorkOrders.find(wo => wo.id === activeId)?.trades?.business_name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        // Read-only mode (no drag and drop)
        <>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '75%', maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {scheduledVisitCards.map((vc, index) => (
                <SortableVisitCard
                  key={vc.visit.id}
                  workOrder={vc.workOrder}
                  visit={vc.visit}
                  visitIndex={vc.index}
                  totalVisits={vc.totalVisits}
                  sequenceIndex={index}
                  isLast={index === scheduledVisitCards.length - 1}
                  onAddVisit={onAddVisit}
                  onDeleteVisit={onDeleteVisit}
                />
              ))}
            </div>
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
                    background: '#e8e0d0',
                    color: '#9e998f',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 9,
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
        </>
      )}
    </div>
  )
}

// — Visit Card —————————————————————————————————————————————————————————

function SortableVisitCard({
  workOrder,
  visit,
  visitIndex,
  totalVisits,
  sequenceIndex,
  isLast,
  onAddVisit,
  onDeleteVisit,
}: {
  workOrder: WorkOrderWithTrade
  visit: WorkOrderVisit
  visitIndex: number
  totalVisits: number
  sequenceIndex: number
  isLast: boolean
  onAddVisit?: (id: string) => void
  onDeleteVisit?: (workOrderId: string, visitId: string) => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [showCommsPopup, setShowCommsPopup] = useState(false)
  const [showScopeItems, setShowScopeItems] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: visit.id || `${workOrder.id}-${visitIndex}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const statusColor = getStatusColor(workOrder.status || 'pending', workOrder.gary_state || 'not_started')
  const tradeName = workOrder.trades?.business_name || workOrder.trades?.primary_trade || 'Unknown Trade'
  const tradeType = workOrder.trades?.primary_trade || 'trade'

  const visitDate = visit.confirmed_date || visit.scheduled_date
  const visitNumber = visit.visit_number || visitIndex + 1
  const sequenceNumber = sequenceIndex + 1

  const handleDeleteVisit = () => {
    if (onDeleteVisit) {
      onDeleteVisit(workOrder.id, visit.id || `${workOrder.id}-${visitIndex}`)
    }
  }

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
          {sequenceNumber}
        </div>

        {/* Vertical line with arrow */}
        {!isLast && (
          <div
            style={{
              width: 2,
              flex: 1,
              background: '#e0dbd4',
              marginTop: 4,
              position: 'relative',
            }}
          >
            {/* Arrow pointer */}
            <div
              style={{
                position: 'absolute',
                bottom: -1,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: '6px solid #e0dbd4',
              }}
            />
          </div>
        )}
      </div>

      {/* Card */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          background: '#fff',
          border: '1px solid #e0dbd4',
          borderRadius: 8,
          position: 'relative',
          marginBottom: isLast ? 0 : 16,
          padding: '12px 14px 12px 18px',
          borderLeft: `4px solid ${statusColor.circle}`,
          ...style,
        }}
        {...attributes}
      >
        {/* Row 1: Trade name + type pill + chevron menu + x button + drag handle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          {/* Drag handle */}
          <div
            {...listeners}
            style={{
              cursor: 'grab',
              color: '#9e998f',
              padding: '2px',
              fontSize: 14,
              userSelect: 'none',
            }}
          >
            ⋮⋮
          </div>

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

          {/* Chevron menu - no border */}
          <div style={{ position: 'relative', marginLeft: 4 }}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{
                padding: '4px 6px',
                fontSize: 14,
                color: '#9e998f',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {showMenu ? '▼' : '▶'}
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: '#fff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  zIndex: 10,
                  minWidth: 160,
                }}
              >
                <button
                  onMouseEnter={() => setShowScopeItems(true)}
                  onMouseLeave={() => setShowScopeItems(false)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 12,
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    color: '#1a1a1a',
                  }}
                >
                  Scope items
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false)
                    setShowCommsPopup(true)
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 12,
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    color: '#1a1a1a',
                  }}
                >
                  Send comms
                </button>
              </div>
            )}

            {/* Scope items hover modal */}
            {showScopeItems && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: '#fff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  zIndex: 10,
                  minWidth: 300,
                  padding: '12px',
                }}
                onMouseEnter={() => setShowScopeItems(true)}
                onMouseLeave={() => setShowScopeItems(false)}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#1a1a1a',
                    marginBottom: 8,
                  }}
                >
                  Scope Items
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#9e998f',
                  }}
                >
                  {workOrder.scopeItems && workOrder.scopeItems.length > 0 ? (
                    workOrder.scopeItems.map((item: any, i: number) => (
                      <div key={i} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: i < workOrder.scopeItems!.length - 1 ? '1px solid #e0dbd4' : 'none' }}>
                        <div style={{ fontWeight: 500, color: '#1a1a1a' }}>{item.room || 'N/A'}</div>
                        <div style={{ color: '#9e998f' }}>{item.description || 'N/A'}</div>
                        <div style={{ fontSize: 10, color: '#9e998f' }}>Qty: {item.quantity || 'N/A'}</div>
                      </div>
                    ))
                  ) : (
                    <div>No scope items</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* X button to delete visit */}
          <button
            onClick={handleDeleteVisit}
            style={{
              marginLeft: 'auto',
              padding: '4px 8px',
              fontSize: 14,
              color: '#9e998f',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            ×
          </button>
        </div>

        {/* Row 2: Visit number + date */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          {/* + button for adding visit */}
          {onAddVisit && visitIndex === totalVisits - 1 && (
            <button
              onClick={() => onAddVisit(workOrder.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                fontSize: 16,
                fontWeight: 300,
                color: '#c9a96e',
                background: '#fef9f0',
                border: '1px solid #e8d9c0',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
                lineHeight: 1,
              }}
            >
              +
            </button>
          )}

          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: '#9e998f',
            }}
          >
            v{visitIndex + 1} of {totalVisits}
          </span>

          {visitDate && (
            <span
              style={{
                fontSize: 11,
                color: '#9e998f',
              }}
            >
              · {formatDate(visitDate)}
            </span>
          )}

          {visit.estimated_hours && (
            <span
              style={{
                fontSize: 11,
                color: '#9e998f',
              }}
            >
              · {visit.estimated_hours}h
            </span>
          )}
        </div>

        {/* Row 3: Status chip */}
        <StatusChip status={workOrder.status || 'pending'} garyState={workOrder.gary_state || 'not_started'} />
      </div>

      {/* Comms popup */}
      {showCommsPopup && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowCommsPopup(false)}
        >
          <div
            style={{
              background: '#fff',
              padding: '24px',
              borderRadius: 8,
              maxWidth: 400,
              fontFamily: 'DM Sans, sans-serif',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: '#1a1a1a',
                marginBottom: 12,
              }}
            >
              Communications
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#9e998f',
                marginBottom: 16,
              }}
            >
              This section of the app is not yet built.
            </div>
            <button
              onClick={() => setShowCommsPopup(false)}
              style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 500,
                color: '#1a1a1a',
                background: '#e8e0d0',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// — Unscheduled Card —————————————————————————————————————————————————————

function UnscheduledCard({
  workOrder,
  onPlace,
}: {
  workOrder: WorkOrderWithTrade
  onPlace?: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workOrder.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const tradeName = workOrder.trades?.business_name || workOrder.trades?.primary_trade || 'Unknown Trade'
  const tradeType = workOrder.trades?.primary_trade || 'trade'

  return (
    <div
      ref={setNodeRef}
      style={{
        background: '#fff',
        border: '1px dashed #e0dbd4',
        borderRadius: 7,
        padding: '10px 14px',
        borderLeft: '3px solid #e0dbd4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'grab',
        ...style,
      }}
      {...attributes}
      {...listeners}
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
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
