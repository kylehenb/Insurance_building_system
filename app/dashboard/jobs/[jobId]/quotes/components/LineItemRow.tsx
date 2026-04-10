'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../hooks/useScopeLibrary'
import type { ScopeItem } from '../hooks/useQuote'
import type { Trade } from '../hooks/useTrades'
import { DescriptionSearch } from './DescriptionSearch'

const UNITS = ['m²', 'm³', 'lm', 'ea', 'hr', 'item', 'set'] as const

interface LineItemRowProps {
  item: ScopeItem
  onUpdate: (itemId: string, changes: Record<string, unknown>) => void
  onDelete: (itemId: string) => void
  search: (q: string) => LibraryItem[]
  isLocked: boolean
  insurer: string | null
  trades: Trade[]
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

const selectStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 12,
  color: '#3a3530',
  border: '1px solid #d8d0c8',
  borderRadius: 4,
  outline: 'none',
  padding: '3px 4px',
  cursor: 'pointer',
  boxSizing: 'border-box',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 4px center',
  backgroundSize: '8px',
  paddingRight: 16,
}

export function LineItemRow({ item, onUpdate, onDelete, search, isLocked, insurer, trades }: LineItemRowProps) {
  const [estHours, setEstHours] = useState<number | null>(null)
  const [showTemplate, setShowTemplate] = useState(false)

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
      setShowTemplate(false)
      onUpdate(item.id, changes)
    },
    [item.id, onUpdate]
  )

  const handleDescriptionChange = useCallback(
    (desc: string) => {
      setEstHours(null)
      onUpdate(item.id, {
        item_description: desc,
        scope_library_id: null,
        is_custom: true,
      })
    },
    [item.id, onUpdate]
  )

  const confirmDelete = useCallback(() => {
    if (hasLineTotal) {
      if (!window.confirm('Delete this item?')) return
    }
    onDelete(item.id)
  }, [hasLineTotal, onDelete, item.id])

  const col: React.CSSProperties = {
    padding: '6px 8px',
    borderRight: '1px solid #f0ece6',
    display: 'flex',
    alignItems: 'center',
  }

  const chevronBg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M1 2.5l3 3 3-3' stroke='%239e998f' stroke-width='1.2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`

  return (
    <div style={{ borderBottom: '1px solid #f0ece6' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 60px 70px 110px 120px 130px 75px 100px 60px',
          minHeight: 40,
        }}
      >
        {/* Description */}
        <div style={{ ...col, alignItems: 'flex-start', padding: '6px 8px' }}>
          <div
            style={{
              background: isLocked ? '#f5f2ee' : '#ffffff',
              border: '1px solid #d8d0c8',
              borderRadius: 4,
              width: '100%',
              padding: '2px 5px',
              boxSizing: 'border-box',
            }}
          >
            <DescriptionSearch
              value={item.item_description ?? ''}
              onChange={handleDescriptionChange}
              onSelect={handleLibrarySelect}
              search={search}
              disabled={isLocked}
            />
          </div>
        </div>

        {/* QTY */}
        <div style={{ ...col, justifyContent: 'flex-end' }}>
          <NumericCell
            value={item.qty}
            onChange={v => onUpdate(item.id, { qty: v })}
            disabled={isLocked}
          />
        </div>

        {/* Unit */}
        <div style={col}>
          <select
            value={item.unit ?? ''}
            onChange={e => onUpdate(item.id, { unit: e.target.value })}
            disabled={isLocked}
            style={{
              ...selectStyle,
              background: isLocked
                ? '#f5f2ee'
                : `#ffffff ${chevronBg}`,
            }}
          >
            <option value="">—</option>
            {UNITS.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
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
          <select
            value={item.trade ?? ''}
            onChange={e => onUpdate(item.id, { trade: e.target.value })}
            disabled={isLocked}
            style={{
              ...selectStyle,
              background: isLocked
                ? '#f5f2ee'
                : `#ffffff ${chevronBg}`,
            }}
          >
            <option value="">—</option>
            {trades.map(t => (
              <option key={t.id} value={t.primary_trade}>
                {t.trade_code ? `${t.trade_code} – ${t.primary_trade}` : t.primary_trade}
              </option>
            ))}
          </select>
        </div>

        {/* Est. Hours */}
        <div
          style={{ ...col, justifyContent: 'flex-end', cursor: 'help' }}
          title="Labour hours per unit — used for scheduling"
        >
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#9e998f' }}>
            {estHours != null ? estHours : '—'}
          </span>
        </div>

        {/* Line Total */}
        <div style={{ ...col, justifyContent: 'flex-end', borderRight: 'none' }}>
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

        {/* Actions: T + × */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            padding: '0 6px',
          }}
        >
          {!isLocked && (
            <>
              <button
                onClick={() => setShowTemplate(s => !s)}
                title="Save as template"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: showTemplate ? '#c8b89a' : '#c0bab3',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'DM Sans, sans-serif',
                  lineHeight: 1,
                  padding: '2px 3px',
                  borderRadius: 3,
                  transition: 'color 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#c8b89a')}
                onMouseLeave={e => {
                  e.currentTarget.style.color = showTemplate ? '#c8b89a' : '#c0bab3'
                }}
              >
                T
              </button>
              <button
                onClick={confirmDelete}
                title="Delete item"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#b0a89e',
                  fontSize: 16,
                  lineHeight: 1,
                  padding: '2px 3px',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  transition: 'color 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#c5221f')}
                onMouseLeave={e => (e.currentTarget.style.color = '#b0a89e')}
              >
                ×
              </button>
            </>
          )}
        </div>
      </div>

      {/* Library writeback / template panel */}
      {showTemplate && item.is_custom && !item.scope_library_id && !isLocked && (
        <div
          style={{
            padding: '5px 12px 7px',
            background: '#fafaf8',
            borderTop: '1px solid #f0ece6',
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
