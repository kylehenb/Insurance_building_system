'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuote } from '../hooks/useQuote'
import type { ScopeItem } from '../hooks/useQuote'
import { useScopeLibrary } from '../hooks/useScopeLibrary'
import type { LibraryItem } from '../hooks/useScopeLibrary'
import { QuoteHeader } from './QuoteHeader'
import { RoomSection } from './RoomSection'
import { QuoteFooter } from './QuoteFooter'
import { useTrades } from '../hooks/useTrades'
import type { Trade } from '../hooks/useTrades'
import { CsvImportDialog } from './CsvImportDialog'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface JobInfo {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
}

interface QuoteEditorClientProps {
  jobId: string
  quoteId: string
  tenantId: string
  job: JobInfo
  inline?: boolean
  onQuoteUpdated?: () => void
}

// ── 20k Permit Alert ────────────────────────────────────────────────────────

function PermitAlert({
  contractValueExGst,
  onAddPreliminaries,
  onDismiss,
}: {
  contractValueExGst: number
  onAddPreliminaries: () => void
  onDismiss: () => void
}) {
  return (
    <div
      style={{
        margin: '0 0 0 0',
        background: '#fffbeb',
        border: '1px solid #f59e0b',
        borderLeft: '4px solid #f59e0b',
        borderRadius: 6,
        padding: '14px 18px',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#92400e',
          marginBottom: 8,
        }}
      >
        Building Permit threshold reached — review required
      </div>
      <ul
        style={{
          margin: '0 0 10px 0',
          paddingLeft: 18,
          fontSize: 12,
          color: '#b45309',
          lineHeight: 1.7,
        }}
      >
        <li>Contract value exceeds $20k — statutory levies apply</li>
        <li>Building permit required unless exempt (owner-builder, Class 10, etc.)</li>
        <li>HII required if builder supplies labour + materials over $20k</li>
      </ul>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onAddPreliminaries}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 12,
            fontWeight: 500,
            color: '#ffffff',
            background: '#b45309',
            border: 'none',
            borderRadius: 5,
            padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          Add Preliminaries Items
        </button>
        <button
          onClick={onDismiss}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 12,
            color: '#92400e',
            background: 'transparent',
            border: '1px solid #f59e0b',
            borderRadius: 5,
            padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          Not Required
        </button>
      </div>
    </div>
  )
}

// ── Calculations for permit fees ─────────────────────────────────────────────

function calcPreliminaryAmount(formula: string, contractExGst: number): number {
  switch (formula) {
    case 'hii':
      return Math.max(700, contractExGst * 0.012)
    case 'ctf':
      return contractExGst * 0.002
    case 'bsl':
      return contractExGst <= 45000 ? 61.65 : contractExGst * 0.00137
    case 'council':
      return Math.max(110, contractExGst * 0.0019)
    case 'cdc':
      return Math.max(1050, contractExGst * 0.00165)
    default:
      return 0
  }
}

function calcPermitItems(contractExGst: number): Array<Partial<ScopeItem> & { room: string }> {
  return [
    {
      room: 'Preliminaries',
      trade: 'Preliminaries',
      item_description: `Home Warranty Insurance (HII) — 1.2% of contract value`,
      qty: 1,
      rate_labour: 0,
      rate_materials: calcPreliminaryAmount('hii', contractExGst),
      unit: 'item',
      is_custom: true,
      preliminary_formula: 'hii',
    },
    {
      room: 'Preliminaries',
      trade: 'Preliminaries',
      item_description: `Construction Training Fund Levy (CTF) — 0.2% of contract value`,
      qty: 1,
      rate_labour: 0,
      rate_materials: calcPreliminaryAmount('ctf', contractExGst),
      unit: 'item',
      is_custom: true,
      preliminary_formula: 'ctf',
    },
    {
      room: 'Preliminaries',
      trade: 'Preliminaries',
      item_description: `Building Services Levy (BSL)`,
      qty: 1,
      rate_labour: 0,
      rate_materials: calcPreliminaryAmount('bsl', contractExGst),
      unit: 'item',
      is_custom: true,
      preliminary_formula: 'bsl',
    },
    {
      room: 'Preliminaries',
      trade: 'Preliminaries',
      item_description: `Council Building Permit Fee — 0.19% of contract value`,
      qty: 1,
      rate_labour: 0,
      rate_materials: calcPreliminaryAmount('council', contractExGst),
      unit: 'item',
      is_custom: true,
      preliminary_formula: 'council',
    },
    {
      room: 'Preliminaries',
      trade: 'Preliminaries',
      item_description: `Private Certifier Fees (CDC) — 0.165% of contract value`,
      qty: 1,
      rate_labour: 0,
      rate_materials: calcPreliminaryAmount('cdc', contractExGst),
      unit: 'item',
      is_custom: true,
      preliminary_formula: 'cdc',
    },
  ]
}

// ── Draggable room wrapper ────────────────────────────────────────────────────
// IMPORTANT: must be defined at module scope, not inside QuoteEditorClient.
// Defining a component inside a render function creates a new type reference on
// every render, causing React to unmount+remount the whole subtree and destroying
// all local input state (focus, typed values) after every keystroke.

interface SortableRoomSectionProps {
  room: { name: string; items: ScopeItem[] }
  isLocked: boolean
  onUpdateItem: (itemId: string, changes: Record<string, unknown>) => void
  onDeleteItem: (itemId: string) => Promise<void>
  onAddItem: (room: string) => ScopeItem
  onUpdateDimensions: (
    room: string,
    dims: { room_length?: number | null; room_width?: number | null; room_height?: number | null }
  ) => void
  onRenameRoom: (oldName: string, newName: string) => void
  onDeleteRoom: (roomName: string) => void
  onReorderItems: (room: string, orderedIds: string[]) => void
  search: (q: string) => LibraryItem[]
  trades: Trade[]
  startingIndex: number
  tenantId: string
}

function SortableRoomSection({
  room,
  isLocked,
  onUpdateItem,
  onDeleteItem,
  onAddItem,
  onUpdateDimensions,
  onRenameRoom,
  onDeleteRoom,
  onReorderItems,
  search,
  trades,
  startingIndex,
  tenantId,
}: SortableRoomSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: room.name, disabled: isLocked })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, cursor: isLocked ? 'default' : 'grab' }}
      {...attributes}
      {...(listeners as React.DOMAttributes<HTMLDivElement>)}
    >
      <RoomSection
        name={room.name}
        items={room.items}
        onUpdateItem={onUpdateItem}
        onDeleteItem={onDeleteItem}
        onAddItem={onAddItem}
        onUpdateDimensions={onUpdateDimensions}
        onRenameRoom={onRenameRoom}
        onDeleteRoom={onDeleteRoom}
        onReorderItems={onReorderItems}
        search={search}
        isLocked={isLocked}
        trades={trades}
        startingIndex={startingIndex}
        tenantId={tenantId}
      />
    </div>
  )
}

// ── Main editor ──────────────────────────────────────────────────────────────

export function QuoteEditorClient({ jobId, quoteId, tenantId, job, inline, onQuoteUpdated }: QuoteEditorClientProps) {
  const {
    quote,
    rooms,
    loading,
    error,
    saveStatus,
    subtotal,
    markup,
    gst,
    total,
    items,
    updateItemLocal,
    addItem,
    deleteItem,
    updateRoomDimensions,
    renameRoom,
    updateQuoteMeta,
    reorderItems,
    reorderRooms,
    setAllItemTypes,
  } = useQuote({ quoteId, tenantId })

  const { search } = useScopeLibrary({ tenantId })
  const trades = useTrades(tenantId)

  // Local-only rooms (added locally, no items yet)
  const [pendingRooms, setPendingRooms] = useState<Array<{ id: string; name: string }>>([])

  // Room drag-and-drop state
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [dragRoomOrder, setDragRoomOrder] = useState<string[]>([])

  // CSV import dialog state
  const [showCsvImport, setShowCsvImport] = useState(false)

  // Permit alert: dismissed in session (before persisting to DB)
  const [sessionPermitDismissed, setSessionPermitDismissed] = useState(false)

  // Dialog states for Send and Locked buttons
  const [showSendDialog, setShowSendDialog] = useState(false)
  const [showLockedDialog, setShowLockedDialog] = useState(false)
  const [isCloning, setIsCloning] = useState(false)

  const isLocked = quote?.is_locked ?? false
  const hasPrelimRoom = rooms.some(r => r.name.toLowerCase() === 'preliminaries')

  // Show permit alert when subtotal > 20k, no prelim room, and not dismissed
  const showPermitAlert =
    !isLocked &&
    subtotal > 20000 &&
    !hasPrelimRoom &&
    !sessionPermitDismissed &&
    !(quote?.permit_block_dismissed ?? false)

  const handleAddItem = useCallback(
    (room: string): ScopeItem => {
      const item = addItem(room)
      setPendingRooms(prev => prev.filter(r => r.name !== room))
      return item
    },
    [addItem]
  )

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      await deleteItem(itemId)
    },
    [deleteItem]
  )

  const handleDeleteRoom = useCallback(
    (room: string) => {
      setPendingRooms(prev => prev.filter(r => r.name !== room))
    },
    []
  )

  const handleAddRoom = useCallback(() => {
    const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setPendingRooms(prev => [...prev, { id, name: '' }])
  }, [])

  const handleCsvImport = useCallback((importItems: Partial<ScopeItem>[]) => {
    // Import items by adding them to each room
    for (const itemData of importItems) {
      if (itemData.room) {
        addItem(itemData.room, itemData)
      }
    }
  }, [addItem])

  const handleRenamePendingRoom = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return
    setPendingRooms(prev =>
      prev.map(r => (r.name === oldName ? { ...r, name: newName.trim() } : r))
    )
  }, [])

  // Permit alert handlers
  const handlePermitDismiss = useCallback(async () => {
    setSessionPermitDismissed(true)
    await updateQuoteMeta({ permit_block_dismissed: true })
    onQuoteUpdated?.()
  }, [updateQuoteMeta, onQuoteUpdated])

  const handleAddPreliminaries = useCallback(() => {
    setSessionPermitDismissed(true)
    const permitItems = calcPermitItems(subtotal)
    for (const data of permitItems) {
      const { room: itemRoom, ...rest } = data
      addItem(itemRoom, rest as Partial<ScopeItem>)
    }
  }, [subtotal, addItem])

  // Cash settlement toggle: set all items to cash_settlement or clear
  const cashSettlementActive = items.length > 0 && items.every(i => i.item_type === 'cash_settlement')

  const handleCashSettlementToggle = useCallback(async () => {
    if (cashSettlementActive) {
      if (!window.confirm('Remove cash settlement from all items?')) return
      await setAllItemTypes(null)
    } else {
      await setAllItemTypes('cash_settlement')
    }
  }, [cashSettlementActive, setAllItemTypes])

  // Wrap updateQuoteMeta to call onQuoteUpdated when status changes
  const handleUpdateQuoteMeta = useCallback(
    async (changes: Parameters<typeof updateQuoteMeta>[0]) => {
      await updateQuoteMeta(changes)
      if ('status' in changes) {
        onQuoteUpdated?.()
      }
    },
    [updateQuoteMeta, onQuoteUpdated]
  )

  // Room drag-and-drop handlers
  const roomSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleRoomDragStart = useCallback((event: DragStartEvent) => {
    // Prevent drag if the active element is an input or textarea
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }
    setActiveRoomId(String(event.active.id))
    setDragRoomOrder(rooms.map(r => r.name))
  }, [rooms])

  const handleRoomDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveRoomId(null)
      if (!over || active.id === over.id) return

      const oldIndex = dragRoomOrder.findIndex(r => r === active.id)
      const newIndex = dragRoomOrder.findIndex(r => r === over.id)
      const reordered = arrayMove(dragRoomOrder, oldIndex, newIndex)
      reorderRooms(reordered)
    },
    [dragRoomOrder, reorderRooms]
  )

  // Sync permitDismissed from quote when loaded
  useEffect(() => {
    if (quote?.permit_block_dismissed) {
      setSessionPermitDismissed(true)
    }
  }, [quote?.permit_block_dismissed])

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading quote…
      </div>
    )
  }

  if (error || !quote) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          gap: 12,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <p style={{ fontSize: 13, color: '#c5221f' }}>{error ?? 'Quote not found'}</p>
        <Link
          href={`/dashboard/jobs/${jobId}?tab=quotes`}
          style={{ fontSize: 12, color: '#9e998f' }}
        >
          ← Back to quotes
        </Link>
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#f5f2ee',
        minHeight: '100%',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >

      {/* Quote header — only shown on dedicated page, not in accordion inline view
          (the accordion summary row already shows ref/total/status/insurer/delete/chevron) */}
      {!inline && (
        <>
          <div
            style={{
              background: '#ffffff',
              borderBottom: '1px solid #e0dbd4',
              padding: '8px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Link
              href={`/dashboard/jobs/${jobId}?tab=quotes`}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 12,
                color: '#9e998f',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              ← {job.job_number}
            </Link>
            <span style={{ color: '#e0dbd4', fontSize: 12 }}>/</span>
            <span style={{ fontSize: 12, color: '#3a3530' }}>
              {quote.quote_ref ?? 'Quote'}
            </span>
          </div>

          <QuoteHeader
            quote={quote}
            total={total}
            cashSettlementActive={cashSettlementActive}
            onCashSettlementToggle={handleCashSettlementToggle}
            isLocked={isLocked}
            quoteId={quoteId}
            tenantId={tenantId}
            onMarkReady={() => handleUpdateQuoteMeta({ status: 'ready', is_locked: true })}
            onUnlockEdit={() => handleUpdateQuoteMeta({ status: 'draft', is_locked: false })}
            onSend={() => setShowSendDialog(true)}
            onShowLocked={() => setShowLockedDialog(true)}
          />
        </>
      )}

      {/* Content */}
      <div style={{ background: '#f5f2ee' }}>
        {/* Rooms with items */}
        <DndContext
          sensors={roomSensors}
          collisionDetection={closestCenter}
          onDragStart={handleRoomDragStart}
          onDragEnd={handleRoomDragEnd}
        >
          <SortableContext
            items={rooms.map(r => r.name)}
            strategy={verticalListSortingStrategy}
          >
            {(() => {
              let counter = 0
              return rooms.map(room => {
                const startIndex = counter + 1
                counter += room.items.length
                return (
                  <SortableRoomSection
                    key={room.name}
                    room={room}
                    isLocked={isLocked}
                    onUpdateItem={updateItemLocal}
                    onDeleteItem={handleDeleteItem}
                    onAddItem={handleAddItem}
                    onUpdateDimensions={updateRoomDimensions}
                    onRenameRoom={renameRoom}
                    onDeleteRoom={(roomName) => {
                      if (!window.confirm(`Delete room "${roomName}" and all items?`)) return
                      room.items.forEach(i => deleteItem(i.id))
                    }}
                    onReorderItems={reorderItems}
                    search={search}
                    trades={trades}
                    startingIndex={startIndex}
                    tenantId={tenantId}
                  />
                )
              })
            })()}
          </SortableContext>
        </DndContext>

        {/* Pending rooms (added locally, no items yet) */}
        {(() => {
          const totalItemsInRooms = rooms.reduce((sum, room) => sum + room.items.length, 0)
          return pendingRooms.map(pr => (
            <RoomSection
              key={pr.id}
              name={pr.name}
              items={[]}
              onUpdateItem={updateItemLocal}
              onDeleteItem={handleDeleteItem}
              onAddItem={handleAddItem}
              onUpdateDimensions={updateRoomDimensions}
              onRenameRoom={handleRenamePendingRoom}
              onDeleteRoom={() => {
                setPendingRooms(prev => prev.filter(r => r.id !== pr.id))
              }}
              onReorderItems={reorderItems}
              search={search}
              isLocked={isLocked}
              trades={trades}
              autoFocusName={true}
              startingIndex={totalItemsInRooms + 1}
              tenantId={tenantId}
            />
          ))
        })()}

        {/* Add room */}
        {!isLocked && (
          <div style={{ padding: '14px 16px', display: 'flex', gap: 8 }}>
            <button
              onClick={handleAddRoom}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                color: '#9e998f',
                background: '#ffffff',
                border: '1px solid #e0dbd4',
                borderRadius: 6,
                padding: '8px 18px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#c8b89a'
                e.currentTarget.style.color = '#3a3530'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#e0dbd4'
                e.currentTarget.style.color = '#9e998f'
              }}
            >
              + Add New Room
            </button>
            <button
              onClick={() => setShowCsvImport(true)}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                color: '#9e998f',
                background: '#ffffff',
                border: '1px solid #e0dbd4',
                borderRadius: 6,
                padding: '8px 18px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#c8b89a'
                e.currentTarget.style.color = '#3a3530'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#e0dbd4'
                e.currentTarget.style.color = '#9e998f'
              }}
            >
              Import CSV
            </button>
          </div>
        )}

        {/* 20k Building Permit Alert */}
        {showPermitAlert && (
          <div style={{ padding: '0 16px 14px' }}>
            <PermitAlert
              contractValueExGst={subtotal}
              onAddPreliminaries={handleAddPreliminaries}
              onDismiss={handlePermitDismiss}
            />
          </div>
        )}
      </div>

      {/* Footer totals */}
      <QuoteFooter
        quote={quote}
        subtotal={subtotal}
        markup={markup}
        gst={gst}
        total={total}
        items={items}
        onUpdateMarkup={pct => handleUpdateQuoteMeta({ markup_pct: pct })}
        onUpdateNotes={notes => handleUpdateQuoteMeta({ notes })}
        isLocked={isLocked}
        saveStatus={saveStatus}
        tenantId={tenantId}
        cashSettlementActive={cashSettlementActive}
        onCashSettlementToggle={handleCashSettlementToggle}
        quoteId={quoteId}
        jobId={jobId}
        onQuoteUpdated={onQuoteUpdated}
        showSendDialog={showSendDialog}
        onShowSendDialog={setShowSendDialog}
        showLockedDialog={showLockedDialog}
        onShowLockedDialog={setShowLockedDialog}
        isCloning={isCloning}
        onSetIsCloning={setIsCloning}
      />

      {/* CSV Import Dialog */}
      <CsvImportDialog
        isOpen={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        onImport={handleCsvImport}
        quoteId={quoteId}
        tenantId={tenantId}
      />
    </div>
  )
}
