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
  const [expandedTradeIds, setExpandedTradeIds] = useState<Set<string>>(new Set())
  const [lineItemsOpenId, setLineItemsOpenId] = useState<string | null>(null)
  const [dependencyMode, setDependencyMode] = useState<string | null>(null) // ID of bar waiting for predecessor selection
  const [parentMode, setParentMode] = useState<string | null>(null) // ID of bar waiting for parent selection
  
  const placed = workOrders
    .filter(w => w.placementState !== 'unplaced')
    .sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999))
  const unplaced = workOrders.filter(w => w.placementState === 'unplaced')

  // Group trades by sequence order to handle concurrent trades
  const sequenceGroups = new Map<number, WorkOrderWithDetails[]>()
  placed.forEach(wo => {
    const seq = wo.sequence_order ?? 999
    if (!sequenceGroups.has(seq)) sequenceGroups.set(seq, [])
    sequenceGroups.get(seq)!.push(wo)
  })

  // Calculate concurrent offset for each work order
  const concurrentOffsets = new Map<string, number>()
  sequenceGroups.forEach((group, seq) => {
    group.forEach((wo, idx) => {
      concurrentOffsets.set(wo.id, idx)
    })
  })

  const bodyRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Calculate bar position based on sequence order (not dates)
  // Support concurrent trades by grouping by sequence order
  function estimateBarPos(wo: WorkOrderWithDetails, totalPlaced: number, concurrentOffset: number = 0): { left: number; width: number; top: number } {
    const seq = (wo.sequence_order ?? totalPlaced) - 1
    const slotW = 0.92 / Math.max(totalPlaced, 1)
    const left = seq * slotW + 0.04
    const width = Math.max(0.03, slotW * 0.7)
    const top = 6 + (concurrentOffset * 16) // Stack concurrent trades vertically
    return { left: Math.min(left, 0.92), width, top }
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

  function toggleTradeExpand(id: string) {
    setExpandedTradeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleLineItems(id: string) {
    setLineItemsOpenId(prev => prev === id ? null : id)
  }

  function startDependencyMode(id: string) {
    setDependencyMode(id)
    setLineItemsOpenId(null) // Close line items when entering dependency mode
  }

  function handleSetPredecessor(predecessorId: string) {
    if (!dependencyMode) return
    onSetPred(dependencyMode, predecessorId, false)
    setDependencyMode(null)
  }

  function handleClearDependency(id: string) {
    onSetPred(id, null, false)
  }

  function handleSetConcurrent(id: string, isConcurrent: boolean) {
    onSetPred(id, (id as any).predecessor_work_order_id, isConcurrent)
  }

  function startParentMode(id: string) {
    setParentMode(id)
    setLineItemsOpenId(null)
    setDependencyMode(null)
  }

  function handleSetParent(parentId: string) {
    if (!parentMode) return
    onSetParent(parentMode, parentId, 0)
    setParentMode(null)
  }

  function handleClearParent(id: string) {
    onSetParent(id, null, 0)
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
              const concurrentOffset = concurrentOffsets.get(wo.id) ?? 0
              const seqGroup = sequenceGroups.get(wo.sequence_order ?? 999) ?? [wo]
              const groupSize = seqGroup.length
              const pos = estimateBarPos(wo, placed.length, concurrentOffset)

              return (
                <div
                  key={wo.id}
                  onDragOver={e => handleDragOverLane(e, idx)}
                  onDrop={e => handleDropOnLane(e, idx)}
                  style={{
                    display: 'flex',
                    borderBottom: '1px solid #e8e4de',
                    minHeight: expandedTradeIds.has(wo.id) ? 200 : (44 + (groupSize > 1 ? (groupSize - 1) * 16 : 0)),
                    position: 'relative',
                    background: dragOverLane === idx ? '#f5f2ee' : '#fff',
                  }}
                >
                  {/* Label */}
                  <div
                    onClick={() => toggleTradeExpand(wo.id)}
                    style={{
                      width: 200,
                      minWidth: 200,
                      padding: '6px 10px',
                      borderRight: '1px solid #e8e4de',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-start',
                      gap: 1,
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#5a5650', minWidth: 20 }}>
                        {wo.sequence_order ?? '—'}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.09em', color: '#9a9590' }}>
                        {wo.tradeTypeLabel}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9a9590' }}>
                        {expandedTradeIds.has(wo.id) ? '▼' : '▶'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#1a1a1a' }}>
                      {wo.trade?.business_name?.split(' ')[0] ?? '—'}
                    </div>
                    {wo.parent_work_order_id && (
                      <div style={{ fontSize: 9, color: '#c9a96e' }}>
                        ← Key trade dependent
                      </div>
                    )}

                    {/* Expanded Edit Panel */}
                    {expandedTradeIds.has(wo.id) && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          background: '#f5f2ee',
                          borderRadius: 4,
                          fontSize: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <label style={{ color: '#5a5650', minWidth: 70 }}>Lag:</label>
                          <input
                            type="number"
                            value={wo.lagDays}
                            onChange={e => onUpdate(wo.id, { lagDays: parseInt(e.target.value) || 0 })}
                            style={{ width: 50, padding: 2, fontSize: 10, border: '1px solid #ddd8d0', borderRadius: 3 }}
                          />
                          <span style={{ color: '#9a9590' }}>days</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <label style={{ color: '#5a5650', minWidth: 70 }}>Cushion:</label>
                          <input
                            type="number"
                            value={wo.cushionDays}
                            onChange={e => onUpdate(wo.id, { cushionDays: parseInt(e.target.value) || 0 })}
                            style={{ width: 50, padding: 2, fontSize: 10, border: '1px solid #ddd8d0', borderRadius: 3 }}
                          />
                          <span style={{ color: '#9a9590' }}>days</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <label style={{ color: '#5a5650', minWidth: 70 }}>Est. Hours:</label>
                          <input
                            type="number"
                            value={wo.estimated_hours ?? ''}
                            onChange={e => onUpdate(wo.id, { estimated_hours: parseFloat(e.target.value) || null })}
                            style={{ width: 50, padding: 2, fontSize: 10, border: '1px solid #ddd8d0', borderRadius: 3 }}
                          />
                        </div>
                        <div style={{ fontSize: 9, color: '#9a9590', marginTop: 4 }}>
                          {wo.scopeItems.length} line items
                        </div>
                        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #e8e4de' }}>
                          <div style={{ fontWeight: 600, marginBottom: 4, color: '#5a5650' }}>Dependencies</div>
                          {wo.predecessor_work_order_id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 9, color: '#9a9590' }}>
                                After: {placed.find(p => p.id === wo.predecessor_work_order_id)?.tradeTypeLabel || 'Unknown'}
                              </span>
                              <button
                                onClick={() => handleClearDependency(wo.id)}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: 8,
                                  background: '#fff',
                                  border: '1px solid #ddd8d0',
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                }}
                              >
                                Clear
                              </button>
                              <button
                                onClick={() => handleSetConcurrent(wo.id, !wo.is_concurrent)}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: 8,
                                  background: wo.is_concurrent ? '#1a1a1a' : '#fff',
                                  color: wo.is_concurrent ? '#fff' : '#1a1a1a',
                                  border: '1px solid #ddd8d0',
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                }}
                              >
                                {wo.is_concurrent ? 'Concurrent ✓' : 'Make Concurrent'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startDependencyMode(wo.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: 9,
                                background: dependencyMode === wo.id ? '#1a1a1a' : '#fff',
                                color: dependencyMode === wo.id ? '#fff' : '#1a1a1a',
                                border: '1px solid #ddd8d0',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                            >
                              {dependencyMode === wo.id ? 'Click a predecessor...' : '+ Add Dependency'}
                            </button>
                          )}
                        </div>
                        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #e8e4de' }}>
                          <div style={{ fontWeight: 600, marginBottom: 4, color: '#5a5650' }}>Key Trade (Parent)</div>
                          {wo.parent_work_order_id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 9, color: '#c9a96e' }}>
                                Follows: {wo.parentWorkOrder?.tradeTypeLabel || 'Unknown'}
                              </span>
                              <button
                                onClick={() => handleClearParent(wo.id)}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: 8,
                                  background: '#fff',
                                  border: '1px solid #ddd8d0',
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                }}
                              >
                                Clear
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startParentMode(wo.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: 9,
                                background: parentMode === wo.id ? '#c9a96e' : '#fff',
                                color: parentMode === wo.id ? '#fff' : '#1a1a1a',
                                border: '1px solid #ddd8d0',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                            >
                              {parentMode === wo.id ? 'Click key trade...' : '+ Set Key Trade'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Timeline Track */}
                  <div style={{ flex: 1, position: 'relative', padding: '6px 8px' }}>
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
                      onClick={() => {
                        if (dependencyMode) {
                          if (dependencyMode !== wo.id) {
                            handleSetPredecessor(wo.id)
                          }
                        } else if (parentMode) {
                          if (parentMode !== wo.id) {
                            handleSetParent(wo.id)
                          }
                        } else {
                          toggleLineItems(wo.id)
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: pos.top,
                        left: `${pos.left * 100}%`,
                        width: `${pos.width * 100}%`,
                        height: 28,
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 6px',
                        fontSize: 9,
                        fontWeight: 500,
                        cursor: (dependencyMode || parentMode) ? 'pointer' : 'pointer',
                        background: hasDate ? color : `${color}15`,
                        border: 
                          parentMode && parentMode !== wo.id ? `2px solid #c9a96e` :
                          dependencyMode && dependencyMode !== wo.id ? `2px solid #1a1a1a` :
                          (hasDate ? `1px solid ${color}` : `1px dashed ${color}`),
                        color: hasDate ? '#fff' : color,
                        opacity: 
                          (dependencyMode && dependencyMode === wo.id) ||
                          (parentMode && parentMode === wo.id) ? 0.5 : 1,
                      }}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {wo.tradeTypeLabel}
                      </span>
                      {(wo.lagDays > 0 || wo.cushionDays > 1) && (
                        <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.8 }}>
                          {wo.lagDays > 0 && `+${wo.lagDays}`}
                          {wo.lagDays > 0 && wo.cushionDays > 1 && '/'}
                          {wo.cushionDays > 1 && `c${wo.cushionDays}`}
                        </span>
                      )}
                      {hasDate && (
                        <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.9 }}>
                          {new Date(wo.visits[0].scheduled_date!).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {!hasDate && (
                        <span style={{ marginLeft: 4, fontSize: 8, fontStyle: 'italic' }}>
                          Unscheduled
                        </span>
                      )}
                    </div>

                    {/* Line Items Dropdown */}
                    {lineItemsOpenId === wo.id && (
                      <div
                        style={{
                          position: 'absolute',
                          top: pos.top + 34,
                          left: `${pos.left * 100}%`,
                          width: Math.max(150, pos.width * 100 * 10),
                          background: '#fff',
                          border: '1px solid #ddd8d0',
                          borderRadius: 4,
                          padding: 8,
                          fontSize: 9,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          zIndex: 10,
                          maxHeight: 200,
                          overflowY: 'auto',
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4, color: '#5a5650' }}>Line Items</div>
                        {wo.scopeItems.length === 0 ? (
                          <div style={{ color: '#9a9590', fontStyle: 'italic' }}>No line items</div>
                        ) : (
                          wo.scopeItems.map((si, i) => (
                            <div key={i} style={{ padding: '2px 0', borderBottom: i < wo.scopeItems.length - 1 ? '1px solid #f5f2ee' : 'none' }}>
                              <div style={{ fontWeight: 500 }}>{si.item_description || si.item_type || '—'}</div>
                              <div style={{ color: '#9a9590' }}>${si.line_total}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
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
