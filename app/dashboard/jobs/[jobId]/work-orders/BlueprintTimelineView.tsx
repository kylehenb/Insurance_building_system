'use client'

import React, { useEffect, useRef } from 'react'
import { Timeline } from 'vis-timeline/standalone'
import { DataSet } from 'vis-data/peer'
import 'vis-timeline/styles/vis-timeline-graph2d.css'
import { type WorkOrderWithDetails } from './types'

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

    // Convert work orders to vis.js timeline items
    const items = new DataSet(
      workOrders
        .filter(wo => wo.placementState !== 'unplaced')
        .map((wo, index) => {
          const startDate = wo.visits[0]?.scheduled_date
            ? new Date(wo.visits[0].scheduled_date)
            : new Date()
          
          const endDate = wo.estimated_hours
            ? new Date(startDate.getTime() + wo.estimated_hours * 60 * 60 * 1000)
            : new Date(startDate.getTime() + 24 * 60 * 60 * 1000) // Default 1 day

          return {
            id: wo.id,
            content: wo.tradeTypeLabel || 'Unknown',
            start: startDate,
            end: endDate,
            title: `${wo.trade?.business_name || 'No contractor'} - ${wo.tradeTypeLabel}`,
          }
        })
    )

    // Configure timeline
    const options = {
      height: '100%',
      width: '100%',
      margin: {
        item: 10,
      },
    }

    // Create timeline
    timelineInstance.current = new Timeline(timelineRef.current, items, options)

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
          width: 200,
          display: 'flex',
          flexDirection: 'column',
          background: '#f5f2ee',
          borderRight: '1px solid #ddd8d0',
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #ddd8d0',
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            color: '#5a5650',
            background: '#ede9e3',
          }}
        >
          Unplaced ({workOrders.filter(w => w.placementState === 'unplaced').length})
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
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
          overflow: 'hidden',
        }}
      />
    </div>
  )
}
