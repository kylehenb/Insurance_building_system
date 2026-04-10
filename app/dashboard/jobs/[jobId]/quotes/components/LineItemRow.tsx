'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../hooks/useScopeLibrary'
import type { ScopeItem } from '../hooks/useQuote'
import { DescriptionSearch } from './DescriptionSearch'

interface LineItemRowProps {
  item: ScopeItem
  onUpdate: (itemId: string, changes: Record<string, unknown>) => void
  onDelete: (itemId: string) => void
  search: (q: string) => LibraryItem[]
  isLocked: boolean
  insurer: string | null
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(v)
}

function NumericCell({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
}) {
  const [local, setLocal] = useState(value != null ? String(value) : '')

  // Sync when prop changes from outside (e.g. library select)
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (prevValueRef.current !== value) {
      setLocal(value != null ? String(value) : '')
      prevValueRef.current = value
    }
  }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      disabled={disabled}
      onChange={e => setLocal(e.target.value)}
      onFocus={e => e.currentTarget.select()}
      onBlur={() => {
        const trimmed = local.trim()
        if (trimmed === '') {
          onChange(null)
        } else {
          const num = parseFloat(trimmed)
          if (!isNaN(num)) {
            onChange(num)
            setLocal(String(num))
          } else {
            setLocal(value != null ? String(value) : '')
          }
        }
      }}
      style={{
        width: '100%',
        fontFamily: 'DM Mono, monospace',
        fontSize: 12,
        color: '#3a3530',
        background: disabled ? '#f5f2ee' : '#ffffff',
        border: '1px solid #d8d0c8',
        borderRadius: 4,
        outline: 'none',
        textAlign: 'right',
        padding: '3px 6px',
        cursor: disabled ? 'default' : 'text',
        boxSizing: 'border-box',
      }}
    />
  )
}

export function LineItemRow({ item, onUpdate, onDelete, search, isLocked, insurer }: LineItemRowProps) {
  const [estHours, setEstHours] = useState<number | null>(null)
  const [showWriteback, setShowWriteback] = useState(false)

  const hasLineTotal = (item.line_total ?? 0) > 0

  const handleLibrarySelect = useCallback(
    (lib: LibraryItem) => {
      const changes: Record<string, unknown> = {
        item_description: lib.item_description ?? '',
        rate_labour: lib.labour_per_unit,
        rate_materials: lib.materials_per_unit,
        trade: lib.trade ?? '',
        keyword: lib.keyword ?? '',
        unit: lib.unit ?? '',
        scope_library_id: lib.id,
        is_custom: false,
        library_writeback_approved: false,
      }
      setEstHours(lib.estimated_hours)
      setShowWriteback(false)
      onUpdate(item.id, changes)
    },
    [item.id, onUpdate]
  )

  const handleDescriptionChange = useCallback(
    (desc: string) => {
      setEstHours(null)
      setShowWriteback(false)
      onUpdate(item.id, {
        item_description: desc,
        scope_library_id: null,
        is_custom: true,
      })
    },
    [item.id, onUpdate]
  )

  const handleDescriptionBlur = useCallback(() => {
    if (
      item.is_custom &&
      (item.rate_labour != null || item.rate_materials != null) &&
      item.item_description?.trim()
    ) {
      setShowWriteback(true)
    }
  }, [item.is_custom, item.rate_labour, item.rate_materials, item.item_description])

  const confirmDelete = useCallback(() => {
    if (hasLineTotal) {
      if (!window.confirm('Delete this item?')) return
    }
    onDelete(item.id)
  }, [hasLineTotal, onDelete, item.id])

  const col: React.CSSProperties = {
    padding: '8px 10px',
    borderRight: '1px solid #f0ece6',
    display: 'flex',
    alignItems: 'flex-start',
  }

  return (
    <div style={{ borderBottom: '1px solid #f0ece6' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 60px 110px 120px 130px 75px 100px 40px',
          minHeight: 40,
        }}
      >
        {/* Description */}
        <div style={{ ...col, alignItems: 'flex-start' }}>
          <DescriptionSearch
            value={item.item_description ?? ''}
            onChange={handleDescriptionChange}
            onSelect={handleLibrarySelect}
            onBlur={handleDescriptionBlur}
            search={search}
            disabled={isLocked}
          />
        </div>

        {/* QTY */}
        <div style={{ ...col, justifyContent: 'flex-end' }}>
          <NumericCell
            value={item.qty}
            onChange={v => onUpdate(item.id, { qty: v })}
            disabled={isLocked}
          />
        </div>

        {/* Labour/Unit */}
        <div style={{ ...col, justifyContent: 'flex-end' }}>
          <NumericCell
            value={item.rate_labour}
            onChange={v => onUpdate(item.id, { rate_labour: v })}
            disabled={isLocked}
          />
        </div>

        {/* Materials/Unit */}
        <div style={{ ...col, justifyContent: 'flex-end' }}>
          <NumericCell
            value={item.rate_materials}
            onChange={v => onUpdate(item.id, { rate_materials: v })}
            disabled={isLocked}
          />
        </div>

        {/* Trade */}
        <div style={col}>
          <input
            type="text"
            value={item.trade ?? ''}
            onChange={e => onUpdate(item.id, { trade: e.target.value })}
            disabled={isLocked}
            placeholder="Trade"
            style={{
              width: '100%',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 12,
              color: '#3a3530',
              background: isLocked ? '#f5f2ee' : '#ffffff',
              border: '1px solid #d8d0c8',
              borderRadius: 4,
              outline: 'none',
              padding: '3px 6px',
              cursor: isLocked ? 'default' : 'text',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Est. Hours */}
        <div
          style={{
            ...col,
            justifyContent: 'flex-end',
            cursor: 'help',
          }}
          title="Labour hours per unit — used for scheduling"
        >
          <span
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 12,
              color: '#9e998f',
            }}
          >
            {estHours != null ? estHours : '—'}
          </span>
        </div>

        {/* Line Total */}
        <div style={{ ...col, justifyContent: 'flex-end' }}>
          <span
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 12,
              fontWeight: 500,
              color: hasLineTotal ? '#3a3530' : '#c0bab3',
            }}
          >
            {hasLineTotal ? fmt(item.line_total!) : '—'}
          </span>
        </div>

        {/* Actions */}
        <div
          style={{
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {!isLocked && (
            <button
              onClick={confirmDelete}
              title={hasLineTotal ? 'Delete item' : 'Remove row'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: hasLineTotal ? '#b0a89e' : '#c8b89a',
                fontSize: hasLineTotal ? 18 : 16,
                lineHeight: 1,
                padding: '2px 4px',
                borderRadius: 3,
                fontFamily: 'monospace',
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = hasLineTotal ? '#c5221f' : '#9e998f'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = hasLineTotal ? '#b0a89e' : '#c8b89a'
              }}
            >
              {hasLineTotal ? '×' : '−'}
            </button>
          )}
        </div>
      </div>

      {/* Library writeback opt-in */}
      {showWriteback && item.is_custom && !item.scope_library_id && !isLocked && (
        <div
          style={{
            padding: '4px 10px 6px 10px',
            background: '#fafaf8',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <input
            type="checkbox"
            id={`writeback-${item.id}`}
            checked={item.library_writeback_approved}
            onChange={e => onUpdate(item.id, { library_writeback_approved: e.target.checked })}
            style={{ accentColor: '#c8b89a', cursor: 'pointer' }}
          />
          <label
            htmlFor={`writeback-${item.id}`}
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 11,
              color: '#9e998f',
              cursor: 'pointer',
            }}
          >
            Save to scope library as {insurer ?? 'default'} template
          </label>
        </div>
      )}
    </div>
  )
}
