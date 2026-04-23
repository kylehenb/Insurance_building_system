'use client'

import React, { useCallback, useState } from 'react'
import { type WorkOrderRow, woIsSent } from './types'
import { useWorkOrders } from './useWorkOrders'
import { BlueprintView } from './BlueprintView'
import JobSchedule from '@/components/schedule/JobSchedule'
import { GanttView, type GanttScale } from './GanttView'
import { BottomPanel } from './BottomPanel'
import { SendAllModal } from './SendAllModal'
import { AddWorkOrderModal } from './AddWorkOrderModal'
import { CARD_CSS } from './WorkOrderCard'

type View = 'blueprint' | GanttScale

interface AddModalState {
  open:    boolean
  context: { type: 'quote'; quoteId: string } | { type: 'additional' }
}

export interface WorkOrdersTabProps {
  jobId:    string
  tenantId: string
}

export function WorkOrdersTab({ jobId, tenantId }: WorkOrdersTabProps) {
  const { workOrders, quotes, trades, isLoading, error, mutations, refetch } = useWorkOrders(jobId, tenantId)

  const [view,         setView]         = useState<View>('blueprint')
  const [expandedIds,  setExpandedIds]  = useState<Set<string>>(new Set())
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [addModal, setAddModal] = useState<AddModalState>({
    open: false,
    context: { type: 'additional' },
  })

  // ── Card expand toggle ──────────────────────────────────────────────────────
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Place / unplace ─────────────────────────────────────────────────────────
  const handlePlace = useCallback(
    (id: string) => {
      const wo  = workOrders.find(w => w.id === id)
      if (!wo) return
      const placed = workOrders.filter(w => w.placementState !== 'unplaced')
      const maxSeq = Math.max(0, ...placed.map(p => p.sequence_order ?? 0))
      mutations.placeWorkOrder(id, maxSeq + 1)
    },
    [workOrders, mutations]
  )

  const handleUnplace = useCallback(
    (id: string) => {
      const wo = workOrders.find(w => w.id === id)
      if (!wo) return
      if (woIsSent(wo)) {
        alert('Cannot unplace a sent work order. Use Cancel if needed.')
        return
      }
      mutations.unplaceWorkOrder(id)
    },
    [workOrders, mutations]
  )

  const handleCancel = useCallback(
    (id: string) => {
      if (!confirm('Cancel this work order? Gary SMS will stop immediately.')) return
      mutations.cancelWorkOrder(id)
    },
    [mutations]
  )

  const handleUpdate = useCallback(
    (
      id: string,
      u: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string }
    ) => {
      mutations.updateWorkOrder(id, u)
    },
    [mutations]
  )

  const handleSetParent = useCallback(
    (id: string, parentId: string | null, offsetDays: number) => {
      mutations.setParentWorkOrder(id, parentId, offsetDays)
    },
    [mutations]
  )

  // ── Reorder ──────────────────────────────────────────────────────────────────
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      mutations.reorderWorkOrders(orderedIds)
    },
    [mutations]
  )

  const handleReorderVisits = useCallback(
    (orderedVisitIds: Array<{ workOrderId: string; visitNumber: number }>) => {
      mutations.reorderVisits(orderedVisitIds)
    },
    [mutations]
  )

  // ── Send bar ─────────────────────────────────────────────────────────────────
  const unsentPlaced = workOrders.filter(
    w => w.placementState !== 'unplaced' && !woIsSent(w) && w.placementState !== 'placed_complete'
  )
  const sendBarInfo =
    unsentPlaced.length > 0
      ? `${unsentPlaced.length} placed order${unsentPlaced.length > 1 ? 's' : ''} ready to send`
      : 'All placed orders have been sent'

  // ── Add modals ───────────────────────────────────────────────────────────────
  function openAddQuote(quoteId: string) {
    setAddModal({ open: true, context: { type: 'quote', quoteId } })
  }
  function openAddAdditional() {
    setAddModal({ open: true, context: { type: 'additional' } })
  }

  async function handleAddConfirm(quoteId: string | null, workType: string) {
    await mutations.addWorkOrder(quoteId, workType)
    setAddModal(prev => ({ ...prev, open: false }))
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9a9590',
        }}
      >
        Loading work orders…
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#991b1b',
        }}
      >
        Error: {error}
      </div>
    )
  }

  return (
    <>
      {/* Inject shared card CSS */}
      <style>{CARD_CSS}</style>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#1a1a1a',
          background: '#f5f2ee',
          overflow: 'hidden',
        }}
      >
        {/* ── View toggle bar ─────────────────────────────────────────────── */}
        <div
          style={{
            background: '#fff',
            borderBottom: '1px solid #ddd8d0',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              background: '#f5f2ee',
              border: '1px solid #ddd8d0',
              borderRadius: 8,
              padding: 3,
              gap: 2,
            }}
          >
            {(['blueprint', 'day', 'week', 'month'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '5px 16px',
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: 'DM Sans, sans-serif',
                  background: view === v ? '#1a1a1a' : 'transparent',
                  color: view === v ? '#fff' : '#9a9590',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  letterSpacing: '.02em',
                  boxShadow: view === v ? '0 1px 4px rgba(0,0,0,.18)' : undefined,
                  transition: 'all .18s',
                }}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Main panel ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {view === 'blueprint' ? (
            <JobSchedule
              jobId={jobId}
              tenantId={tenantId}
              workOrders={workOrders}
              trades={trades}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
              onPlace={handlePlace}
              onUnplace={handleUnplace}
              onSendOne={(id: string) => mutations.sendWorkOrder(id)}
              onCancel={handleCancel}
              onUpdate={handleUpdate}
              onAddVisit={(id: string) => mutations.addVisit(id)}
              onDeleteVisit={(workOrderId: string, visitId: string) => mutations.deleteVisit(workOrderId, visitId)}
              onSetPred={(id: string, predId: string | null) => mutations.setPredecessor(id, predId)}
              onReorder={handleReorder}
              onReorderVisits={handleReorderVisits}
              onSetParent={handleSetParent}
              onDraftGenerated={() => refetch()}
            />
          ) : (
            <GanttView workOrders={workOrders} scale={view} />
          )}
        </div>

        {/* ── Send bar (blueprint only) ────────────────────────────────────── */}
        {view === 'blueprint' && (
          <div
            style={{
              borderTop: '1px solid #ddd8d0',
              background: '#fff',
              padding: '10px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 11, color: '#9a9590' }}>{sendBarInfo}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setSendModalOpen(true)}
              style={{
                padding: '6px 18px',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'DM Sans, sans-serif',
                background: '#1a1a1a',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                letterSpacing: '.01em',
                transition: 'all .15s',
              }}
              onMouseEnter={e => {
                const t = e.currentTarget
                t.style.background = '#2a2a2a'
                t.style.boxShadow  = '0 2px 8px rgba(0,0,0,.15)'
              }}
              onMouseLeave={e => {
                const t = e.currentTarget
                t.style.background = '#1a1a1a'
                t.style.boxShadow  = ''
              }}
            >
              Send all placed →
            </button>
          </div>
        )}

        {/* ── Bottom panel ────────────────────────────────────────────────── */}
        <BottomPanel
          workOrders={workOrders}
          quotes={quotes}
          trades={trades}
          onAddToQuote={openAddQuote}
          onAddAdditional={openAddAdditional}
          onUpdateWorkOrder={(id, updates) => mutations.updateWorkOrder(id, updates)}
        />
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {sendModalOpen && (
        <SendAllModal
          workOrders={workOrders}
          onConfirm={async () => {
            await mutations.sendAllUnsent()
            setSendModalOpen(false)
          }}
          onCancel={() => setSendModalOpen(false)}
        />
      )}

      {addModal.open && (
        <AddWorkOrderModal
          context={addModal.context}
          quotes={quotes}
          onConfirm={handleAddConfirm}
          onCancel={() => setAddModal(prev => ({ ...prev, open: false }))}
        />
      )}
    </>
  )
}
