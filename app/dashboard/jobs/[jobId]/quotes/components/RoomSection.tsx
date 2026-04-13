'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ScopeItem } from '../hooks/useQuote'
import type { LibraryItem } from '../hooks/useScopeLibrary'
import type { Trade } from '../hooks/useTrades'
import { LineItemRow } from './LineItemRow'

interface RoomSectionProps {
  name: string
  items: ScopeItem[]
  onUpdateItem: (itemId: string, changes: Record<string, unknown>) => void
  onDeleteItem: (itemId: string) => void
  onAddItem: (room: string) => ScopeItem
  onUpdateDimensions: (
    room: string,
    dims: {
      room_length?: number | null
      room_width?: number | null
      room_height?: number | null
    }
  ) => void
  onRenameRoom: (oldName: string, newName: string) => void
  onDeleteRoom: (room: string) => void
  onReorderItems: (room: string, orderedIds: string[]) => void
  search: (q: string) => LibraryItem[]
  isLocked: boolean
  insurer: string | null
  trades: Trade[]
  autoFocusName?: boolean
  dragListeners?: any
  dragAttributes?: any
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function DimInput({
  value,
  label,
  onChange,
}: {
  value: number | null
  label: string
  onChange: (v: number | null) => void
}) {
  const [local, setLocal] = useState(value != null ? String(value) : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const isFocusedRef = useRef(false)

  // Sync local state with value prop only on mount
  // Local state is the source of truth throughout the component's lifecycle
  useEffect(() => {
    setLocal(value != null ? String(value) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {label ? (
        <span
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 10,
            color: '#9e998f',
            userSelect: 'none',
          }}
        >
          {label}
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={local}
        placeholder="0.0"
        onChange={e => setLocal(e.target.value)}
        onFocus={e => {
          isFocusedRef.current = true
          e.currentTarget.select()
        }}
        onPointerDown={e => {
          e.stopPropagation()
          // Prevent drag from triggering when clicking on input
          ;(e.currentTarget as HTMLElement).dataset.noDrag = 'true'
        }}
        onBlur={() => {
          isFocusedRef.current = false
          const trimmed = local.trim()
          if (trimmed === '') {
            onChange(null)
          } else {
            const n = parseFloat(trimmed)
            if (!isNaN(n)) {
              onChange(n)
              setLocal(String(n))
            } else {
              setLocal(value != null ? String(value) : '')
            }
          }
        }}
        style={{
          width: 44,
          fontFamily: 'DM Mono, monospace',
          fontSize: 11,
          color: '#3a3530',
          background: 'rgba(255,255,255,0.6)',
          border: '1px solid #d8d0c8',
          borderRadius: 4,
          padding: '2px 5px',
          textAlign: 'center',
          outline: 'none',
        }}
      />
    </>
  )
}

function CalcIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <rect x="0.5" y="0.5" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1" />
      <rect x="2.5" y="2.5" width="3.5" height="2" rx="0.5" fill="currentColor" />
      <rect x="7" y="2.5" width="3.5" height="2" rx="0.5" fill="currentColor" />
      <rect x="2.5" y="5.5" width="3.5" height="2" rx="0.5" fill="currentColor" />
      <rect x="7" y="5.5" width="3.5" height="2" rx="0.5" fill="currentColor" />
      <rect x="2.5" y="8.5" width="3.5" height="2" rx="0.5" fill="currentColor" />
      <rect x="7" y="8.5" width="3.5" height="2" rx="0.5" fill="currentColor" />
    </svg>
  )
}

function CalcPanel({ l, w, h }: { l: number | null; w: number | null; h: number | null }) {
  const hasLH = l != null && h != null
  const hasWH = w != null && h != null
  const hasLW = l != null && w != null
  const hasL = l != null
  const hasW = w != null

  const wall1 = hasLH ? l! * h! : null
  const wall2 = hasWH ? w! * h! : null
  const allWalls = hasLH && hasWH ? 2 * l! * h! + 2 * w! * h! : null
  const ceilingFloor = hasLW ? l! * w! : null
  const perimeter = hasL && hasW ? 2 * l! + 2 * w! : null

  const fmtM = (v: number | null, unit: string) =>
    v != null ? `${v.toFixed(2)} ${unit}` : '—'

  const rows: { label: string; value: string }[] = [
    { label: 'Wall 1 (L×H)', value: fmtM(wall1, 'm²') },
    { label: 'Wall 2 (W×H)', value: fmtM(wall2, 'm²') },
    { label: 'All walls', value: fmtM(allWalls, 'm²') },
    { label: 'Ceiling / Floor', value: fmtM(ceilingFloor, 'm²') },
    { label: 'Perimeter', value: fmtM(perimeter, 'lm') },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        zIndex: 200,
        background: '#ffffff',
        border: '1px solid #d8d0c8',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        padding: '10px 14px',
        minWidth: 210,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#b0a89e',
          fontFamily: 'DM Sans, sans-serif',
          marginBottom: 8,
        }}
      >
        Room Calculations
      </div>
      {rows.map(r => (
        <div
          key={r.label}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 16,
            marginBottom: 5,
          }}
        >
          <span style={{ fontSize: 11, color: '#9e998f', fontFamily: 'DM Sans, sans-serif' }}>
            {r.label}
          </span>
          <span
            style={{ fontSize: 11, color: '#3a3530', fontFamily: 'DM Mono, monospace', fontWeight: 500 }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// Sortable wrapper for a single line item
function SortableLineItemRow({
  item,
  onUpdate,
  onDelete,
  search,
  isLocked,
  insurer,
  trades,
  onNavigateNext,
  descRef,
  activeId,
}: {
  item: ScopeItem
  onUpdate: (itemId: string, changes: Record<string, unknown>) => void
  onDelete: (itemId: string) => void
  search: (q: string) => LibraryItem[]
  isLocked: boolean
  insurer: string | null
  trades: Trade[]
  onNavigateNext: () => void
  descRef: React.RefObject<HTMLTextAreaElement | null>
  activeId: string | null
}) {
  // Use the stable key (_key if available, otherwise id) for dnd-kit to prevent remounts
  const sortableId = item._key ?? item.id
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: isLocked })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 2 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, cursor: isLocked ? 'default' : 'grab' }}
      {...attributes}
      {...(listeners as React.DOMAttributes<HTMLDivElement>)}
    >
      {/* Drop indicator line above this row when something is dragged over */}
      {activeId && activeId !== (item._key ?? item.id) && isDragging === false && (
        <div
          style={{
            position: 'absolute',
            top: -1,
            left: 0,
            right: 0,
            height: 2,
            background: '#c8b89a',
            borderRadius: 1,
            pointerEvents: 'none',
            zIndex: 10,
            opacity: 0.7,
          }}
        />
      )}
      <LineItemRow
        item={item}
        onUpdate={onUpdate}
        onDelete={onDelete}
        search={search}
        isLocked={isLocked}
        insurer={insurer}
        trades={trades}
        onNavigateNext={onNavigateNext}
        descRef={descRef}
        isDragging={isDragging}
      />
    </div>
  )
}

// ──────────────────────────────────────────────
// Grid / column constants
// ──────────────────────────────────────────────
const GRID = '1fr 60px 70px 110px 120px 130px 75px 100px 60px'

const COL_HEADERS = [
  'DESCRIPTION',
  'QTY',
  'UNIT',
  'LABOUR/UNIT',
  'MATERIALS/UNIT',
  'TRADE',
  'EST. HRS',
  'LINE TOTAL',
  '',
]

// ──────────────────────────────────────────────
// Main RoomSection
// ──────────────────────────────────────────────
export function RoomSection({
  name,
  items,
  onUpdateItem,
  onDeleteItem,
  onAddItem,
  onUpdateDimensions,
  onRenameRoom,
  onDeleteRoom,
  onReorderItems,
  search,
  isLocked,
  insurer,
  trades,
  autoFocusName,
}: RoomSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(name)
  const [showCalc, setShowCalc] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // dragOrderItems holds a snapshot of item order only while a drag is in progress.
  // All other rendering uses the `items` prop directly, so there is no sync lag.
  const [dragOrderItems, setDragOrderItems] = useState<ScopeItem[]>([])
  const displayItems = activeId ? dragOrderItems : items

  const nameInputRef = useRef<HTMLInputElement>(null)
  const calcRef = useRef<HTMLDivElement>(null)

  // Desc refs: keyed by item id
  const descRefs = useRef<Map<string, React.RefObject<HTMLTextAreaElement | null>>>(new Map())
  // Track stable keys to prevent remounts during item reference changes
  const stableKeysRef = useRef<Map<string, string>>(new Map())
  const pendingFocusId = useRef<string | null>(null)

  // Focus pending description field after render
  useEffect(() => {
    if (pendingFocusId.current) {
      const ref = descRefs.current.get(pendingFocusId.current)
      if (ref?.current) {
        ref.current.focus()
        pendingFocusId.current = null
      }
    }
  }, [displayItems])

  // Autofocus name on mount for new blank rooms
  useEffect(() => {
    if (autoFocusName && !isLocked) {
      setEditingName(true)
      setNameVal('')
      setTimeout(() => nameInputRef.current?.focus(), 30)
    }
  }, [autoFocusName, isLocked])

  // Close calc panel on outside click
  useEffect(() => {
    if (!showCalc) return
    function handler(e: MouseEvent) {
      if (!calcRef.current?.contains(e.target as Node)) {
        setShowCalc(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCalc])

  const handleDeleteRoom = useCallback(() => {
    if (items.length > 0) {
      if (!window.confirm(`Delete room "${name}" and all ${items.length} item(s)?`)) return
    }
    onDeleteRoom(name)
  }, [items.length, name, onDeleteRoom])

  const startEditName = useCallback(() => {
    if (isLocked) return
    setEditingName(true)
    setNameVal(name)
    setTimeout(() => nameInputRef.current?.select(), 10)
  }, [isLocked, name])

  const commitName = useCallback(() => {
    setEditingName(false)
    if (nameVal.trim() && nameVal.trim() !== name) {
      onRenameRoom(name, nameVal.trim())
    } else if (!nameVal.trim()) {
      setNameVal(name)
    }
  }, [nameVal, name, onRenameRoom])

  // Keyboard navigation between rows
  const handleNavigateNext = useCallback(
    (currentIndex: number) => {
      if (currentIndex < items.length - 1) {
        // Focus next row's description
        const nextItem = items[currentIndex + 1]
        const stableKey = nextItem._key ?? nextItem.id
        const ref = descRefs.current.get(stableKey)
        if (ref?.current) {
          ref.current.focus()
        }
      } else {
        // Add a new row and focus its description
        if (!isLocked) {
          const newItem = onAddItem(name)
          // Use the stable key from stableKeysRef for focus
          const stableKey = stableKeysRef.current.get(newItem.id) ?? (newItem._key ?? newItem.id)
          pendingFocusId.current = stableKey
        }
      }
    },
    [items, isLocked, onAddItem, name]
  )

  // dnd-kit setup
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 500,
        tolerance: 5,
      },
    })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // Prevent drag if the active element is an input or textarea
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }
    // Find the item by stable key to get the correct item
    const item = items.find(i => (i._key ?? i.id) === event.active.id)
    if (item) {
      setActiveId(String(item._key ?? item.id))
      setDragOrderItems(items) // snapshot current order at drag start
    }
  }, [items])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null) // switches displayItems back to items prop
      if (!over || active.id === over.id) return

      const oldIndex = dragOrderItems.findIndex(i => (i._key ?? i.id) === active.id)
      const newIndex = dragOrderItems.findIndex(i => (i._key ?? i.id) === over.id)
      const reordered = arrayMove(dragOrderItems, oldIndex, newIndex)
      // onReorderItems calls setItems in useQuote — batched with setActiveId(null)
      // so items prop is already in the new order when displayItems switches back
      onReorderItems(name, reordered.map(i => i.id))
    },
    [dragOrderItems, name, onReorderItems]
  )

  const firstItem = items[0] ?? null
  const l = firstItem?.room_length ?? null
  const w = firstItem?.room_width ?? null
  const h = firstItem?.room_height ?? null

  const activeItem = activeId ? dragOrderItems.find(i => i.id === activeId) ?? null : null

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Room header bar */}
      <div
        style={{
          background: '#e8e0d5',
          display: 'flex',
          alignItems: 'center',
          padding: '7px 14px',
          borderTop: '2px solid #d0c8bc',
          gap: 12,
        }}
      >
        {/* Name */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') {
                  setNameVal(name)
                  setEditingName(false)
                }
              }}
              onPointerDown={e => {
                e.stopPropagation()
                ;(e.currentTarget as HTMLElement).dataset.noDrag = 'true'
              }}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                color: '#3a3530',
                background: '#ffffff',
                border: '1px solid #c8b89a',
                borderRadius: 4,
                padding: '3px 6px',
                outline: 'none',
              }}
            />
          ) : (
            <span
              onClick={() => !isLocked && setEditingName(true)}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                color: '#3a3530',
                cursor: isLocked ? 'default' : 'pointer',
              }}
            >
              {name}
            </span>
          )}

          {/* Dimensions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <DimInput value={l} label="L" onChange={v => onUpdateDimensions(name, { room_length: v })} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9e998f' }}>×</span>
            <DimInput value={w} label="" onChange={v => onUpdateDimensions(name, { room_width: v })} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9e998f' }}>×</span>
            <DimInput value={h} label="" onChange={v => onUpdateDimensions(name, { room_height: v })} />
            <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 10, color: '#9e998f', userSelect: 'none' }}>
              m
            </span>

            {/* Calculator button */}
            <div ref={calcRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowCalc(s => !s)}
                title="Room calculations"
                style={{
                  background: showCalc ? 'rgba(200,184,154,0.18)' : 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: showCalc ? '#c8b89a' : '#b0a89e',
                  padding: '2px 4px',
                  borderRadius: 3,
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#c8b89a')}
                onMouseLeave={e => { e.currentTarget.style.color = showCalc ? '#c8b89a' : '#b0a89e' }}
              >
                <CalcIcon />
              </button>
              {showCalc && <CalcPanel l={l} w={w} h={h} />}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {!isLocked && (
            <button
              onClick={handleDeleteRoom}
              title="Delete room"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#b0a89e',
                fontSize: 16,
                padding: '2px 5px',
                borderRadius: 3,
                lineHeight: 1,
                fontFamily: 'monospace',
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#c5221f')}
              onMouseLeave={e => (e.currentTarget.style.color = '#b0a89e')}
            >
              ×
            </button>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9e998f',
              fontSize: 11,
              padding: '2px 5px',
              borderRadius: 3,
              lineHeight: 1,
              transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 0.15s ease',
            }}
          >
            ▲
          </button>
        </div>
      </div>

      {!collapsed && (
        <div>
          {/* Column headers — single row, always visible when expanded */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              background: '#fafaf8',
              borderBottom: '1px solid #e8e4e0',
            }}
          >
            {COL_HEADERS.map((h, i) => (
              <div
                key={i}
                style={{
                  padding: '5px 8px',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 9,
                  fontWeight: 400,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#b0a89e',
                  textAlign: i > 0 && i < 8 ? 'right' : 'left',
                  borderRight: i < 8 ? '1px solid #f0ece6' : 'none',
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Line items with drag-to-reorder */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={displayItems.map(i => i._key ?? i.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayItems.map((item, idx) => {
                // Use a stable key that persists across item reference changes
                // Initialize with _key if available (for temp→real ID swaps), otherwise use id
                if (!stableKeysRef.current.has(item.id)) {
                  stableKeysRef.current.set(item.id, item._key ?? item.id)
                }
                const stableKey = stableKeysRef.current.get(item.id)!
                // Ensure each item has a stable ref keyed by the stable key
                if (!descRefs.current.has(stableKey)) {
                  descRefs.current.set(
                    stableKey,
                    { current: null } as React.RefObject<HTMLTextAreaElement | null>
                  )
                }
                const dRef = descRefs.current.get(stableKey)!

                return (
                  <SortableLineItemRow
                    key={stableKey}
                    item={item}
                    onUpdate={onUpdateItem}
                    onDelete={onDeleteItem}
                    search={search}
                    isLocked={isLocked}
                    insurer={insurer}
                    trades={trades}
                    onNavigateNext={() => handleNavigateNext(idx)}
                    descRef={dRef}
                    activeId={activeId}
                  />
                )
              })}
            </SortableContext>

            {/* DragOverlay: ghost of the dragged row */}
            <DragOverlay>
              {activeItem ? (
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #c8b89a',
                    borderRadius: 4,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                    opacity: 0.9,
                    pointerEvents: 'none',
                  }}
                >
                  <LineItemRow
                    item={activeItem}
                    onUpdate={() => {}}
                    onDelete={() => {}}
                    search={search}
                    isLocked
                    insurer={insurer}
                    trades={trades}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Add item button */}
          {!isLocked && (
            <div style={{ padding: '8px 12px' }}>
              <button
                onClick={() => {
                  const newItem = onAddItem(name)
                  // Use the stable key from stableKeysRef for focus
                  const stableKey = stableKeysRef.current.get(newItem.id) ?? (newItem._key ?? newItem.id)
                  pendingFocusId.current = stableKey
                }}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 12,
                  color: '#9e998f',
                  background: 'none',
                  border: '1px dashed #d8d0c8',
                  borderRadius: 4,
                  padding: '5px 14px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#c8b89a'
                  e.currentTarget.style.color = '#6b6560'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#d8d0c8'
                  e.currentTarget.style.color = '#9e998f'
                }}
              >
                + Add Item to {name || 'Room'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
