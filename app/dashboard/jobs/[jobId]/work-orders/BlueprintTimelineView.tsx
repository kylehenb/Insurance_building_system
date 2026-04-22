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

    // Create nested groups: trade type → contractor hierarchy
    const tradeToContractors = new Map<string, Set<string>>()
    placed.forEach(wo => {
      const tradeType = wo.tradeTypeLabel || 'Unknown'
      const contractor = wo.trade?.business_name?.split(' ')[0] || 'Unassigned'
      if (!tradeToContractors.has(tradeType)) {
        tradeToContractors.set(tradeType, new Set())
      }
      tradeToContractors.get(tradeType)!.add(contractor)
    })

    // Build nested group structure with color coding
    const groups: any[] = []
    let groupOrder = 0

    tradeToContractors.forEach((contractors, tradeType) => {
      const color = getTradeColor(tradeType)
      
      // Parent group for trade type
      groups.push({
        id: `trade-${tradeType}`,
        content: tradeType,
        order: groupOrder++,
        className: 'trade-group-header',
        style: `
          background-color: ${color}18;
          border-left: 3px solid ${color};
          color: ${color};
          font-weight: 600;
          font-size: 11px;
          padding: 4px 8px;
        `,
      })

      // Child groups for each contractor
      contractors.forEach(contractor => {
        groups.push({
          id: `${tradeType}-${contractor}`,
          content: contractor,
          parent: `trade-${tradeType}`,
          order: groupOrder++,
          className: 'contractor-group-header',
          style: `
            background-color: #fafafa;
            border-left: 2px solid ${color}40;
            color: #666;
            font-size: 10px;
            padding: 3px 12px;
          `,
        })
      })
    })

    console.log('[BlueprintTimelineView] Nested groups:', groups)

    const groupsDataSet = new DataSet(groups)

    // Convert work orders to vis.js timeline items with group assignment
    const items = new DataSet(
      placed.map((wo, index) => {
        // If no scheduled date, spread them out by day for visibility
        const startDate = wo.visits[0]?.scheduled_date
          ? new Date(wo.visits[0].scheduled_date)
          : new Date(Date.now() + index * 24 * 60 * 60 * 1000) // Spread by day
        
        const endDate = wo.estimated_hours
          ? new Date(startDate.getTime() + wo.estimated_hours * 60 * 60 * 1000)
          : new Date(startDate.getTime() + 24 * 60 * 60 * 1000) // Default 1 day

        const color = getTradeColor(wo.tradeTypeLabel)
        const sent = wo.placementState === 'placed_sent' || wo.placementState === 'placed_complete'

        // Build custom item content with badges
        let badges = ''
        if ((wo.total_visits ?? 1) > 1) {
          badges += `<span style="margin-left: 4px; padding: 1px 4px; border-radius: 3px; background: #eff4ff; border: 1px solid #bfdbfe; color: #1e40af; font-size: 8px;">V${wo.current_visit}/${wo.total_visits}</span>`
        }
        if (wo.proximity_range === 'extended') {
          badges += `<span style="margin-left: 4px; padding: 1px 4px; border-radius: 3px; background: #fff0f0; border: 1px solid #fca5a5; color: #991b1b; font-size: 8px;">Ext</span>`
        }

        const item = {
          id: wo.id,
          content: `
            <div style="display: flex; align-items: center; gap: 4px;">
              ${sent ? '🔒' : ''}
              <span>${wo.trade?.business_name?.split(' ')[0] ?? 'No contractor'}</span>
              ${badges}
            </div>
          `,
          group: `${wo.tradeTypeLabel || 'Unknown'}-${wo.trade?.business_name?.split(' ')[0] || 'Unassigned'}`,
          start: startDate,
          end: endDate,
          title: `
            <strong>${wo.tradeTypeLabel}</strong><br/>
            Contractor: ${wo.trade?.business_name || 'No contractor'}<br/>
            Est. Hours: ${wo.estimated_hours || 'N/A'}<br/>
            Status: ${wo.placementState}<br/>
            ${wo.lagDays > 0 ? `Lag: ${wo.lagDays} days<br/>` : ''}
            ${wo.cushionDays > 0 ? `Cushion: ${wo.cushionDays} days<br/>` : ''}
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

        console.log('[BlueprintTimelineView] Item:', item)
        return item
      })
    )

    console.log('[BlueprintTimelineView] Items dataset:', items)

    // Collision detection: identify scheduling conflicts
    const itemsArray = (items.get() as any[])
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
      const item = items.get(conflictId)
      if (item && item.content) {
        items.update({
          id: conflictId,
          style: `${item.style} border: 2px solid #ef4444 !important; box-shadow: 0 0 4px rgba(239, 68, 68, 0.4);`,
        })
      }
    })

    // Create background items for lag and cushion periods
    const backgroundItems: any[] = []
    placed.forEach((wo, index) => {
      const startDate = wo.visits[0]?.scheduled_date
        ? new Date(wo.visits[0].scheduled_date)
        : new Date(Date.now() + index * 24 * 60 * 60 * 1000)
      
      const endDate = wo.estimated_hours
        ? new Date(startDate.getTime() + wo.estimated_hours * 60 * 60 * 1000)
        : new Date(startDate.getTime() + 24 * 60 * 60 * 1000)

      const groupKey = `${wo.tradeTypeLabel || 'Unknown'}-${wo.trade?.business_name?.split(' ')[0] || 'Unassigned'}`

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
    const allItems = new DataSet([...(items.get() as any[]), ...backgroundItems])

    // Calculate custom time range
    const now = new Date()
    const minDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
    const maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) // 60 days from now

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
        // Snap to day increments
        const snapTo = 24 * 60 * 60 * 1000 // 1 day in milliseconds
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
      // Create timeline with nested groups and all items (including background)
      timelineInstance.current = new Timeline(
        timelineRef.current,
        allItems,
        groupsDataSet,
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
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: '#fff',
                border: '1px solid #e8e4de',
                fontSize: 11,
                color: '#1a1a1a',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{wo.tradeTypeLabel}</div>
              <div style={{ fontSize: 10, color: '#9a9590' }}>
                {wo.trade?.business_name?.split(' ')[0] ?? '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        style={{
          flex: 1,
          background: '#fff',
          borderLeft: '1px solid #e8e4de',
          position: 'relative',
          height: '500px',
        }}
      />
    </div>
  )
}
