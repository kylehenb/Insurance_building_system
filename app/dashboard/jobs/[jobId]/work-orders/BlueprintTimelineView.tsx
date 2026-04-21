'use client'

import React, { useLayoutEffect, useRef, useState } from 'react'
import { type WorkOrderWithDetails, getTradeColor } from './types'

export interface BlueprintTimelineViewProps {
  workOrders: WorkOrderWithDetails[]
  trades: any[]
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  onPlace: (id: string) => void
  onUnplace: (id: string) => void
  onSendOne: (id: string) => void
  onCancel: (id: string) => void
  onUpdate: (id: string, u: any) => void
  onAddVisit: (id: string) => void
  onSetPred: (id: string, predId: string | null, isConcurrent: boolean) => void
  onReorder: (orderedIds: string[]) => void
  onSetParent: (id: string, parentId: string | null, offsetDays: number) => void
  jobId: string
  tenantId: string
  onDraftGenerated?: () => void
}

export function BlueprintTimelineView({
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
  onSetParent,
  jobId,
  tenantId,
  onDraftGenerated,
}: BlueprintTimelineViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverLane, setDragOverLane] = useState<number | null>(null)
  const [unplacedCollapsed, setUnplacedCollapsed] = useState(true)
  
  const placed = workOrders
    .filter(w => w.placementState !== 'unplaced')
    .sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999))
  const unplaced = workOrders.filter(w => w.placementState === 'unplaced')

  const bodyRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Calculate bar position based on sequence order (not dates)
  function estimateBarPos(wo: WorkOrderWithDetails, totalPlaced: number): { left: number; width: number } {
    const seq = (wo.sequence_order ?? totalPlaced) - 1
    const slotW = 0.9 / Math.max(totalPlaced, 1)
    const left = seq * slotW + 0.05
    const width = Math.max(0.04, slotW * 0.6)
    return { left: Math.min(left, 0.9), width }
  }

  // SVG dependency connectors
  useLayoutEffect(() => {
    const body = bodyRef.current
    const svg = svgRef.current
    if (!body || !svg) return

    const bRect = body.getBoundingClientRect()
    svg.setAttribute('width', String(bRect.width))
    svg.setAttribute('height', String(bRect.height))

    const defs = `<defs>
      <marker id="arr-solid" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <polygon points="0,0 7,3.5 0,7" fill="#b0a89e"/>
      </marker>
      <marker id="arr-parent" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <polygon points="0,0 7,3.5 0,7" fill="#c9a96e"/>
      </marker>
    </defs>`

    let paths = ''
    placed.forEach(wo => {
      // Predecessor dependency arrows
      if (!wo.predecessor_work_order_id) return
      const predWo = placed.find(p => p.id === wo.predecessor_work_order_id)
      if (!predWo) return

      const predBar = document.getElementById(`bt-bar-${predWo.id}`)
      const thisBar = document.getElementById(`bt-bar-${wo.id}`)
      if (!predBar || !thisBar) return

      const pR = predBar.getBoundingClientRect()
      const tR = thisBar.getBoundingClientRect()

      const x1 = pR.right - bRect.left
      const y1 = pR.top + pR.height / 2 - bRect.top
      const x2 = tR.left - bRect.left - 6
      const y2 = tR.top + tR.height / 2 - bRect.top
      const mx = Math.min(x1 + 28, x2 - 4)

      const isDash = wo.is_concurrent
      const stroke = isDash ? '#d4cdc4' : '#b0a89e'
      const dash = isDash ? 'stroke-dasharray="5,3"' : ''
      const marker = isDash ? 'arr-solid' : 'arr-solid'

      paths += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"
        fill="none" stroke="${stroke}" stroke-width="1.5" ${dash}
        marker-end="url(#${marker})"/>`
    })

    svg.innerHTML = defs + paths
  }, [placed])

  // Drag handlers
  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverLane(null)
  }

  function handleDragOverLane(e: React.DragEvent, laneIndex: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverLane(laneIndex)
  }

  function handleDropOnLane(e: React.DragEvent, laneIndex: number) {
    e.preventDefault()
    if (!draggingId) return

    const wo = workOrders.find(w => w.id === draggingId)
    if (!wo) { handleDragEnd(); return }

    if (wo.placementState === 'unplaced') {
      // Moving from unplaced to placed
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

      const maxSeq = Math.max(0, ...placed.map(p => p.sequence_order ?? 0))
      onPlace(draggingId)
      
      // Then reorder to the correct position
      const newOrder = [...placed.map(p => p.id)]
      newOrder.splice(laneIndex, 0, draggingId)
      setTimeout(() => onReorder(newOrder), 100)
    } else {
      // Reordering within placed
      const withoutDragging = placed.filter(p => p.id !== draggingId)
      withoutDragging.splice(laneIndex, 0, wo)
      onReorder(withoutDragging.map(p => p.id))
    }

    handleDragEnd()
  }

  function handleDropUnplaced(e: React.DragEvent) {
    e.preventDefault()
    if (!draggingId) return
    onUnplace(draggingId)
    handleDragEnd()
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Compact Unplaced Sidebar */}
      <div
        style={{
          width: unplacedCollapsed ? 48 : 200,
          minWidth: unplacedCollapsed ? 48 : 200,
          display: 'flex',
          flexDirection: 'column',
          background: '#f5f2ee',
          borderRight: '1px solid #ddd8d0',
          transition: 'width 0.2s',
        }}
      >
        <div
          style={{
            padding: '10px 8px',
            borderBottom: '1px solid #ddd8d0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ede9e3',
          }}
        >
          {!unplacedCollapsed && (
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.1em', color: '#5a5650' }}>
              Unplaced ({unplaced.length})
            </span>
          )}
          <button
            onClick={() => setUnplacedCollapsed(!unplacedCollapsed)}
            style={{
              padding: 4,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9a9590',
              fontSize: 12,
            }}
          >
            {unplacedCollapsed ? '▶' : '◀'}
          </button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
          onDrop={handleDropUnplaced}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: unplacedCollapsed ? '8px 4px' : '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {unplacedCollapsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              {unplaced.map(wo => (
                <div
                  key={wo.id}
                  draggable
                  onDragStart={e => handleDragStart(e, wo.id)}
                  onDragEnd={handleDragEnd}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: getTradeColor(wo.tradeTypeLabel) + '30',
                    border: `1px solid ${getTradeColor(wo.tradeTypeLabel)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'grab',
                    fontSize: 10,
                    fontWeight: 600,
                    color: getTradeColor(wo.tradeTypeLabel),
                  }}
                  title={wo.tradeTypeLabel}
                >
                  {wo.tradeTypeLabel?.charAt(0) || '?'}
                </div>
              ))}
            </div>
          ) : (
            unplaced.map(wo => (
              <div
                key={wo.id}
                draggable
                onDragStart={e => handleDragStart(e, wo.id)}
                onDragEnd={handleDragEnd}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: '#fff',
                  border: '1px solid #e8e4de',
                  cursor: 'grab',
                  fontSize: 11,
                  color: '#1a1a1a',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{wo.tradeTypeLabel}</div>
                <div style={{ fontSize: 10, color: '#9a9590' }}>
                  {wo.trade?.business_name?.split(' ')[0] ?? '—'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Timeline Swim Lanes */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #ddd8d0',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.1em', color: '#5a5650' }}>
            Blueprint Timeline
          </span>
          <span style={{ fontSize: 10, color: '#9a9590' }}>
            {placed.length} placed
          </span>
        </div>

        {/* Timeline Body */}
        <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {placed.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                fontSize: 12,
                color: '#9a9590',
              }}
            >
              Drag trades from the sidebar to place them in sequence
            </div>
          ) : (
            placed.map((wo, idx) => {
              const color = getTradeColor(wo.tradeTypeLabel)
              const hasDate = wo.visits[0]?.scheduled_date
              const pos = estimateBarPos(wo, placed.length)

              return (
                <div
                  key={wo.id}
                  onDragOver={e => handleDragOverLane(e, idx)}
                  onDrop={e => handleDropOnLane(e, idx)}
                  style={{
                    display: 'flex',
                    borderBottom: '1px solid #e8e4de',
                    minHeight: 56,
                    position: 'relative',
                    background: dragOverLane === idx ? '#f5f2ee' : '#fff',
                  }}
                >
                  {/* Label */}
                  <div
                    style={{
                      width: 180,
                      minWidth: 180,
                      padding: '10px 12px',
                      borderRight: '1px solid #e8e4de',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 2,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.09em', color: '#9a9590' }}>
                      {wo.tradeTypeLabel}
                    </div>
                    <div style={{ fontSize: 12, color: '#1a1a1a' }}>
                      {wo.trade?.business_name?.split(' ')[0] ?? '—'}
                    </div>
                    {wo.parent_work_order_id && (
                      <div style={{ fontSize: 9, color: '#c9a96e' }}>
                        ← Key trade dependent
                      </div>
                    )}
                  </div>

                  {/* Timeline Track */}
                  <div style={{ flex: 1, position: 'relative', padding: '10px 12px' }}>
                    {/* Grid lines */}
                    {[0, 0.2, 0.4, 0.6, 0.8].map((p, i) => (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${p * 100}%`,
                          width: 1,
                          background: '#e8e4de',
                          pointerEvents: 'none',
                        }}
                      />
                    ))}

                    {/* Bar */}
                    <div
                      id={`bt-bar-${wo.id}`}
                      draggable
                      onDragStart={e => handleDragStart(e, wo.id)}
                      onDragEnd={handleDragEnd}
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: `${pos.left * 100}%`,
                        width: `${pos.width * 100}%`,
                        height: 32,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 10px',
                        fontSize: 10,
                        fontWeight: 500,
                        cursor: 'grab',
                        background: hasDate ? color : `${color}15`,
                        border: hasDate ? `1px solid ${color}` : `1px dashed ${color}`,
                        color: hasDate ? '#fff' : color,
                      }}
                    >
                      {wo.tradeTypeLabel}
                      {hasDate && (
                        <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.9 }}>
                          {new Date(wo.visits[0].scheduled_date!).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {!hasDate && (
                        <span style={{ marginLeft: 6, fontSize: 9, fontStyle: 'italic' }}>
                          Unscheduled
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}

          {/* SVG connectors */}
          <svg
            ref={svgRef}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 3,
              overflow: 'visible',
            }}
          />
        </div>
      </div>
    </div>
  )
}
