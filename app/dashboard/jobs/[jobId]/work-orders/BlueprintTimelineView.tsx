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

  useEffect(() => {
    if (!timelineRef.current) return

    const placed = workOrders.filter(wo => wo.placementState !== 'unplaced')
    console.log('[BlueprintTimelineView] Placed work orders:', placed.length, placed)

    // Create groups based on trade types
    const uniqueTradeTypes = Array.from(
      new Set(placed.map(wo => wo.tradeTypeLabel || 'Unknown'))
    ).sort()

    console.log('[BlueprintTimelineView] Unique trade types:', uniqueTradeTypes)

    const groups = new DataSet(
      uniqueTradeTypes.map((tradeType, index) => ({
        id: tradeType,
        content: tradeType,
        order: index,
      }))
    )

    console.log('[BlueprintTimelineView] Groups:', groups)

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

        const item = {
          id: wo.id,
          content: `${sent ? '🔒 ' : ''}${wo.trade?.business_name?.split(' ')[0] ?? 'No contractor'}`,
          group: wo.tradeTypeLabel || 'Unknown',
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

    // Options with groups and enabled interactions
    const options = {
      height: '400px',
      width: '100%',
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
    }

    console.log('[BlueprintTimelineView] Creating timeline with options:', options)

    try {
      // Create timeline with groups
      timelineInstance.current = new Timeline(
        timelineRef.current,
        items,
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
