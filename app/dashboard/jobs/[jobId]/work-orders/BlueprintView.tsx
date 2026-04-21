'use client'

import React, { useRef, useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { type WorkOrderWithDetails, type WorkOrderRow, type TradeRow, woIsSent } from './types'
import { WorkOrderCard } from './WorkOrderCard'
import type { BlueprintDraftData } from '@/lib/types/scheduling'
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
  onSetPredecessor: (predId: string | null, isConcurrent: boolean) => void
  trades: TradeRow[]
  allPlacedOrders: WorkOrderWithDetails[]
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: wo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

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
  workOrders:    WorkOrderWithDetails[]
  trades:        TradeRow[]
  expandedIds:   Set<string>
  onToggleExpand: (id: string) => void
  onPlace:       (id: string) => void
  onUnplace:     (id: string) => void
  onSendOne:     (id: string) => void
  onCancel:      (id: string) => void
  onUpdate:      (id: string, u: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string }) => void
  onAddVisit:    (id: string) => void
  onSetPred:     (id: string, predId: string | null, isConcurrent: boolean) => void
  onReorder:     (orderedIds: string[]) => void
  jobId:         string
  tenantId:      string
  onDraftGenerated?: () => void
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
  jobId,
  tenantId,
  onDraftGenerated,
}: BlueprintViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [blueprintDraft, setBlueprintDraft] = useState<BlueprintDraftData | null>(null)
  const [blueprintId, setBlueprintId] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

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

  const supabase = useRef(createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )).current

  // Fetch blueprint draft on mount and when jobId changes
  useEffect(() => {
    async function fetchBlueprint() {
      const { data } = await supabase
        .from('job_schedule_blueprints')
        .select('id, draft_data, status')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        setBlueprintId(data.id)
        setBlueprintDraft(data.draft_data as BlueprintDraftData)
      } else {
        setBlueprintId(null)
        setBlueprintDraft(null)
      }
    }

    fetchBlueprint()
  }, [jobId, tenantId, supabase])

  const placed   = workOrders.filter(w => w.placementState !== 'unplaced')
    .sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999))
  const unplaced = workOrders.filter(w => w.placementState === 'unplaced')

  async function handleGenerateDraft() {
    console.log('[BlueprintView] handleGenerateDraft called', { jobId, tenantId, isGenerating })
    if (isGenerating) return
    setIsGenerating(true)

    try {
      console.log('[BlueprintView] Fetching /api/ai/draft-blueprint with', { jobId, tenantId })
      const response = await fetch('/api/ai/draft-blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, tenantId }),
      })

      console.log('[BlueprintView] Response status:', response.status)
      const result = await response.json()
      console.log('[BlueprintView] Response result:', result)

      if (!response.ok) {
        const errorMsg = result.error || 'Unknown error'
        const errorDetails = result.details ? `\n\nDetails: ${result.details}` : ''
        alert(`Failed to generate draft: ${errorMsg}${errorDetails}`)
        console.error('Blueprint generation error:', result)
        return
      }

      // Manually refetch the blueprint draft to update UI
      const { data } = await supabase
        .from('job_schedule_blueprints')
        .select('id, draft_data, status')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        setBlueprintId(data.id)
        setBlueprintDraft(data.draft_data as BlueprintDraftData)
      }

      alert('Blueprint draft generated successfully! Review the draft and confirm to create work orders.')
      onDraftGenerated?.()
    } catch (error) {
      console.error('Error generating draft:', error)
      alert('Failed to generate draft. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleConfirmBlueprint() {
    if (!blueprintId || isConfirming) return
    setIsConfirming(true)

    try {
      const response = await fetch(`/api/jobs/${jobId}/blueprint/${blueprintId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })

      const result = await response.json()

      if (!response.ok) {
        alert(`Failed to confirm blueprint: ${result.error || 'Unknown error'}`)
        return
      }

      alert(`Blueprint confirmed! Created ${result.workOrdersCreated?.length || 0} work orders.`)
      onDraftGenerated?.()
    } catch (error) {
      console.error('Error confirming blueprint:', error)
      alert('Failed to confirm blueprint. Please try again.')
    } finally {
      setIsConfirming(false)
    }
  }

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

    const activeWo = workOrders.find(w => w.id === activeId)
    if (!activeWo) return

    const overWo = workOrders.find(w => w.id === overId)

    // Check if dropping on unplaced column
    if (overId === 'unplaced-column') {
      if (woIsSent(activeWo)) {
        alert('Cannot unplace a sent work order. Use Cancel if needed.')
        return
      }
      onUnplace(activeId)
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
        onPlace(activeId)
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
          onPlace(activeId)
        } else {
          // Moving to unplaced
          if (woIsSent(activeWo)) {
            alert('Cannot unplace a sent work order. Use Cancel if needed.')
            return
          }
          onUnplace(activeId)
        }
        return
      }

      // Reordering within same column
      if (activeIsPlaced && overIsPlaced) {
        const newOrder = [...placed.map(p => p.id)]
        const oldIndex = newOrder.indexOf(activeId)
        const newIndex = newOrder.indexOf(overId)

        if (oldIndex !== -1 && newIndex !== -1) {
          newOrder.splice(oldIndex, 1)
          newOrder.splice(newIndex, 0, activeId)
          onReorder(newOrder)
        }
      }
    }
  }

  const allPlaced = placed

  const activeWo = activeId ? workOrders.find(w => w.id === activeId) : null

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
                  onSetPredecessor={(p, c) => onSetPred(wo.id, p, c)}
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {blueprintDraft && blueprintId && (
              <button
                onClick={handleConfirmBlueprint}
                disabled={isConfirming}
                style={{
                  padding: '4px 12px',
                  fontSize: 10,
                  fontWeight: 500,
                  fontFamily: 'DM Sans, sans-serif',
                  background: isConfirming ? '#9a9590' : '#c9a96e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: isConfirming ? 'not-allowed' : 'pointer',
                  letterSpacing: '.01em',
                  transition: 'all .15s',
                }}
              >
                {isConfirming ? 'Confirming...' : 'Confirm Blueprint'}
              </button>
            )}
            <button
              onClick={handleGenerateDraft}
              disabled={isGenerating}
              style={{
                padding: '4px 12px',
                fontSize: 10,
                fontWeight: 500,
                fontFamily: 'DM Sans, sans-serif',
                background: isGenerating ? '#9a9590' : '#1a1a1a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                letterSpacing: '.01em',
                transition: 'all .15s',
              }}
            >
              {isGenerating ? 'Generating...' : 'Generate AI Draft'}
            </button>
          </div>
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
          <SortableContext items={placed.map(w => w.id)} strategy={verticalListSortingStrategy}>
            {placed.length === 0 ? (
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
              placed.map(wo => (
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
                  onSetPredecessor={(p, c) => onSetPred(wo.id, p, c)}
                  trades={trades}
                  allPlacedOrders={allPlaced}
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
            </div>
          </div>
        )}
      </DragOverlay>
    </div>
    </DndContext>
  )
}
