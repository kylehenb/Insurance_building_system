'use client'

import React, { useEffect, useRef, useState } from 'react'
// @ts-ignore - frappe-gantt doesn't have TypeScript types
import Gantt from 'frappe-gantt'
import { type WorkOrderWithDetails, getTradeColor } from './types'

export interface FrappeGanttViewProps {
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

export function FrappeGanttView({
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
}: FrappeGanttViewProps) {
  const ganttRef = useRef<HTMLDivElement>(null)
  const ganttInstance = useRef<Gantt | null>(null)
  const [unplacedCollapsed, setUnplacedCollapsed] = useState(true)

  const placed = workOrders
    .filter(w => w.placementState !== 'unplaced' && w.visits[0]?.scheduled_date)
    .sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999))
  const unplaced = workOrders.filter(w => w.placementState === 'unplaced')

  // Map work orders to Frappe Gantt format
  const ganttTasks = placed.map(wo => {
    const visit = wo.visits[0]
    const startDate = visit?.scheduled_date ? new Date(visit.scheduled_date) : new Date()
    const durationHours = wo.estimated_hours || 4
    const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000)

    return {
      id: wo.id,
      name: wo.tradeTypeLabel || 'Unknown Trade',
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
      progress: (wo as any).progress || 0,
      dependencies: wo.predecessor_work_order_id ? [wo.predecessor_work_order_id] : [],
      custom: {
        workOrderId: wo.id,
        tradeTypeLabel: wo.tradeTypeLabel,
        businessName: wo.trade?.business_name,
        color: getTradeColor(wo.tradeTypeLabel),
        estimatedHours: wo.estimated_hours,
        lagDays: wo.lagDays,
        cushionDays: wo.cushionDays,
        parentWorkOrderId: wo.parent_work_order_id,
      },
    }
  })

  useEffect(() => {
    if (!ganttRef.current || ganttTasks.length === 0) return

    // Clean up existing instance
    if (ganttInstance.current) {
      ganttInstance.current = null
    }

    // Create new Gantt instance
    ganttInstance.current = new Gantt(ganttRef.current, ganttTasks, {
      header_height: 40,
      column_width: 40,
      step: 24,
      view_modes: ['Day', 'Week', 'Month'],
      bar_height: 28,
      bar_corner_radius: 4,
      arrow_curve: 5,
      padding: 18,
      view_mode: 'Day',
      date_format: 'YYYY-MM-DD',
      custom_popup_html: (task: any) => {
        return `
          <div style="padding: 12px; font-family: sans-serif; font-size: 12px;">
            <div style="font-weight: 600; margin-bottom: 8px; color: #1a1a1a;">${task.name}</div>
            <div style="color: #9a9590;">${task.custom?.businessName || '—'}</div>
            <div style="margin-top: 8px;">
              <div style="color: #5a5650;">Start: ${task.start}</div>
              <div style="color: #5a5650;">End: ${task.end}</div>
              <div style="color: #5a5650;">Progress: ${task.progress}%</div>
            </div>
            ${task.custom?.lagDays ? `<div style="margin-top: 8px; color: #c9a96e;">Lag: ${task.custom.lagDays} days</div>` : ''}
            ${task.custom?.cushionDays ? `<div style="color: #c9a96e;">Cushion: ${task.custom.cushionDays} days</div>` : ''}
          </div>
        `
      },
      on_click: (task: any) => {
        // Handle click - could open line items or edit panel
        console.log('Task clicked:', task)
      },
      on_date_change: (task: any, start: Date, end: Date) => {
        // Handle date change from drag-and-drop
        const workOrderId = task.custom?.workOrderId
        if (workOrderId) {
          // Update the visit dates in the database
          onUpdate(workOrderId, {
            visit_start_date: start.toISOString(),
            visit_end_date: end.toISOString(),
          })
        }
      },
      on_progress_change: (task: any, progress: number) => {
        // Handle progress change
        const workOrderId = task.custom?.workOrderId
        if (workOrderId) {
          onUpdate(workOrderId, { progress })
        }
      },
      on_view_change: (mode: string) => {
        console.log('View changed to:', mode)
      },
    })

    // Apply custom styling
    const style = document.createElement('style')
    style.textContent = `
      .gantt-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #fff;
        border-radius: 8px;
      }
      .gantt .grid-header {
        background: #f5f2ee;
        border-bottom: 1px solid #ddd8d0;
        color: #1a1a1a;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .gantt .grid-row {
        border-bottom: 1px solid #e8e4de;
      }
      .gantt .grid-row:nth-child(even) {
        background: #faf9f7;
      }
      .gantt .bar-wrapper {
        fill: none;
      }
      .gantt .bar {
        fill: #1a1a1a;
        rx: 4;
      }
      .gantt .bar-progress {
        fill: rgba(255, 255, 255, 0.3);
        rx: 4;
      }
      .gantt .bar-label {
        fill: #fff;
        font-size: 11px;
        font-weight: 500;
      }
      .gantt .bar-label:hover {
        fill: #fff;
      }
      .gantt .arrow {
        stroke: #1a1a1a;
        stroke-width: 2;
        fill: none;
      }
      .gantt .arrow-path {
        stroke: #1a1a1a;
        stroke-width: 2;
        fill: none;
      }
      .gantt .arrow-head {
        fill: #1a1a1a;
      }
    `
    document.head.appendChild(style)

    return () => {
      if (ganttInstance.current) {
        ganttInstance.current = null
      }
      document.head.removeChild(style)
    }
  }, [ganttTasks, onUpdate])

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
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: getTradeColor(wo.tradeTypeLabel) + '30',
                    border: `1px solid ${getTradeColor(wo.tradeTypeLabel)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
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
            ))
          )}
        </div>
      </div>

      {/* Frappe Gantt Container */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {placed.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              fontSize: 12,
              color: '#9a9590',
            }}
          >
            Place trades to view Gantt chart
          </div>
        ) : (
          <div
            ref={ganttRef}
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '16px',
            }}
          />
        )}
      </div>
    </div>
  )
}
