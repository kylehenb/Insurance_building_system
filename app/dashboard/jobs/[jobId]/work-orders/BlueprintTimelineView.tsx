'use client'

import React, { useEffect, useRef } from 'react'
import { Timeline } from 'vis-timeline/standalone'
import { DataSet } from 'vis-data/peer'
import 'vis-timeline/styles/vis-timeline-graph2d.css'
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
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineInstance = useRef<Timeline | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Load view state from local storage
  useEffect(() => {
    const savedState = localStorage.getItem(`timeline-view-${jobId}`)
    if (savedState && timelineInstance.current) {
      try {
        const state = JSON.parse(savedState)
        if (state.range) {
          timelineInstance.current.setWindow(state.range.start, state.range.end)
        }
      } catch (e) {
        console.error('Error loading timeline view state:', e)
      }
    }
  }, [jobId])

  // Save view state to local storage on range change
  useEffect(() => {
    if (!timelineInstance.current) return

    const handleRangeChange = () => {
      if (!timelineInstance.current) return
      const window = timelineInstance.current.getWindow()
      if (window) {
        localStorage.setItem(`timeline-view-${jobId}`, JSON.stringify({
          range: window,
          timestamp: Date.now(),
        }))
      }
    }

    timelineInstance.current.on('rangechanged', handleRangeChange)

    return () => {
      if (timelineInstance.current) {
        timelineInstance.current.off('rangechanged', handleRangeChange)
      }
    }
  }, [jobId])

  useEffect(() => {
    if (!timelineRef.current) return

    const placed = workOrders.filter(wo => wo.placementState !== 'unplaced')
    console.log('[BlueprintTimelineView] Placed work orders:', placed.length, placed)

    // Create simple groups based on trade types only
    const uniqueTradeTypes = Array.from(
      new Set(placed.map(wo => wo.tradeTypeLabel || 'Unknown'))
    ).sort()

    console.log('[BlueprintTimelineView] Unique trade types:', uniqueTradeTypes)

    const groups = new DataSet(
      uniqueTradeTypes.map((tradeType, index) => {
        const color = getTradeColor(tradeType)
        return {
          id: tradeType,
          content: tradeType,
          order: index,
          style: `
            background-color: ${color}18;
            border-left: 3px solid ${color};
            color: ${color};
            font-weight: 600;
            font-size: 11px;
            padding: 4px 8px;
          `,
        }
      })
    )

    console.log('[BlueprintTimelineView] Groups:', groups)

    // Convert work orders to vis.js timeline items with group assignment
    // Create separate items for each visit
    const items: any[] = []
    placed.forEach((wo, woIndex) => {
      const sent = wo.gary_state && wo.gary_state !== 'not_started'
      const color = getTradeColor(wo.tradeTypeLabel || '')

      // If the work order has multiple visits, create a timeline item for each
      if (wo.visits.length > 0) {
        wo.visits.forEach((visit, visitIndex) => {
          const startDate = visit.scheduled_date
            ? new Date(visit.scheduled_date)
            : new Date(Date.now() + woIndex * 24 * 60 * 60 * 1000 + visitIndex * 12 * 60 * 60 * 1000)
          
          const duration = visit.estimated_hours || wo.estimated_hours || 4
          const endDate = new Date(startDate.getTime() + duration * 60 * 60 * 1000)

          // Build badges
          const badges: string[] = []
          if (wo.visits.length > 1) {
            badges.push(`<span style="background: rgba(0,0,0,0.1); padding: 2px 5px; border-radius: 3px; font-size: 9px;">Visit ${visit.visit_number}/${wo.total_visits}</span>`)
          }
          if (wo.proximity_range === 'extended') {
            badges.push(`<span style="background: rgba(0,0,0,0.1); padding: 2px 5px; border-radius: 3px; font-size: 9px;">extended</span>`)
          }

          const item = {
            id: `${wo.id}-visit-${visit.visit_number}`,
            workOrderId: wo.id, // Store original work order ID
            content: `
              <div style="display: flex; align-items: center; gap: 4px;">
                ${sent ? '🔒' : ''}
                <span>${wo.trade?.business_name?.split(' ')[0] ?? 'No contractor'}</span>
                ${badges}
              </div>
            `,
            group: wo.tradeTypeLabel || 'Unknown',
            start: startDate,
            end: endDate,
            title: `
              <strong>${wo.tradeTypeLabel}</strong> (Visit ${visit.visit_number})<br/>
              Contractor: ${wo.trade?.business_name || 'No contractor'}<br/>
              Est. Hours: ${visit.estimated_hours || wo.estimated_hours || 'N/A'}<br/>
              Status: ${wo.placementState}<br/>
              ${(visit.lag_days_after || 0) > 0 ? `Lag: ${visit.lag_days_after} days<br/>` : ''}
              ${wo.scopeItems.length > 0 ? `Line Items: ${wo.scopeItems.length}` : ''}
            `,
            style: `
              background-color: ${color}${sent ? '30' : '18'};
              border-color: ${color};
              color: ${color};
              border-radius: 5px;
              font-size: 10px;
              font-weight: 500;
              padding: 0 9px;
              ${wo.placementState === 'placed_complete' ? 'opacity: 0.65;' : ''}
            `,
          }

          items.push(item)
        })
      } else {
        // Fallback for work orders without visits (shouldn't happen in normal flow)
        const startDate = new Date(Date.now() + woIndex * 24 * 60 * 60 * 1000)
        const endDate = new Date(startDate.getTime() + (wo.estimated_hours || 4) * 60 * 60 * 1000)

        items.push({
          id: wo.id,
          workOrderId: wo.id,
          content: wo.tradeTypeLabel,
          group: wo.tradeTypeLabel || 'Unknown',
          start: startDate,
          end: endDate,
          style: `
            background-color: ${color}18;
            border: 1px solid ${color};
            color: ${color};
            border-radius: 5px;
            font-size: 10px;
          `,
        })
      }
    })

    const itemsDataSet = new DataSet(items)

    console.log('[BlueprintTimelineView] Items dataset:', itemsDataSet)

    // Collision detection: identify scheduling conflicts
    const itemsArray = items
    const conflicts = new Set<string>()
    
    for (let i = 0; i < itemsArray.length; i++) {
      for (let j = i + 1; j < itemsArray.length; j++) {
        const itemA = itemsArray[i]
        const itemB = itemsArray[j]
        
        // Only check items with content (work orders, not background items)
        if (itemA.content && itemB.content && itemA.group === itemB.group) {
          const startA = new Date(itemA.start).getTime()
          const endA = new Date(itemA.end).getTime()
          const startB = new Date(itemB.start).getTime()
          const endB = new Date(itemB.end).getTime()
          
          // Check for overlap
          if (startA < endB && startB < endA) {
            conflicts.add(itemA.id)
            conflicts.add(itemB.id)
          }
        }
      }
    }

    console.log('[BlueprintTimelineView] Scheduling conflicts:', conflicts.size)

    // Update items with conflict styling
    conflicts.forEach(conflictId => {
      const itemIndex = items.findIndex(item => item.id === conflictId)
      if (itemIndex !== -1 && items[itemIndex].content) {
        items[itemIndex].style = `${items[itemIndex].style} border: 2px solid #ef4444 !important; box-shadow: 0 0 4px rgba(239, 68, 68, 0.4);`
      }
    })

    // Create background items for lag and cushion periods
    const backgroundItems: any[] = []
    placed.forEach((wo, index) => {
      // Use the last visit's end date for lag/cushion calculations
      const lastVisit = wo.visits[wo.visits.length - 1]
      const startDate = lastVisit?.scheduled_date
        ? new Date(lastVisit.scheduled_date)
        : new Date(Date.now() + index * 24 * 60 * 60 * 1000)
      
      const duration = lastVisit?.estimated_hours || wo.estimated_hours || 4
      const endDate = new Date(startDate.getTime() + duration * 60 * 60 * 1000)

      const groupKey = wo.tradeTypeLabel || 'Unknown'

      // Lag period background item
      if (wo.lagDays > 0) {
        const lagStart = new Date(endDate.getTime())
        const lagEnd = new Date(endDate.getTime() + wo.lagDays * 24 * 60 * 60 * 1000)
        backgroundItems.push({
          id: `${wo.id}-lag`,
          content: '',
          group: groupKey,
          start: lagStart,
          end: lagEnd,
          type: 'background',
          style: `
            background: repeating-linear-gradient(
              -45deg, transparent, transparent 3px,
              rgba(146,64,14,.12) 3px, rgba(146,64,14,.12) 6px
            );
            border: 1px dashed #f0c080;
            border-radius: 0 5px 5px 0;
          `,
        })
      }

      // Cushion period background item
      if (wo.cushionDays > 0) {
        const cushionStart = wo.lagDays > 0
          ? new Date(endDate.getTime() + wo.lagDays * 24 * 60 * 60 * 1000)
          : new Date(endDate.getTime())
        const cushionEnd = new Date(cushionStart.getTime() + wo.cushionDays * 24 * 60 * 60 * 1000)
        backgroundItems.push({
          id: `${wo.id}-cushion`,
          content: '',
          group: groupKey,
          start: cushionStart,
          end: cushionEnd,
          type: 'background',
          style: `
            background: rgba(176, 176, 176, 0.12);
            border-radius: 0 3px 3px 0;
          `,
        })
      }
    })

    // Combine regular items with background items
    const allItems = new DataSet([...items, ...backgroundItems])

    // Calculate min/max dates for view range
    const allDates = items.flatMap(item => [new Date(item.start), new Date(item.end)])
    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())))
    // Add some padding
    minDate.setDate(minDate.getDate() - 2)
    maxDate.setDate(maxDate.getDate() + 7)

    // Options with groups and enabled interactions
    const options = {
      height: '400px',
      width: '100%',
      min: minDate,
      max: maxDate,
      groupOrder: 'order',
      stack: false,
      showCurrentTime: false,
      moveable: true,
      zoomable: true,
      editable: {
        updateTime: true,
        updateGroup: false,
        remove: false,
      },
      snap: (date: Date, scale: string, step: number) => {
        // Snap to 1 hour increments
        const snapTo = 60 * 60 * 1000 // 1 hour in milliseconds
        return new Date(Math.round(date.getTime() / snapTo) * snapTo)
      },
      format: {
        minorLabels: {
          millisecond: 'SSS',
          second: 's',
          minute: 'HH:mm',
          hour: 'HH:mm',
          weekday: 'ddd D',
          day: 'D',
          month: 'MMM',
          year: 'YYYY',
        },
        majorLabels: {
          millisecond: 'HH:mm:ss',
          second: 'D MMM HH:mm',
          minute: 'ddd D MMM',
          hour: 'ddd D MMM',
          weekday: 'MMMM YYYY',
          day: 'MMMM YYYY',
          month: 'YYYY',
          year: 'YYYY',
        },
      },
    }

    console.log('[BlueprintTimelineView] Creating timeline with options:', options)

    try {
      // Create timeline with groups and all items (including background)
      timelineInstance.current = new Timeline(
        timelineRef.current!,
        allItems,
        groups,
        options
      )
      console.log('[BlueprintTimelineView] Timeline created successfully')

      // Add click callback
      timelineInstance.current.on('click', (properties) => {
        if (properties.item) {
          console.log('[BlueprintTimelineView] Item clicked:', properties.item)
          // TODO: Open edit modal for the work order
        }
      })

      // Add double-click callback
      timelineInstance.current.on('doubleClick', (properties) => {
        if (properties.item) {
          console.log('[BlueprintTimelineView] Item double-clicked:', properties.item)
          // TODO: Open edit modal for the work order
        }
      })

      // Add range selection callback
      timelineInstance.current.on('select', (properties) => {
        console.log('[BlueprintTimelineView] Selection:', properties)
        // TODO: Handle range selection for bulk operations
      })

      // Handle item move - update lag/cushion background items
      timelineInstance.current.on('onMoving', (properties) => {
        if (properties.item) {
          const itemId = properties.item as string
          const workOrder = placed.find(wo => wo.id === itemId)
          if (!workOrder) return

          const lagItem = allItems.get(`${itemId}-lag`)
          const cushionItem = allItems.get(`${itemId}-cushion`)

          if (lagItem) {
            const duration = workOrder.lagDays * 24 * 60 * 60 * 1000
            const newEnd = new Date(properties.start.getTime() + duration)
            allItems.update({
              id: `${itemId}-lag`,
              start: properties.end,
              end: newEnd,
            })
          }

          if (cushionItem) {
            const lagDuration = workOrder.lagDays * 24 * 60 * 60 * 1000
            const cushionDuration = workOrder.cushionDays * 24 * 60 * 60 * 1000
            const lagEnd = lagItem ? lagItem.end : properties.end
            const newEnd = new Date(lagEnd.getTime() + cushionDuration)
            allItems.update({
              id: `${itemId}-cushion`,
              start: lagEnd,
              end: newEnd,
            })
          }
        }
      })

      // Handle item resize - update lag/cushion background items
      timelineInstance.current.on('onChanging', (properties) => {
        if (properties.item) {
          const itemId = properties.item as string
          const workOrder = placed.find(wo => wo.id === itemId)
          if (!workOrder) return

          const lagItem = allItems.get(`${itemId}-lag`)
          const cushionItem = allItems.get(`${itemId}-cushion`)

          if (lagItem) {
            const duration = workOrder.lagDays * 24 * 60 * 60 * 1000
            const newEnd = new Date(properties.end.getTime() + duration)
            allItems.update({
              id: `${itemId}-lag`,
              start: properties.end,
              end: newEnd,
            })
          }

          if (cushionItem) {
            const lagDuration = workOrder.lagDays * 24 * 60 * 60 * 1000
            const cushionDuration = workOrder.cushionDays * 24 * 60 * 60 * 1000
            const lagEnd = lagItem ? lagItem.end : properties.end
            const newEnd = new Date(lagEnd.getTime() + cushionDuration)
            allItems.update({
              id: `${itemId}-cushion`,
              start: lagEnd,
              end: newEnd,
            })
          }
        }
      })

      // Handle item move/resize completion - sync with database
      timelineInstance.current.on('move', (properties) => {
        if (properties.item) {
          const itemId = properties.item as string
          const workOrder = placed.find(wo => wo.id === itemId)
          if (!workOrder) return

          console.log('[BlueprintTimelineView] Item moved:', itemId, properties.start, properties.end)
          // TODO: Update work order visit dates in database via onUpdate callback
        }
      })

      timelineInstance.current.on('change', (properties) => {
        if (properties.item) {
          const itemId = properties.item as string
          const workOrder = placed.find(wo => wo.id === itemId)
          if (!workOrder) return

          console.log('[BlueprintTimelineView] Item resized:', itemId, properties.start, properties.end)
          // TODO: Update work order estimated hours in database via onUpdate callback
        }
      })

      // Draw dependency arrows
      const drawDependencies = () => {
        if (!svgRef.current || !timelineRef.current) return

        const svg = svgRef.current
        const timelineContainer = timelineRef.current
        const containerRect = timelineContainer.getBoundingClientRect()

        // Clear existing arrows
        svg.innerHTML = ''

        // Draw arrows for items with dependencies
        placed.forEach(wo => {
          if (wo.predecessor_work_order_id) {
            const predId = wo.predecessor_work_order_id
            const predWo = placed.find(p => p.id === predId)
            if (!predWo) return

            // Find DOM elements for the items
            const itemA = document.querySelector(`[data-id="${wo.id}"]`)
            const itemB = document.querySelector(`[data-id="${predId}"]`)

            if (!itemA || !itemB) return

            const rectA = itemA.getBoundingClientRect()
            const rectB = itemB.getBoundingClientRect()

            // Calculate positions relative to the timeline container
            const fromX = rectB.right - containerRect.left
            const fromY = rectB.top + rectB.height / 2 - containerRect.top
            const toX = rectA.left - containerRect.left
            const toY = rectA.top + rectA.height / 2 - containerRect.top

            // Create curved path
            const midX = (fromX + toX) / 2
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('d', `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`)
            path.setAttribute('stroke', '#666')
            path.setAttribute('stroke-width', '1.5')
            path.setAttribute('stroke-dasharray', '4,2')
            path.setAttribute('fill', 'none')
            svg.appendChild(path)

            // Create arrowhead
            const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
            arrowhead.setAttribute('points', `${toX},${toY} ${toX - 6},${toY - 4} ${toX - 6},${toY + 4}`)
            arrowhead.setAttribute('fill', '#666')
            svg.appendChild(arrowhead)
          }
        })
      }

      // Redraw dependencies on timeline events
      timelineInstance.current.on('changed', drawDependencies)
      timelineInstance.current.on('rangechanged', drawDependencies)
      timelineInstance.current.on('scroll', drawDependencies)

      // Initial draw with delay to ensure DOM is ready
      setTimeout(drawDependencies, 200)

      // Fit timeline to show all items
      timelineInstance.current.fit()
      console.log('[BlueprintTimelineView] Timeline fitted to items')
    } catch (error) {
      console.error('[BlueprintTimelineView] Error creating timeline:', error)
    }

    // Cleanup
    return () => {
      if (timelineInstance.current) {
        timelineInstance.current.destroy()
        timelineInstance.current = null
      }
    }
  }, [workOrders])

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Unplaced Sidebar */}
      <div
        style={{
          width: 170,
          minWidth: 170,
          display: 'flex',
          flexDirection: 'column',
          background: '#f5f2ee',
          borderRight: '1px solid #ddd8d0',
        }}
      >
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid #ddd8d0',
            fontSize: 9,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: '#9a9590',
            background: '#ede9e3',
          }}
        >
          Unplaced ({workOrders.filter(w => w.placementState === 'unplaced').length})
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {workOrders.filter(w => w.placementState === 'unplaced').map(wo => (
            <div
              key={wo.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('workOrderId', wo.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: '#fff',
                border: '1px solid #e8e4de',
                fontSize: 11,
                fontWeight: 600,
                color: '#1a1a1a',
                cursor: 'grab',
                userSelect: 'none',
              }}
            >
              {wo.tradeTypeLabel}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const workOrderId = e.dataTransfer.getData('workOrderId')
          if (!workOrderId) return

          const workOrder = workOrders.find(wo => wo.id === workOrderId)
          if (!workOrder || workOrder.placementState !== 'unplaced') return

          // Calculate the drop date from the timeline
          if (timelineInstance.current) {
            const rect = timelineRef.current?.getBoundingClientRect()
            if (rect) {
              const x = e.clientX - rect.left
              const window = timelineInstance.current.getWindow()
              if (window) {
                // Calculate date based on x position within the visible window
                const ratio = x / rect.width
                const timeDiff = window.end.getTime() - window.start.getTime()
                const dropDate = new Date(window.start.getTime() + timeDiff * ratio)
                console.log('[BlueprintTimelineView] Dropped work order at date:', dropDate)
                
                // Call onUpdate to place the work order
                if (onUpdate) {
                  onUpdate(workOrderId, {
                    sequence_order: Date.now(), // Temporary sequence order
                    visits: [{
                      ...workOrder.visits[0],
                      scheduled_date: dropDate.toISOString().split('T')[0],
                    }]
                  })
                }
              }
            }
          }
        }}
        style={{
          flex: 1,
          background: '#fff',
          borderLeft: '1px solid #e8e4de',
          position: 'relative',
          height: '500px',
        }}
      >
        {/* SVG overlay for dependency arrows */}
        <svg
          ref={svgRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      </div>
    </div>
  )
}
