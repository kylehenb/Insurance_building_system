'use client'

import React, { useCallback, useRef, useState } from 'react'
import type { ScopeItem } from '../hooks/useQuote'
import type { LibraryItem } from '../hooks/useScopeLibrary'
import { LineItemRow } from './LineItemRow'

interface RoomSectionProps {
  name: string
  items: ScopeItem[]
  onUpdateItem: (itemId: string, changes: Record<string, unknown>) => void
  onDeleteItem: (itemId: string) => void
  onAddItem: (room: string) => void
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
  search: (q: string) => LibraryItem[]
  isLocked: boolean
  insurer: string | null
}

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

  return (
    <>
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
      <input
        type="text"
        inputMode="decimal"
        value={local}
        placeholder="0.0"
        onChange={e => setLocal(e.target.value)}
        onFocus={e => e.currentTarget.select()}
        onBlur={() => {
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

const COL_HEADERS = [
  'DESCRIPTION',
  'QTY',
  'LABOUR/UNIT',
  'MATERIALS/UNIT',
  'TRADE',
  'EST. HRS',
  'LINE TOTAL',
  '',
]

export function RoomSection({
  name,
  items,
  onUpdateItem,
  onDeleteItem,
  onAddItem,
  onUpdateDimensions,
  onRenameRoom,
  onDeleteRoom,
  search,
  isLocked,
  insurer,
}: RoomSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const firstItem = items[0] ?? null

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
    } else {
      setNameVal(name)
    }
  }, [nameVal, name, onRenameRoom])

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
                  setEditingName(false)
                  setNameVal(name)
                }
              }}
              autoFocus
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#3a3530',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid #c8b89a',
                outline: 'none',
                minWidth: 80,
                maxWidth: 200,
              }}
            />
          ) : (
            <span
              onDoubleClick={startEditName}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#3a3530',
                cursor: isLocked ? 'default' : 'text',
                userSelect: 'none',
              }}
              title={isLocked ? undefined : 'Double-click to rename'}
            >
              {name || 'Unnamed Room'}
            </span>
          )}

          {/* Dimensions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <DimInput
              value={firstItem?.room_length ?? null}
              label="L"
              onChange={v => onUpdateDimensions(name, { room_length: v })}
            />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9e998f' }}>
              ×
            </span>
            <DimInput
              value={firstItem?.room_width ?? null}
              label=""
              onChange={v => onUpdateDimensions(name, { room_width: v })}
            />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9e998f' }}>
              ×
            </span>
            <DimInput
              value={firstItem?.room_height ?? null}
              label=""
              onChange={v => onUpdateDimensions(name, { room_height: v })}
            />
            <span
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 10,
                color: '#9e998f',
                userSelect: 'none',
              }}
            >
              m
            </span>
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
                fontSize: 13,
                padding: '2px 5px',
                borderRadius: 3,
                lineHeight: 1,
              }}
            >
              🗑
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
          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 88px 88px 120px 64px 88px 48px',
              background: '#fafaf8',
              borderBottom: '1px solid #e8e4e0',
            }}
          >
            {COL_HEADERS.map((h, i) => (
              <div
                key={i}
                style={{
                  padding: '5px 10px',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#9e998f',
                  textAlign: i > 0 && i < 7 ? 'right' : 'left',
                  borderRight: i < 7 ? '1px solid #f0ece6' : 'none',
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Line items */}
          {items.map(item => (
            <LineItemRow
              key={item.id}
              item={item}
              onUpdate={onUpdateItem}
              onDelete={onDeleteItem}
              search={search}
              isLocked={isLocked}
              insurer={insurer}
            />
          ))}

          {/* Add item button */}
          {!isLocked && (
            <div style={{ padding: '8px 12px' }}>
              <button
                onClick={() => onAddItem(name)}
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
