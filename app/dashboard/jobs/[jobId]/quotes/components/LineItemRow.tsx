'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../hooks/useScopeLibrary'
import type { ScopeItem, ItemType } from '../hooks/useQuote'
import type { Trade } from '../hooks/useTrades'
import { DescriptionSearch } from './DescriptionSearch'

const UNITS = ['m²', 'm³', 'lm', 'ea', 'hr', 'item', 'set'] as const

const ITEM_TYPE_LABELS: Record<NonNullable<ItemType>, { label: string; pill: string; color: string; border: string }> = {
  provisional_sum: { label: 'Provisional Sum', pill: 'PS', color: '#b45309', border: '#f59e0b' },
  prime_cost:      { label: 'Prime Cost',      pill: 'PC', color: '#1a73e8', border: '#60a5fa' },
  cash_settlement: { label: 'Cash Settlement', pill: 'CS', color: '#64748b', border: '#94a3b8' },
}

interface LineItemRowProps {
  item: ScopeItem
  itemIndex: number
  onUpdate: (itemId: string, changes: Record<string, unknown>) => void
  onDelete: (itemId: string) => void
  search: (q: string) => LibraryItem[]
  isLocked: boolean
  trades: Trade[]
  onNavigateNext?: () => void
  descRef?: React.RefObject<HTMLTextAreaElement | null>
  isDragging?: boolean
  tenantId: string
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
  onNavigateNext,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  onNavigateNext?: () => void
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
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={local}
      disabled={disabled}
      onChange={e => setLocal(e.target.value)}
      onFocus={e => {
        isFocusedRef.current = true
        e.currentTarget.select()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
          onNavigateNext?.()
        }
      }}
      onBlur={() => {
        isFocusedRef.current = false
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
      // Prevent drag from activating when clicking into the input
      onPointerDown={e => e.stopPropagation()}
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

// Bidirectional numeric cell with unit rate and total (qty x rate)
function BidirectionalNumericCell({
  unitRate,
  total,
  qty,
  onUnitRateChange,
  onTotalChange,
  disabled,
  onNavigateNext,
  label,
}: {
  unitRate: number | null
  total: number | null
  qty: number | null
  onUnitRateChange: (v: number | null) => void
  onTotalChange: (v: number | null) => void
  disabled?: boolean
  onNavigateNext?: () => void
  label: string
}) {
  const [localUnitRate, setLocalUnitRate] = useState(unitRate != null ? String(unitRate) : '')
  const [localTotal, setLocalTotal] = useState(total != null ? String(total) : '')
  const unitRateRef = useRef<HTMLInputElement>(null)
  const totalRef = useRef<HTMLInputElement>(null)
  const unitRateFocusedRef = useRef(false)
  const totalFocusedRef = useRef(false)

  // Sync local state with props only on mount
  useEffect(() => {
    setLocalUnitRate(unitRate != null ? String(unitRate) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    setLocalTotal(total != null ? String(total) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Calculate total from unit rate when qty changes
  useEffect(() => {
    if (qty != null && unitRate != null && !unitRateFocusedRef.current && !totalFocusedRef.current) {
      const calculatedTotal = qty * unitRate
      setLocalTotal(String(calculatedTotal))
      onTotalChange(calculatedTotal)
    }
  }, [qty, unitRate, onTotalChange])

  const handleUnitRateBlur = () => {
    unitRateFocusedRef.current = false
    const trimmed = localUnitRate.trim()
    if (trimmed === '') {
      onUnitRateChange(null)
      if (qty != null) {
        onTotalChange(0)
        setLocalTotal('0')
      }
    } else {
      const num = parseFloat(trimmed)
      if (!isNaN(num)) {
        onUnitRateChange(num)
        setLocalUnitRate(String(num))
        // Recalculate total
        if (qty != null) {
          const calculatedTotal = qty * num
          setLocalTotal(String(calculatedTotal))
          onTotalChange(calculatedTotal)
        }
      } else {
        setLocalUnitRate(unitRate != null ? String(unitRate) : '')
      }
    }
  }

  const handleTotalBlur = () => {
    totalFocusedRef.current = false
    const trimmed = localTotal.trim()
    if (trimmed === '') {
      onTotalChange(null)
      onUnitRateChange(null)
      setLocalUnitRate('')
    } else {
      const num = parseFloat(trimmed)
      if (!isNaN(num)) {
        onTotalChange(num)
        setLocalTotal(String(num))
        // Recalculate unit rate
        if (qty != null && qty > 0) {
          const calculatedUnitRate = num / qty
          setLocalUnitRate(String(calculatedUnitRate))
          onUnitRateChange(calculatedUnitRate)
        }
      } else {
        setLocalTotal(total != null ? String(total) : '')
      }
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontFamily: 'DM Mono, monospace',
    fontSize: 11,
    color: '#3a3530',
    background: disabled ? '#f5f2ee' : '#ffffff',
    border: '1px solid #d8d0c8',
    borderRadius: 3,
    outline: 'none',
    textAlign: 'right',
    padding: '2px 4px',
    cursor: disabled ? 'default' : 'text',
    boxSizing: 'border-box' as const,
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 9,
    color: '#9e998f',
    marginLeft: 4,
    whiteSpace: 'nowrap',
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        width: '100%',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          ref={unitRateRef}
          type="text"
          inputMode="decimal"
          placeholder={label}
          value={localUnitRate}
          disabled={disabled}
          onChange={e => setLocalUnitRate(e.target.value)}
          onFocus={e => {
            unitRateFocusedRef.current = true
            e.currentTarget.select()
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
              onNavigateNext?.()
            }
          }}
          onBlur={handleUnitRateBlur}
          style={inputStyle}
        />
        <span style={labelStyle}>Unit</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          ref={totalRef}
          type="text"
          inputMode="decimal"
          placeholder="Total"
          value={localTotal}
          disabled={disabled}
          onChange={e => setLocalTotal(e.target.value)}
          onFocus={e => {
            totalFocusedRef.current = true
            e.currentTarget.select()
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
              onNavigateNext?.()
            }
          }}
          onBlur={handleTotalBlur}
          style={{
            ...inputStyle,
            fontSize: 10,
            color: '#6b6560',
          }}
        />
        <span style={labelStyle}>Total</span>
      </div>
    </div>
  )
}

// Chevron SVG data URI — exactly one, positioned right
const CHEVRON_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M1 2.5l3 3 3-3' stroke='%239e998f' stroke-width='1.2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`

const selectBaseStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 12,
  color: '#3a3530',
  border: '1px solid #d8d0c8',
  borderRadius: 4,
  outline: 'none',
  padding: '3px 20px 3px 4px',
  cursor: 'pointer',
  boxSizing: 'border-box',
  // Remove all native chrome
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  // Background properties as longhands so the SVG chevron applies correctly
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 5px center',
  backgroundSize: '8px 8px',
}

function makeSelectStyle(isLocked: boolean): React.CSSProperties {
  return {
    ...selectBaseStyle,
    backgroundColor: isLocked ? '#f5f2ee' : '#ffffff',
    backgroundImage: isLocked ? 'none' : CHEVRON_BG,
    cursor: isLocked ? 'default' : 'pointer',
  }
}

// ••• popover menu
function ItemTypeMenu({
  item,
  onUpdate,
  onClose,
  tenantId,
}: {
  item: ScopeItem
  onUpdate: (itemId: string, changes: Record<string, unknown>) => void
  onClose: () => void
  tenantId: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const setType = (type: ItemType) => {
    onUpdate(item.id, { item_type: type })
    onClose()
  }

  const handleSaveToScopeLibrary = async () => {
    if (!tenantId) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/scope-library/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          item: {
            trade: item.trade,
            keyword: item.keyword,
            item_description: item.item_description,
            unit: item.unit,
            rate_labour: item.rate_labour,
            rate_materials: item.rate_materials,
          },
        }),
      })
      const data = await response.json()
      if (response.ok) {
        onUpdate(item.id, { scope_library_id: data.id, library_writeback_approved: true })
        onClose()
      } else {
        alert(data.error || 'Failed to save to scope library')
      }
    } catch (error) {
      alert('Failed to save to scope library')
    } finally {
      setIsSaving(false)
    }
  }

  const types: Array<{ type: NonNullable<ItemType>; label: string }> = [
    { type: 'provisional_sum', label: 'Provisional Sum' },
    { type: 'prime_cost',      label: 'Prime Cost' },
    { type: 'cash_settlement', label: 'Cash Settlement' },
  ]

  const menuItemStyle = (active: boolean): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 12px',
    fontSize: 12,
    fontFamily: 'DM Sans, sans-serif',
    color: active ? '#3a3530' : '#6b6560',
    fontWeight: active ? 600 : 400,
    background: active ? '#f5f2ee' : 'transparent',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 3,
  })

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 300,
        background: '#ffffff',
        border: '1px solid #e0dbd4',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        minWidth: 180,
        padding: '4px',
        marginTop: 2,
      }}
      // Prevent drag activation from menu
      onPointerDown={e => e.stopPropagation()}
    >
      {/* Save to scope library */}
      {item.is_custom && !item.scope_library_id && (
        <>
          <button
            onClick={handleSaveToScopeLibrary}
            disabled={isSaving}
            style={menuItemStyle(false)}
          >
            {isSaving ? 'Saving...' : 'Save to scope library'}
          </button>
          <div style={{ height: 1, background: '#f0ece6', margin: '3px 0' }} />
        </>
      )}

      {/* Type section label */}
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#b0a89e',
          fontFamily: 'DM Sans, sans-serif',
          padding: '4px 12px 2px',
        }}
      >
        Line item type
      </div>

      {types.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => setType(item.item_type === type ? null : type)}
          style={menuItemStyle(item.item_type === type)}
        >
          {label}
        </button>
      ))}

      <button onClick={() => setType(null)} style={menuItemStyle(item.item_type === null)}>
        None
      </button>
    </div>
  )
}

export function LineItemRow({
  item,
  itemIndex,
  onUpdate,
  onDelete,
  search,
  isLocked,
  trades,
  onNavigateNext,
  descRef,
  isDragging,
  tenantId,
}: LineItemRowProps) {
  const [estHours, setEstHours] = useState<number | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [localUnit, setLocalUnit] = useState(item.unit ?? '')
  const [localTrade, setLocalTrade] = useState(item.trade ?? '')
  const menuAnchorRef = useRef<HTMLDivElement>(null)

  // Sync local state with item props only on mount
  // Local state is the source of truth throughout the component's lifecycle
  const unitSelectRef = useRef<HTMLSelectElement>(null)
  const tradeSelectRef = useRef<HTMLSelectElement>(null)
  const unitFocusedRef = useRef(false)
  const tradeFocusedRef = useRef(false)

  useEffect(() => {
    setLocalUnit(item.unit ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    setLocalTrade(item.trade ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasLineTotal = (item.line_total ?? 0) > 0
  const typeInfo = item.item_type ? ITEM_TYPE_LABELS[item.item_type] : null

  // Left-border colour based on item type
  const leftBorderColor = typeInfo?.border ?? 'transparent'

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
      setShowMenu(false)
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

  const selectStyle = makeSelectStyle(isLocked)

  const col: React.CSSProperties = {
    padding: '6px 8px',
    borderRight: '1px solid #f0ece6',
    display: 'flex',
    alignItems: 'center',
  }

  // ••• icon colour tint based on active type
  const menuIconColor = typeInfo ? typeInfo.color : '#c0bab3'

  return (
    <div
      style={{
        borderBottom: '1px solid #f0ece6',
        borderLeft: `3px solid ${leftBorderColor}`,
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1% 43.4% 5% 5.8% 9% 9% 10.5% 5% 8.3% 5%',
          minHeight: 60,
        }}
      >
        {/* Number */}
        <div
          style={{ ...col, justifyContent: 'center', padding: '6px 2px' }}
        >
          <span style={{ fontSize: 11, color: '#9e998f', fontFamily: 'DM Mono, monospace' }}>{itemIndex}</span>
        </div>

        {/* Description */}
        <div
          style={{ ...col, alignItems: 'flex-start', padding: '6px 8px' }}
          // Prevent drag when interacting with description area
          onPointerDown={e => e.stopPropagation()}
        >
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
              onNavigateNext={onNavigateNext}
              inputRef={descRef}
            />
          </div>
        </div>

        {/* QTY */}
        <div style={{ ...col, justifyContent: 'flex-end' }}>
          <NumericCell
            value={item.qty}
            onChange={v => onUpdate(item.id, { qty: v })}
            disabled={isLocked}
            onNavigateNext={onNavigateNext}
          />
        </div>

        {/* Unit */}
        <div style={col} onPointerDown={e => e.stopPropagation()}>
          <select
            ref={unitSelectRef}
            value={localUnit}
            onChange={e => setLocalUnit(e.target.value)}
            onFocus={() => { unitFocusedRef.current = true }}
            onBlur={() => {
              unitFocusedRef.current = false
              onUpdate(item.id, { unit: localUnit })
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onNavigateNext?.() }
            }}
            disabled={isLocked}
            style={selectStyle}
          >
            <option value="">—</option>
            {UNITS.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Labour/Unit */}
        <div style={{ ...col, justifyContent: 'flex-end', alignItems: 'flex-start', paddingTop: '4px' }}>
          <BidirectionalNumericCell
            unitRate={item.rate_labour}
            total={item.labour_total ?? null}
            qty={item.qty}
            onUnitRateChange={v => onUpdate(item.id, { rate_labour: v })}
            onTotalChange={v => onUpdate(item.id, { labour_total: v })}
            disabled={isLocked}
            onNavigateNext={onNavigateNext}
            label="Labour/Unit"
          />
        </div>

        {/* Materials/Unit */}
        <div style={{ ...col, justifyContent: 'flex-end', alignItems: 'flex-start', paddingTop: '4px' }}>
          <BidirectionalNumericCell
            unitRate={item.rate_materials}
            total={item.materials_total ?? null}
            qty={item.qty}
            onUnitRateChange={v => onUpdate(item.id, { rate_materials: v })}
            onTotalChange={v => onUpdate(item.id, { materials_total: v })}
            disabled={isLocked}
            onNavigateNext={onNavigateNext}
            label="Mat/Unit"
          />
        </div>

        {/* Trade */}
        <div style={col} onPointerDown={e => e.stopPropagation()}>
          <select
            ref={tradeSelectRef}
            value={localTrade}
            onChange={e => setLocalTrade(e.target.value)}
            onFocus={() => { tradeFocusedRef.current = true }}
            onBlur={() => {
              tradeFocusedRef.current = false
              onUpdate(item.id, { trade: localTrade })
            }}
            disabled={isLocked}
            onKeyDown={e => {
              if (e.key === 'Tab') {
                // Tab out of last interactive field → navigate to next row
                e.preventDefault()
                onNavigateNext?.()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                onNavigateNext?.()
              }
            }}
            style={selectStyle}
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
          {typeInfo && (
            <span
              style={{
                marginRight: 4,
                padding: '1px 5px',
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                fontFamily: 'DM Sans, sans-serif',
                background: `${leftBorderColor}22`,
                color: typeInfo.color,
              }}
            >
              {typeInfo.pill}
            </span>
          )}
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

        {/* Actions: ••• + × */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            padding: '0 4px',
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          {!isLocked && (
            <>
              {/* ••• menu button */}
              <div ref={menuAnchorRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowMenu(s => !s)}
                  title="Item options"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: menuIconColor,
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: 'DM Sans, sans-serif',
                    lineHeight: 1,
                    padding: '2px 3px',
                    borderRadius: 3,
                    letterSpacing: '0.05em',
                    transition: 'color 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#3a3530')}
                  onMouseLeave={e => (e.currentTarget.style.color = menuIconColor)}
                >
                  •••
                </button>
                {showMenu && (
                  <ItemTypeMenu
                    item={item}
                    onUpdate={onUpdate}
                    onClose={() => setShowMenu(false)}
                    tenantId={tenantId}
                  />
                )}
              </div>

              {/* × delete */}
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
    </div>
  )
}
