'use client'

import React, { useState } from 'react'
import { type WorkOrderWithDetails, type WorkOrderRow, type TradeRow, woIsSent } from './types'
import { WorkOrderCard } from './WorkOrderCard'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'

// ─── SortableWorkOrderCard wrapper ─────────────────────────────────────────────
function SortableWorkOrderCard({
  wo,
  isExpanded,
  onToggleExpand,
  onPlace,
  onUnplace,
  onSendOne,
  onCancel,
  onUpdate,
  onAddVisit,
  onSetPredecessor,
  trades,
  allPlacedOrders,
  visitNumber,
}: {
  wo: WorkOrderWithDetails
  isExpanded: boolean
  onToggleExpand: () => void
  onPlace: () => void
  onUnplace: () => void
  onSendOne: () => void
  onCancel: () => void
  onUpdate: (u: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string }) => void
  onAddVisit: () => void
  onSetPredecessor: (predId: string | null) => void
  trades: TradeRow[]
  allPlacedOrders: WorkOrderWithDetails[]
  visitNumber?: number // If provided, render as a visit card
}) {
  const id = visitNumber !== undefined ? `${wo.id}-visit-${visitNumber}` : wo.id
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const visit = visitNumber !== undefined ? wo.visits.find(v => v.visit_number === visitNumber) : undefined

  return (
    <div ref={setNodeRef} style={style}>
      <WorkOrderCard
        wo={wo}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onPlace={onPlace}
        onUnplace={onUnplace}
        onSendOne={onSendOne}
        onCancel={onCancel}
        onUpdate={onUpdate}
        onAddVisit={onAddVisit}
        onSetPredecessor={onSetPredecessor}
        trades={trades}
        allPlacedOrders={allPlacedOrders}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        dragHandleProps={{ ...attributes, ...listeners }}
        visitNumber={visitNumber}
        visit={visit}
      />
    </div>
  )
}

// ─── Droppable column wrapper ───────────────────────────────────────────────────
function DroppableColumn({
  id,
  children,
  style,
}: {
  id: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        outline: isOver ? '2px dashed #c9a96e' : undefined,
        outlineOffset: isOver ? -4 : undefined,
        borderRadius: isOver ? 4 : undefined,
      }}
    >
      {children}
    </div>
  )
}

export interface BlueprintViewProps {
  workOrders:  WorkOrderWithDetails[]
  trades:      TradeRow[]
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  onPlace:     (id: string) => void
  onUnplace:   (id: string) => void
  onSendOne:   (id: string) => void
  onCancel:    (id: string) => void
  onUpdate:    (id: string, u: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string }) => void
  onAddVisit:  (id: string) => void
  onSetPred:   (id: string, predId: string | null) => void
  onReorder:   (orderedIds: string[]) => void
  onReorderVisits: (orderedVisitIds: Array<{ workOrderId: string; visitNumber: number }>) => void
  onSetParent: (id: string, parentId: string | null, offsetDays: number) => void
}

export function BlueprintView({
  workOrders,
  trades,
  expandedIds,
  onToggleExpand,
  onPlace,
  onUnplace,
  onSendOne,
  onCancel,
  onUpdate,
  onAddVisit,
  onSetPred,
  onReorder,
  onReorderVisits,
}: BlueprintViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const placed   = workOrders.filter(w => w.placementState !== 'unplaced')
  const unplaced = workOrders.filter(w => w.placementState === 'unplaced')

  // Flatten placed work orders into individual visit items for multi-visit work orders
  // Sort by visit sequence_order (or work order sequence_order for single-visit work orders)
  const placedItems: Array<{ wo: WorkOrderWithDetails; visitNumber?: number; sequenceOrder: number }> = []
  placed.forEach(wo => {
    if ((wo.total_visits ?? 1) > 1 && wo.visits.length > 0) {
      // Render each visit as a separate item, sorted by visit sequence_order
      const sortedVisits = [...wo.visits].sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999))
      sortedVisits.forEach(visit => {
        placedItems.push({ wo, visitNumber: visit.visit_number, sequenceOrder: visit.sequence_order ?? wo.sequence_order ?? 999 })
      })
    } else {
      // Single visit work order, render as one item
      placedItems.push({ wo, sequenceOrder: wo.sequence_order ?? 999 })
    }
  })

  // Sort all placed items by sequence_order
  placedItems.sort((a, b) => a.sequenceOrder - b.sequenceOrder)

  // ── dnd-kit drag handlers ───────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const activeId = active.id as string
    const overId = over?.id as string | undefined

    setActiveId(null)

    if (!overId) return

    // Extract work order ID from visit ID if it's a visit
    const activeWoId = activeId.includes('-visit-') ? activeId.split('-visit-')[0] : activeId
    const activeWo = workOrders.find(w => w.id === activeWoId)
    if (!activeWo) return

    const overWoId = overId.includes('-visit-') ? overId.split('-visit-')[0] : overId
    const overWo = workOrders.find(w => w.id === overWoId)

    // Check if dropping on unplaced column
    if (overId === 'unplaced-column') {
      if (woIsSent(activeWo)) {
        alert('Cannot unplace a sent work order. Use Cancel if needed.')
        return
      }
      onUnplace(activeWoId)
      return
    }

    // Check if dropping on placed column
    if (overId === 'placed-column') {
      if (activeWo.placementState === 'unplaced') {
        // Validate gate
        if (!activeWo.trade_id) {
          alert('Cannot place: Select a contractor first')
          return
        }
        if (!(activeWo.estimated_hours && activeWo.estimated_hours > 0)) {
          alert('Cannot place: Set estimated hours first')
          return
        }
        onPlace(activeWoId)
      }
      return
    }

    // Reordering within a column
    if (overWo) {
      const activeIsPlaced = activeWo.placementState !== 'unplaced'
      const overIsPlaced = overWo.placementState !== 'unplaced'

      // Moving between columns
      if (activeIsPlaced !== overIsPlaced) {
        if (overIsPlaced) {
          // Moving to placed
          if (!activeWo.trade_id) {
            alert('Cannot place: Select a contractor first')
            return
          }
          if (!(activeWo.estimated_hours && activeWo.estimated_hours > 0)) {
            alert('Cannot place: Set estimated hours first')
            return
          }
          onPlace(activeWoId)
        } else {
          // Moving to unplaced
          if (woIsSent(activeWo)) {
            alert('Cannot unplace a sent work order. Use Cancel if needed.')
            return
          }
          onUnplace(activeWoId)
        }
        return
      }

      // Reordering within same column
      if (activeIsPlaced && overIsPlaced) {
        // Get the current order of items (including visits)
        const currentItemIds = placedItems.map(item =>
          item.visitNumber !== undefined ? `${item.wo.id}-visit-${item.visitNumber}` : item.wo.id
        )

        const oldIndex = currentItemIds.indexOf(activeId)
        const newIndex = currentItemIds.indexOf(overId)

        if (oldIndex !== -1 && newIndex !== -1) {
          // Reorder the items
          const newOrder = [...currentItemIds]
          newOrder.splice(oldIndex, 1)
          newOrder.splice(newIndex, 0, activeId)

          // Convert to visit-level reordering
          const orderedVisitIds: Array<{ workOrderId: string; visitNumber: number }> = []

          newOrder.forEach(itemId => {
            if (itemId.includes('-visit-')) {
              const [woId, visitNum] = itemId.split('-visit-')
              orderedVisitIds.push({ workOrderId: woId, visitNumber: parseInt(visitNum) })
            } else {
              // Single-visit work order, use visit number 1
              orderedVisitIds.push({ workOrderId: itemId, visitNumber: 1 })
            }
          })

          onReorderVisits(orderedVisitIds)
        }
      }
    }
  }

  const allPlaced = placed

  // Extract work order ID from active ID if it's a visit
  const activeWoId = activeId ? (activeId.includes('-visit-') ? activeId.split('-visit-')[0] : activeId) : null
  const activeVisitNumber = activeId && activeId.includes('-visit-') ? parseInt(activeId.split('-visit-')[1]) : undefined
  const activeWo = activeWoId ? workOrders.find(w => w.id === activeWoId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* ── Unplaced column ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          overflow: 'hidden',
          background: '#f5f2ee',
          borderRight: '1px solid #ddd8d0',
        }}
      >
        {/* Column header */}
        <div
          style={{
            padding: '10px 16px 9px',
            borderBottom: '1px solid #ddd8d0',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexShrink: 0,
            background: '#ede9e3',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.1em',
              color: '#5a5650',
            }}
          >
            Unplaced
          </span>
          <span style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#9a9590' }}>
            {unplaced.length}
          </span>
          <span style={{ fontSize: 10, color: '#9a9590', marginLeft: 'auto', fontStyle: 'italic' }}>
            Drag to placed →
          </span>
        </div>

        {/* Scroll area */}
        <DroppableColumn
          id="unplaced-column"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <SortableContext items={unplaced.map(w => w.id)} strategy={verticalListSortingStrategy}>
            {unplaced.length === 0 ? (
              <div
                style={{
                  border: '1.5px dashed #e8e4de',
                  borderRadius: 8,
                  padding: 24,
                  textAlign: 'center',
                  fontSize: 11,
                  color: '#9a9590',
                }}
              >
                All work orders placed
              </div>
            ) : (
              unplaced.map(wo => (
                <SortableWorkOrderCard
                  key={wo.id}
                  wo={wo}
                  isExpanded={expandedIds.has(wo.id)}
                  onToggleExpand={() => onToggleExpand(wo.id)}
                  onPlace={() => onPlace(wo.id)}
                  onUnplace={() => onUnplace(wo.id)}
                  onSendOne={() => onSendOne(wo.id)}
                  onCancel={() => onCancel(wo.id)}
                  onUpdate={u => onUpdate(wo.id, u)}
                  onAddVisit={() => onAddVisit(wo.id)}
                  onSetPredecessor={(p) => onSetPred(wo.id, p)}
                  trades={trades}
                  allPlacedOrders={allPlaced}
                />
              ))
            )}
          </SortableContext>
        </DroppableColumn>
      </div>

      {/* ── Placed column ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          overflow: 'hidden',
          background: '#ffffff',
        }}
      >
        {/* Column header */}
        <div
          style={{
            padding: '10px 16px 9px',
            borderBottom: '1px solid #ddd8d0',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexShrink: 0,
            background: '#ffffff',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.1em',
              color: '#5a5650',
            }}
          >
            Placed
          </span>
          <span style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#9a9590' }}>
            {placed.length}
          </span>
        </div>

        {/* Scroll area */}
        <DroppableColumn
          id="placed-column"
          style={{
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <SortableContext 
            items={placedItems.map(item => 
              item.visitNumber !== undefined ? `${item.wo.id}-visit-${item.visitNumber}` : item.wo.id
            )} 
            strategy={verticalListSortingStrategy}
          >
            {placedItems.length === 0 ? (
              <div
                style={{
                  border: '1.5px dashed #e8e4de',
                  borderRadius: 8,
                  padding: 24,
                  textAlign: 'center',
                  fontSize: 11,
                  color: '#9a9590',
                }}
              >
                Drag work orders here to place them in sequence
              </div>
            ) : (
              placedItems.map((item, index) => (
                <SortableWorkOrderCard
                  key={item.visitNumber !== undefined ? `${item.wo.id}-visit-${item.visitNumber}` : item.wo.id}
                  wo={item.wo}
                  isExpanded={expandedIds.has(item.wo.id)}
                  onToggleExpand={() => onToggleExpand(item.wo.id)}
                  onPlace={() => onPlace(item.wo.id)}
                  onUnplace={() => onUnplace(item.wo.id)}
                  onSendOne={() => onSendOne(item.wo.id)}
                  onCancel={() => onCancel(item.wo.id)}
                  onUpdate={u => onUpdate(item.wo.id, u)}
                  onAddVisit={() => onAddVisit(item.wo.id)}
                  onSetPredecessor={(p) => onSetPred(item.wo.id, p)}
                  trades={trades}
                  allPlacedOrders={allPlaced}
                  visitNumber={item.visitNumber}
                />
              ))
            )}
          </SortableContext>
        </DroppableColumn>
      </div>

      <DragOverlay>
        {activeWo && (
          <div
            style={{
              padding: '12px 16px',
              background: '#fff',
              border: '1px solid #c9a96e',
              borderRadius: 8,
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
              minWidth: 250,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: '#1a1a1a' }}>
              {activeWo.trade?.business_name ?? 'No contractor'}
            </div>
            <div style={{ fontSize: 10, color: '#9a9590', marginTop: 2 }}>
              {activeWo.tradeTypeLabel || activeWo.work_type}
              {activeVisitNumber !== undefined && (
                <span style={{ marginLeft: 6, color: '#c9a96e' }}>
                  (Visit {activeVisitNumber}/{activeWo.total_visits})
                </span>
              )}
            </div>
          </div>
        )}
      </DragOverlay>
    </div>
    </DndContext>
  )
}
