'use client'

import React, { useRef, useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { type WorkOrderWithDetails, type WorkOrderRow, type TradeRow, woIsSent } from './types'
import { WorkOrderCard } from './WorkOrderCard'
import type { BlueprintDraftData } from '@/lib/types/scheduling'

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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<'unplaced' | 'placed' | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragOverIndexRef = useRef<number | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [blueprintDraft, setBlueprintDraft] = useState<BlueprintDraftData | null>(null)
  const [blueprintId, setBlueprintId] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

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

  // ── Drag handlers ───────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent<HTMLDivElement>, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Fade card
    setTimeout(() => {
      const el = document.getElementById(`wo-card-${id}`)
      if (el) el.style.opacity = '0.35'
    }, 0)
  }

  function handleDragEnd() {
    if (draggingId) {
      const el = document.getElementById(`wo-card-${draggingId}`)
      if (el) el.style.opacity = ''
    }
    setDraggingId(null)
    setDragOverCol(null)
    setDragOverIndex(null)
    dragOverIndexRef.current = null
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, col: 'unplaced' | 'placed') {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(col)
  }

  function handleDragOverCard(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault()
    e.stopPropagation()
    dragOverIndexRef.current = idx
    setDragOverIndex(idx)
  }

  function handleDragLeave(col: 'unplaced' | 'placed') {
    setDragOverCol(prev => (prev === col ? null : prev))
  }

  function handleDropUnplaced(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!draggingId) return
    const wo = workOrders.find(w => w.id === draggingId)
    if (!wo) { handleDragEnd(); return }

    if (woIsSent(wo)) {
      alert('Cannot unplace a sent work order. Use Cancel if needed.')
      handleDragEnd()
      return
    }

    onUnplace(draggingId)
    handleDragEnd()
  }

  function handleDropPlaced(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!draggingId) return
    const wo = workOrders.find(w => w.id === draggingId)
    if (!wo) { handleDragEnd(); return }

    const insertIdx = dragOverIndexRef.current

    if (wo.placementState === 'unplaced') {
      // Moving from unplaced → placed: validate gate
      if (!wo.trade_id) {
        alert('Cannot place: Select a contractor first')
        handleDragEnd()
        return
      }
      if (!(wo.estimated_hours && wo.estimated_hours > 0)) {
        alert('Cannot place: Set estimated hours first')
        handleDragEnd()
        return
      }

      // Insert at position or end
      if (insertIdx !== null) {
        const newOrder = [...placed.map(p => p.id)]
        newOrder.splice(insertIdx, 0, draggingId)
        onReorder(newOrder)
      } else {
        const maxSeq = Math.max(0, ...placed.map(p => p.sequence_order ?? 0))
        onPlace(draggingId)
        // onPlace will use the next seq, but reorder call will normalise it
        void maxSeq
      }
    } else {
      // Reordering within placed
      if (insertIdx !== null) {
        const withoutDragging = placed.filter(p => p.id !== draggingId)
        withoutDragging.splice(insertIdx, 0, wo)
        onReorder(withoutDragging.map(p => p.id))
      }
    }

    handleDragEnd()
  }

  const allPlaced = placed

  return (
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
        <div
          onDragOver={e => handleDragOver(e, 'unplaced')}
          onDrop={handleDropUnplaced}
          onDragLeave={() => handleDragLeave('unplaced')}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            outline: dragOverCol === 'unplaced' ? '2px dashed #ddd8d0' : undefined,
            outlineOffset: dragOverCol === 'unplaced' ? -4 : undefined,
            borderRadius: dragOverCol === 'unplaced' ? 4 : undefined,
          }}
        >
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
              <div id={`wo-card-${wo.id}`} key={wo.id}>
                <WorkOrderCard
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
                  onDragStart={e => handleDragStart(e, wo.id)}
                  onDragEnd={handleDragEnd}
                />
              </div>
            ))
          )}
        </div>
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
        <div
          onDragOver={e => handleDragOver(e, 'placed')}
          onDrop={handleDropPlaced}
          onDragLeave={() => handleDragLeave('placed')}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            outline: dragOverCol === 'placed' ? '2px dashed #ddd8d0' : undefined,
            outlineOffset: dragOverCol === 'placed' ? -4 : undefined,
            borderRadius: dragOverCol === 'placed' ? 4 : undefined,
          }}
        >
          {placed.length === 0 ? (
            <div
              style={{
                border: '1.5px dashed #e8e4de',
                borderRadius: 8,
                padding: 24,
                textAlign: 'center',
                fontSize: 11,
                color: '#9a9590',
                background: dragOverCol === 'placed' ? '#e8d5b0' : undefined,
                borderColor: dragOverCol === 'placed' ? '#c9a96e' : undefined,
              }}
            >
              Drag work orders here to place them in sequence
            </div>
          ) : (
            placed.map((wo, idx) => (
              <div
                key={wo.id}
                id={`wo-card-${wo.id}`}
                onDragOver={e => handleDragOverCard(e, idx)}
                style={{
                  borderTop:
                    dragOverIndex === idx && draggingId !== wo.id
                      ? '2px solid #c9a96e'
                      : '2px solid transparent',
                }}
              >
                <WorkOrderCard
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
                  onDragStart={e => handleDragStart(e, wo.id)}
                  onDragEnd={handleDragEnd}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
