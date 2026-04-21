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
  const [dragDependencyMode, setDragDependencyMode] = useState<string | null>(null) // ID of bar being dragged for dependency creation
  const [barPositions, setBarPositions] = useState<Map<string, { horizontal: number; swimLane: number }>>(new Map()) // Free positioning: horizontal (0-1) and swim lane index
  
  const placed = workOrders
    .filter(w => w.placementState !== 'unplaced')
  const unplaced = workOrders.filter(w => w.placementState === 'unplaced')

  // Initialize bar positions for work orders that don't have them yet
  React.useEffect(() => {
    if (placed.length > 0 && barPositions.size === 0) {
      const newPositions = new Map<string, { horizontal: number; swimLane: number }>()
      placed.forEach((wo, idx) => {
        // Use sequence_order as initial horizontal position if available
        const seq = wo.sequence_order ?? idx + 1
        const horizontal = (seq - 1) / Math.max(placed.length, 1)
        newPositions.set(wo.id, { horizontal, swimLane: 0 })
      })
      setBarPositions(newPositions)
    }
  }, [placed, barPositions.size])

  // Auto-assign swim lanes based on horizontal positions
  const swimLanes = autoAssignSwimLanes(placed)

  const bodyRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Calculate display sequence number based on horizontal position
  // Leftmost bars get lower numbers, bars in same swim lane get same number if overlapping
  function calculateDisplaySequence(wo: WorkOrderWithDetails, allPlaced: WorkOrderWithDetails[]): number {
    const thisPos = barPositions.get(wo.id)?.horizontal ?? 0
    const thisSwimLane = swimLanes.get(wo.id) ?? 0
    
    // Sort all bars by horizontal position
    const sorted = [...allPlaced].sort((a, b) => {
      const posA = barPositions.get(a.id)?.horizontal ?? 0
      const posB = barPositions.get(b.id)?.horizontal ?? 0
      return posA - posB
    })
    
    // Find this bar's index in sorted order
    const index = sorted.findIndex(b => b.id === wo.id)
    return index + 1 // 1-based sequence
  }

  // Auto-assign swim lanes to prevent overlaps
  function autoAssignSwimLanes(workOrders: WorkOrderWithDetails[]): Map<string, number> {
    const barWidth = 0.08
    const lanes = new Map<string, number>()
    const laneEnds: number[] = [] // Track where each lane ends (horizontal position)

    // Sort by horizontal position
    const sorted = [...workOrders].sort((a, b) => {
      const posA = barPositions.get(a.id)?.horizontal ?? 0
      const posB = barPositions.get(b.id)?.horizontal ?? 0
      return posA - posB
    })

    sorted.forEach(wo => {
      const horizontal = barPositions.get(wo.id)?.horizontal ?? 0
      const left = horizontal
      const right = horizontal + barWidth

      // Find first available lane
      let assignedLane = 0
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= left) {
          assignedLane = i
          break
        }
        if (i === laneEnds.length - 1) {
          assignedLane = laneEnds.length
        }
      }

      lanes.set(wo.id, assignedLane)
      laneEnds[assignedLane] = right
    })

    return lanes
  }

  // Calculate bar position based on horizontal position and swim lane
  // Horizontal position is 0-1 (left to right), swim lane determines vertical stacking
  function estimateBarPos(wo: WorkOrderWithDetails, totalPlaced: number, swimLane: number = 0, horizontal: number = 0): { left: number; width: number; top: number } {
    const barWidth = 0.08 // Fixed equal width for all bars
    const left = Math.max(0, Math.min(1 - barWidth, horizontal))
    const top = 6 + (swimLane * 36) // Each swim lane is 36px tall
    return { left, width: barWidth, top }
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
      <marker id="arr-solid" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
        <path d="M0,0 L10,5 L0,10 L2,5 Z" fill="#1a1a1a"/>
      </marker>
      <marker id="arr-concurrent" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
        <path d="M0,0 L10,5 L0,10 L2,5 Z" fill="#9ca3af"/>
      </marker>
      <marker id="arr-parent" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
        <path d="M0,0 L10,5 L0,10 L2,5 Z" fill="#c9a96e"/>
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

      // Route lines below the bars to avoid crossing
      const x1 = pR.right - bRect.left
      const y1 = pR.bottom - bRect.top
      const x2 = tR.left - bRect.left - 8
      const y2 = tR.bottom - bRect.top
      const mx = (x1 + x2) / 2
      const belowBars = Math.max(y1, y2) + 12

      const isDash = wo.is_concurrent
      const stroke = isDash ? '#9ca3af' : '#1a1a1a'
      const dash = isDash ? 'stroke-dasharray="4,4"' : ''
      const marker = isDash ? 'arr-concurrent' : 'arr-solid'

      // Orthogonal routing below bars
      const cornerRadius = 6
      paths += `<path d="M${x1},${y1} L${x1},${belowBars - cornerRadius} Q${x1},${belowBars} ${x1 + cornerRadius},${belowBars} L${x2 - cornerRadius},${belowBars} Q${x2},${belowBars} ${x2},${belowBars - cornerRadius} L${x2},${y2}"
        fill="none" stroke="${stroke}" stroke-width="2" ${dash}
        marker-end="url(#${marker})"
        class="dep-path" data-from="${predWo.id}" data-to="${wo.id}"
        style="cursor: pointer; pointer-events: stroke;"/>`
    })

    svg.innerHTML = defs + paths

    // Add click handlers to paths for deletion
    svg.querySelectorAll('.dep-path').forEach(path => {
      path.addEventListener('click', (e) => {
        e.stopPropagation()
        const toId = path.getAttribute('data-to')
        if (toId) {
          handleClearDependency(toId)
        }
      })
      path.addEventListener('mouseenter', () => {
        path.setAttribute('stroke-width', '3')
        path.setAttribute('cursor', 'pointer')
      })
      path.addEventListener('mouseleave', () => {
        path.setAttribute('stroke-width', '2')
        path.setAttribute('cursor', 'pointer')
      })
    })

    // Add click handler to SVG to catch clicks on paths
    svg.onclick = (e) => {
      const target = e.target as SVGElement
      if (target.classList.contains('dep-path')) {
        e.stopPropagation()
        const toId = target.getAttribute('data-to')
        if (toId) {
          handleClearDependency(toId)
        }
      }
    }
  }, [placed])

  // Drag handlers
  function handleDragStart(e: React.DragEvent, id: string) {
    if (e.altKey || e.metaKey) {
      // Alt/Option key pressed - entering dependency drag mode
      setDragDependencyMode(id)
      e.dataTransfer.effectAllowed = 'link'
      e.dataTransfer.setData('text/plain', 'dependency')
    } else {
      setDraggingId(id)
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverLane(null)
    setDragDependencyMode(null)
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
    if (dragDependencyMode) {
      e.dataTransfer.dropEffect = 'link'
    } else {
      e.dataTransfer.dropEffect = 'move'
    }
    setDragOverLane(laneIndex)
  }

  function handleDropOnLane(e: React.DragEvent, laneIndex: number) {
    e.preventDefault()

    if (dragDependencyMode) {
      // Creating dependency via drag
      const targetWo = placed[laneIndex]
      if (targetWo && targetWo.id !== dragDependencyMode) {
        onSetPred(dragDependencyMode, targetWo.id, false)
      }
      handleDragEnd()
      return
    }

    if (!draggingId) return

    const wo = workOrders.find(w => w.id === draggingId)
    if (!wo) { handleDragEnd(); return }

    // Calculate horizontal position based on drop location
    const body = bodyRef.current
    if (!body) { handleDragEnd(); return }
    const bodyRect = body.getBoundingClientRect()
    const dropX = e.clientX - bodyRect.left
    const horizontalPos = Math.max(0, Math.min(1 - 0.08, dropX / bodyRect.width))

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

      onPlace(draggingId)
      setBarPositions(prev => new Map(prev).set(draggingId, { horizontal: horizontalPos, swimLane: 0 }))
    } else {
      // Reordering within placed - just update horizontal position
      setBarPositions(prev => new Map(prev).set(draggingId, { horizontal: horizontalPos, swimLane: 0 }))
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
              const barPos = barPositions.get(wo.id) ?? { horizontal: 0, swimLane: 0 }
              const swimLane = swimLanes.get(wo.id) ?? 0
              const pos = estimateBarPos(wo, placed.length, swimLane, barPos.horizontal)

              return (
                <div
                  key={wo.id}
                  onDragOver={e => handleDragOverLane(e, idx)}
                  onDrop={e => handleDropOnLane(e, idx)}
                  style={{
                    display: 'flex',
                    borderBottom: '1px solid #e8e4de',
                    minHeight: expandedTradeIds.has(wo.id) ? 200 : 44,
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
                        {calculateDisplaySequence(wo, placed)}
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
                            step="0.01"
                            value={wo.estimated_hours !== null && wo.estimated_hours !== undefined ? parseFloat(wo.estimated_hours.toFixed(2)) : ''}
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
                  <div style={{ flex: 1, position: 'relative', padding: '6px 0' }}>
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

                      {/* Dependency drag handle */}
                      <div
                        draggable
                        onDragStart={e => {
                          e.stopPropagation()
                          setDragDependencyMode(wo.id)
                          e.dataTransfer.effectAllowed = 'link'
                          e.dataTransfer.setData('text/plain', 'dependency')
                        }}
                        onDragEnd={() => {
                          setDragDependencyMode(null)
                        }}
                        style={{
                          position: 'absolute',
                          right: -8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          background: '#1a1a1a',
                          cursor: 'crosshair',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Drag to create dependency"
                      >
                        <span style={{ fontSize: 8, color: '#fff', fontWeight: 700 }}>→</span>
                      </div>
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
