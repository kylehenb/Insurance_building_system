'use client'

import React, { useState } from 'react'
import { formatEstHours } from '@/lib/utils'
import {
  type WorkOrderWithDetails,
  type QuoteRow,
  type TradeRow,
  type ScopeItemRow,
  type WODisplayItem,
  getTradeColor,
  garyLabel,
  aud,
  INVOICE_CHAIN_STEPS,
  woIsSent,
} from './types'

// ─── Status / Gary / InvoiceChain pills ────────────────────────────────────────

function StatusPill({ status }: { status: string | null }) {
  const s = status ?? 'pending'
  const styles: Record<string, { bg: string; color: string; border: string; label: string }> = {
    pending:          { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'Pending' },
    engaged:          { bg: '#eff4ff', color: '#1e40af', border: '#bfdbfe', label: 'Engaged' },
    works_complete:   { bg: '#fef3e2', color: '#92400e', border: '#fcd38d', label: 'Works Complete' },
    invoice_received: { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc', label: 'Invoice Received' },
  }
  const style = styles[s] ?? styles.pending
  return (
    <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 10, display: 'inline-block', background: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
      {style.label}
    </span>
  )
}

function GaryPill({ state }: { state: string | null }) {
  const s = state ?? 'not_started'
  const map: Record<string, { bg: string; color: string; border: string }> = {
    not_started:          { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
    confirmed:            { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc' },
    complete:             { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc' },
    waiting_on_dependent: { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
    waiting_reply:        { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
    booking_proposed:     { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
    return_visit_pending: { bg: '#fef3e2', color: '#92400e', border: '#fcd38d' },
  }
  const style = map[s] ?? map.not_started
  return (
    <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 10, display: 'inline-block', background: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
      {garyLabel(state)}
    </span>
  )
}

function InvoiceChain({ extStatus }: { extStatus: string | null }) {
  if (!extStatus) return <span style={{ fontSize: 10, color: '#9a9590' }}>—</span>
  const step = INVOICE_CHAIN_STEPS.find(s => s.key === extStatus)
  const label = step?.label ?? extStatus
  return (
    <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#fef3e2', color: '#92400e', border: '1px solid #fcd38d', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ─── Scope item editor ─────────────────────────────────────────────────────────

type ScopeItemData = { item_description: string; room: string | null; qty: number; rate_labour: number; rate_materials: number; line_total: number }


function ScopeItemEditRow({
  item,
  index,
  isNew,
  isLocked,
  modifiedFields,
  roomOptions,
  datalistId,
  onUpdate,
  onToggleDelete,
}: {
  item: WODisplayItem
  index: number
  isNew: boolean
  isLocked: boolean
  modifiedFields: Set<string>
  roomOptions: string[]
  datalistId: string
  onUpdate: (updates: Partial<ScopeItemRow>) => void
  onToggleDelete: () => void
}) {
  const [localDesc,      setLocalDesc]      = React.useState(item.item_description ?? '')
  const [localRoom,      setLocalRoom]      = React.useState(item.room ?? '')
  const [localQty,       setLocalQty]       = React.useState(String(item.qty ?? 0))
  const [localLabour,    setLocalLabour]     = React.useState(String(item.rate_labour ?? 0))
  const [localMaterials, setLocalMaterials]  = React.useState(String(item.rate_materials ?? 0))

  React.useEffect(() => { setLocalDesc(item.item_description ?? '') }, [item.item_description])
  React.useEffect(() => { setLocalRoom(item.room ?? '') }, [item.room])
  React.useEffect(() => { setLocalQty(String(item.qty ?? 0)) }, [item.qty])
  React.useEffect(() => { setLocalLabour(String(item.rate_labour ?? 0)) }, [item.rate_labour])
  React.useEffect(() => { setLocalMaterials(String(item.rate_materials ?? 0)) }, [item.rate_materials])

  const computedTotal = (parseFloat(localQty) || 0) * ((parseFloat(localLabour) || 0) + (parseFloat(localMaterials) || 0))

  function saveCalcFields() {
    const qty            = parseFloat(localQty) || 0
    const rate_labour    = parseFloat(localLabour) || 0
    const rate_materials = parseFloat(localMaterials) || 0
    const line_total     = qty * (rate_labour + rate_materials)
    onUpdate({ qty, rate_labour, rate_materials, line_total })
  }

  const deleted = item.isDeleted
  const rowBg = deleted ? '#fff0f0' : isNew ? '#f0fdf4' : 'transparent'

  function cellInputStyle(field: string): React.CSSProperties {
    const isMod  = modifiedFields.has(field)
    const isSans = field === 'item_description' || field === 'room'
    return {
      fontFamily: isSans ? 'DM Sans, sans-serif' : 'DM Mono, monospace',
      fontSize: 10,
      padding: '3px 6px',
      borderRadius: 4,
      border: deleted ? '1px solid transparent' : isMod ? '1px solid #fcd38d' : '1px solid #e8e4de',
      background: deleted ? 'transparent' : isMod ? '#fef3e2' : '#fff',
      color: deleted ? '#9a9590' : '#1a1a1a',
      textDecoration: deleted ? 'line-through' : 'none',
      outline: 'none',
    }
  }

  function readSpan(value: string, mono = false): React.ReactElement {
    return (
      <span style={{ fontFamily: mono ? 'DM Mono, monospace' : 'DM Sans, sans-serif', fontSize: 10, color: '#5a5650', display: 'block', padding: '3px 4px' }}>
        {value || '—'}
      </span>
    )
  }

  const canEditRoom = item.isAddedInWO && !isLocked && !deleted

  return (
    <tr style={{ background: rowBg }}>
      {/* Index */}
      <td style={{ width: 28, padding: '4px 6px', fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9a9590', textAlign: 'center', textDecoration: deleted ? 'line-through' : 'none' }}>
        {index + 1}
      </td>

      {/* Description */}
      <td style={{ padding: '4px 6px', minWidth: 160 }}>
        {isLocked ? readSpan(item.item_description ?? '') : (
          <input
            value={localDesc}
            disabled={deleted}
            onChange={e => setLocalDesc(e.target.value)}
            onBlur={() => { if (localDesc !== (item.item_description ?? '')) onUpdate({ item_description: localDesc }) }}
            style={{ ...cellInputStyle('item_description'), width: '100%' }}
          />
        )}
      </td>

      {/* Room */}
      <td style={{ padding: '4px 6px', width: 110 }}>
        {canEditRoom ? (
          <>
            <input
              list={datalistId}
              value={localRoom}
              placeholder="Room…"
              onChange={e => setLocalRoom(e.target.value)}
              onBlur={() => {
                const next = localRoom.trim() || null
                if (next !== (item.room ?? null)) onUpdate({ room: next })
              }}
              style={{ ...cellInputStyle('room'), width: 98 }}
            />
          </>
        ) : (
          readSpan(item.room ?? '')
        )}
      </td>

      {/* Qty */}
      <td style={{ padding: '4px 6px', width: 70 }}>
        {isLocked ? readSpan(String(item.qty ?? 0), true) : (
          <input
            type="number"
            value={localQty}
            disabled={deleted}
            onChange={e => setLocalQty(e.target.value)}
            onBlur={saveCalcFields}
            style={{ ...cellInputStyle('qty'), width: 60 }}
          />
        )}
      </td>

      {/* Labour Rate */}
      <td style={{ padding: '4px 6px', width: 100 }}>
        {isLocked ? readSpan(String(item.rate_labour ?? 0), true) : (
          <input
            type="number"
            value={localLabour}
            disabled={deleted}
            onChange={e => setLocalLabour(e.target.value)}
            onBlur={saveCalcFields}
            style={{ ...cellInputStyle('rate_labour'), width: 88 }}
          />
        )}
      </td>

      {/* Material Rate */}
      <td style={{ padding: '4px 6px', width: 110 }}>
        {isLocked ? readSpan(String(item.rate_materials ?? 0), true) : (
          <input
            type="number"
            value={localMaterials}
            disabled={deleted}
            onChange={e => setLocalMaterials(e.target.value)}
            onBlur={saveCalcFields}
            style={{ ...cellInputStyle('rate_materials'), width: 96 }}
          />
        )}
      </td>

      {/* Subtotal — read-only, auto-calculated */}
      <td style={{ padding: '4px 6px', width: 100 }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: deleted ? '#9a9590' : '#5a5650', display: 'block', padding: '3px 4px', textDecoration: deleted ? 'line-through' : 'none' }}>
          {aud.format(computedTotal)}
        </span>
      </td>

      {/* Delete toggle — hidden when locked */}
      <td style={{ padding: '4px 6px', width: 36, textAlign: 'center' }}>
        {!isLocked && (
          <button
            onClick={onToggleDelete}
            title={deleted ? 'Restore item' : 'Remove item'}
            style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: deleted ? '#2d6a4f' : '#991b1b', padding: '2px 4px', borderRadius: 3, lineHeight: 1 }}
          >
            {deleted ? '↩' : '×'}
          </button>
        )}
      </td>
    </tr>
  )
}

function NewItemRow({
  tradeLabel,
  roomOptions,
  datalistId,
  onAdd,
}: {
  tradeLabel: string
  roomOptions: string[]
  datalistId: string
  onAdd: (data: ScopeItemData) => void
}) {
  type NewForm = Omit<ScopeItemData, 'line_total'>
  const blank: NewForm = { item_description: '', room: null, qty: 1, rate_labour: 0, rate_materials: 0 }
  const [form, setForm] = useState<NewForm>(blank)

  function field<K extends keyof NewForm>(key: K, val: string) {
    if (key === 'item_description') {
      setForm(prev => ({ ...prev, item_description: val }))
    } else if (key === 'room') {
      setForm(prev => ({ ...prev, room: val || null }))
    } else {
      setForm(prev => ({ ...prev, [key]: parseFloat(val) || 0 }))
    }
  }

  const computedTotal = (form.qty as number) * ((form.rate_labour as number) + (form.rate_materials as number))

  function handleAdd() {
    if (!form.item_description.trim()) return
    onAdd({ ...form, line_total: computedTotal })
    setForm(blank)
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 10,
    padding: '3px 6px',
    borderRadius: 4,
    border: '1px solid #ddd8d0',
    background: '#f0fdf4',
    color: '#1a1a1a',
    outline: 'none',
  }

  return (
    <tr style={{ background: '#f0fdf4', borderTop: '1px dashed #86efac' }}>
      <td style={{ padding: '4px 6px', width: 28, color: '#9a9590', fontSize: 10, textAlign: 'center' }}>+</td>
      <td style={{ padding: '4px 6px', minWidth: 160 }}>
        <input
          placeholder={`New ${tradeLabel} item…`}
          value={form.item_description}
          onChange={e => field('item_description', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          style={{ ...inputStyle, width: '100%' }}
        />
      </td>
      <td style={{ padding: '4px 6px', width: 110 }}>
        <input
          list={datalistId}
          placeholder="Room…"
          value={form.room ?? ''}
          onChange={e => field('room', e.target.value)}
          style={{ ...inputStyle, width: 98 }}
        />
      </td>
      <td style={{ padding: '4px 6px', width: 70 }}>
        <input type="number" value={form.qty as number} onChange={e => field('qty', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 60 }} />
      </td>
      <td style={{ padding: '4px 6px', width: 100 }}>
        <input type="number" value={form.rate_labour as number} onChange={e => field('rate_labour', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 88 }} />
      </td>
      <td style={{ padding: '4px 6px', width: 110 }}>
        <input type="number" value={form.rate_materials as number} onChange={e => field('rate_materials', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 96 }} />
      </td>
      <td style={{ padding: '4px 6px', width: 100 }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#5a5650', display: 'block', padding: '3px 4px' }}>
          {aud.format(computedTotal)}
        </span>
      </td>
      <td style={{ padding: '4px 6px', width: 36 }}>
        <button
          onClick={handleAdd}
          disabled={!form.item_description.trim()}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #86efac',
            background: form.item_description.trim() ? '#16a34a' : '#d1fae5',
            color: form.item_description.trim() ? '#fff' : '#9a9590',
            cursor: form.item_description.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Add
        </button>
      </td>
    </tr>
  )
}

const SCOPE_TH: React.CSSProperties = {
  padding: '4px 6px',
  textAlign: 'left',
  fontSize: 8,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: '#9a9590',
  borderBottom: '1px solid #e8e4de',
  background: '#faf8f5',
  whiteSpace: 'nowrap',
}

function ScopeItemsEditor({
  wo,
  isLocked,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
}: {
  wo: WorkOrderWithDetails
  isLocked: boolean
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
}) {
  const [newItemIds,     setNewItemIds]     = useState<Set<string>>(new Set())
  const [modifiedFields, setModifiedFields] = useState<Map<string, Set<string>>>(new Map())

  function markModified(itemId: string, field: string) {
    setModifiedFields(prev => {
      const next = new Map(prev)
      const fields = new Set(next.get(itemId) ?? [])
      fields.add(field)
      next.set(itemId, fields)
      return next
    })
  }

  async function handleUpdate(itemId: string, updates: Partial<ScopeItemRow>) {
    for (const field of Object.keys(updates)) markModified(itemId, field)
    await onUpdateScopeItem(itemId, updates)
  }

  async function handleCreate(data: ScopeItemData) {
    const newId = await onCreateScopeItem(wo.quote_id ?? '', wo.tradeTypeLabel, wo.id, data)
    if (newId) setNewItemIds(prev => new Set([...prev, newId]))
  }

  const items = wo.woDisplayItems

  // Datalist of rooms already used in this WO (for the combo-box suggestions)
  const datalistId = `room-opts-${wo.id}`
  const roomOptions = Array.from(new Set(
    items.filter(i => i.room && !i.isDeleted).map(i => i.room as string)
  ))

  // Group items by room
  const roomOrder: string[] = []
  const byRoom = new Map<string, WODisplayItem[]>()
  for (const item of items) {
    const room = item.room ?? 'Unassigned'
    if (!byRoom.has(room)) { byRoom.set(room, []); roomOrder.push(room) }
    byRoom.get(room)!.push(item)
  }

  // Flat ordered list with room awareness for index numbering
  let globalIdx = 0

  return (
    <div style={{ background: '#faf8f5', borderTop: '1px solid #e8e4de', overflowX: 'auto' }}>
      {/* Shared datalist for room suggestions — one per WO to avoid cross-contamination */}
      <datalist id={datalistId}>
        {roomOptions.map(r => <option key={r} value={r} />)}
      </datalist>

      {isLocked && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', background: '#eff4ff', borderBottom: '1px solid #bfdbfe' }}>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: '#1e40af', color: '#fff', letterSpacing: '.04em' }}>
            LOCKED
          </span>
          <span style={{ fontSize: 10, color: '#1e40af' }}>
            This work order has been sent and locked — scope items are read-only.
          </span>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={SCOPE_TH}>#</th>
            <th style={{ ...SCOPE_TH, minWidth: 160 }}>Description</th>
            <th style={{ ...SCOPE_TH, width: 110 }}>Room</th>
            <th style={SCOPE_TH}>Qty</th>
            <th style={SCOPE_TH}>Labour Rate</th>
            <th style={SCOPE_TH}>Material Rate</th>
            <th style={SCOPE_TH}>Subtotal</th>
            <th style={SCOPE_TH} />
          </tr>
        </thead>
        <tbody>
          {roomOrder.map(room => {
            const roomItems = byRoom.get(room)!
            return (
              <React.Fragment key={room}>
                <tr>
                  <td colSpan={8} style={{ padding: '4px 10px', background: '#f0ede8', borderBottom: '1px solid #e8e4de', borderTop: '4px solid #faf8f5' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5a5650' }}>
                      {room}
                    </span>
                  </td>
                </tr>
                {roomItems.map(item => {
                  const idx = globalIdx++
                  return (
                    <ScopeItemEditRow
                      key={item.id}
                      item={item}
                      index={idx}
                      isNew={newItemIds.has(item.id)}
                      isLocked={isLocked}
                      modifiedFields={modifiedFields.get(item.id) ?? new Set()}
                      roomOptions={roomOptions}
                      datalistId={datalistId}
                      onUpdate={(updates) => handleUpdate(item.id, updates)}
                      onToggleDelete={() => onSoftDeleteScopeItem(wo.id, item.id)}
                    />
                  )
                })}
              </React.Fragment>
            )
          })}
          {!isLocked && (
            <NewItemRow
              tradeLabel={wo.tradeTypeLabel}
              roomOptions={roomOptions}
              datalistId={datalistId}
              onAdd={handleCreate}
            />
          )}
        </tbody>
      </table>
      {items.length === 0 && (
        <div style={{ padding: '8px 16px', fontSize: 10, color: '#9a9590' }}>
          No scope items yet — add one above.
        </div>
      )}
    </div>
  )
}

// ─── Work order row ────────────────────────────────────────────────────────────

function WORow({
  wo,
  trades,
  onUpdate,
  onDelete,
  onLock,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
}: {
  wo: WorkOrderWithDetails
  trades: TradeRow[]
  onUpdate: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null; trade_name: string | undefined }>) => void
  onDelete: (id: string) => void
  onLock: (id: string) => void
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
}) {
  const [expanded,       setExpanded]     = useState(false)
  const [localTradeId,   setLocalTradeId] = React.useState(wo.trade_id || '')
  const [localTradeName, setLocalTradeName] = React.useState(wo.tradeTypeLabel || wo.trade_name || '')
  const [localAgreedAmt, setLocalAgreedAmt] = React.useState(
    (wo.agreed_amount ?? wo.lineItemsTotal).toString()
  )

  const color    = getTradeColor(wo.tradeTypeLabel)
  const isLocked = woIsSent(wo)

  const xeroStyle =
    wo.invoice?.accounting_sync_status === 'synced'
      ? { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc', label: 'Synced' }
      : { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'Pending' }

  const isEditable  = wo.status === 'pending'
  const isAdditional = !wo.quote_id
  const effectiveTrade = isAdditional && wo.work_type !== 'make_safe' ? localTradeName : wo.tradeTypeLabel
  const tradeType  = wo.work_type === 'make_safe' ? 'make_safe' : effectiveTrade
  const eligibleTrades = trades.filter(t => t.primary_trade === tradeType || t.primary_trade === tradeType.toLowerCase())
  const tradeOptions = Array.from(new Set(trades.map(t => t.primary_trade).filter((t): t is string => !!t)))

  React.useEffect(() => {
    setLocalTradeId(wo.trade_id || '')
    setLocalTradeName(wo.tradeTypeLabel || wo.trade_name || '')
    setLocalAgreedAmt((wo.agreed_amount ?? wo.lineItemsTotal).toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo.trade_id, wo.trade_name, wo.agreed_amount, wo.lineItemsTotal])

  const TD: React.CSSProperties = { padding: '6px 10px', borderBottom: expanded ? 'none' : '1px solid #e8e4de' }
  const MONO: React.CSSProperties = { ...TD, fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9a9590', whiteSpace: 'nowrap' }

  return (
    <>
      <tr style={{ background: expanded ? '#f5f2ee' : undefined }}>
        {/* Expand toggle */}
        <td style={{ ...TD, width: 28, textAlign: 'center', padding: '6px 4px' }}>
          <button
            onClick={() => setExpanded(e => !e)}
            title={expanded ? 'Collapse scope' : 'Expand scope items'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#9a9590', padding: 2, lineHeight: 1 }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </td>

        {/* Seq */}
        <td style={{ ...MONO }}>{wo.sequence_order ?? '—'}</td>

        {/* Trade */}
        <td style={{ ...TD, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal' }}>
          {isAdditional && wo.work_type !== 'make_safe' && isEditable && !isLocked ? (
            <select
              value={localTradeName}
              onChange={e => setLocalTradeName(e.target.value)}
              onBlur={() => {
                if (localTradeName !== (wo.tradeTypeLabel || wo.trade_name || '')) {
                  onUpdate(wo.id, { trade_name: localTradeName || undefined })
                }
              }}
              style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid #ddd8d0', background: '#fff', color: '#1a1a1a', maxWidth: '130px', width: '100%' }}
            >
              <option value="">Select trade…</option>
              {tradeOptions.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          ) : (
            <>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 5, verticalAlign: 'middle' }} />
              {wo.tradeTypeLabel || wo.work_type}
            </>
          )}
        </td>

        {/* Contractor */}
        <td style={{ ...TD, color: '#1a1a1a', maxWidth: '140px', wordWrap: 'break-word', overflowWrap: 'break-word' }}>
          {isEditable ? (
            <select
              value={localTradeId}
              onChange={e => setLocalTradeId(e.target.value)}
              onBlur={() => {
                if (localTradeId !== (wo.trade_id || '')) onUpdate(wo.id, { trade_id: localTradeId || undefined })
              }}
              style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid #ddd8d0', background: '#fff', color: '#1a1a1a', maxWidth: '140px', width: '100%' }}
            >
              <option value="">Select contractor...</option>
              {eligibleTrades.map(t => (
                <option key={t.id} value={t.id}>{t.business_name || t.primary_trade}</option>
              ))}
            </select>
          ) : (
            wo.trade?.business_name ?? <span style={{ color: '#991b1b', fontSize: 10 }}>No contractor</span>
          )}
        </td>

        {/* Status */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}><StatusPill status={wo.status} /></td>

        {/* Gary */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}><GaryPill state={wo.gary_state} /></td>

        {/* Hours */}
        <td style={{ ...MONO }}>{formatEstHours(wo.estimated_hours)}</td>

        {/* Lag */}
        <td style={{ ...MONO, color: wo.lagDays > 0 ? '#92400e' : '#9a9590' }}>
          {wo.lagDays > 0 ? `${wo.lagDays}d` : '—'}
        </td>

        {/* Quoted */}
        <td style={{ ...MONO }}>{wo.quotedAllowance > 0 ? aud.format(wo.quotedAllowance) : '—'}</td>

        {/* Override */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          {isEditable ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                value={localAgreedAmt}
                onChange={e => setLocalAgreedAmt(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(localAgreedAmt)
                  const newValue = isNaN(parsed) ? null : parsed
                  // Save null when value matches lineItemsTotal (auto-tracks WO item sum), else save manual override
                  const saveValue = (newValue !== null && Math.abs(newValue - wo.lineItemsTotal) < 0.01) ? null : newValue
                  if (saveValue !== wo.agreed_amount) onUpdate(wo.id, { agreed_amount: saveValue })
                }}
                style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid #ddd8d0', background: '#fff', color: '#1a1a1a', width: 80 }}
              />
              {wo.agreed_amount !== null && Math.abs(wo.agreed_amount - wo.lineItemsTotal) > 0.01 && (
                <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: '#fef3e2', color: '#92400e', border: '1px solid #fcd38d', whiteSpace: 'nowrap' }}>
                  Manual
                </span>
              )}
            </div>
          ) : (
            aud.format(wo.agreed_amount ?? wo.lineItemsTotal)
          )}
        </td>

        {/* Trade cost */}
        <td style={{ ...MONO }}>{wo.trade_cost ? aud.format(wo.trade_cost) : '—'}</td>

        {/* Invoice chain */}
        <td style={{ ...TD }}>
          <InvoiceChain extStatus={isLocked ? (wo.invoice?.external_status ?? 'sent_awaiting_invoice') : null} />
        </td>

        {/* Xero */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 10, background: xeroStyle.bg, color: xeroStyle.color, border: `1px solid ${xeroStyle.border}` }}>
            {xeroStyle.label}
          </span>
        </td>

        {/* Preview */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <a
            href={`/print/work-orders/${wo.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, background: '#1a1a1a', color: '#fff', border: '1px solid #1a1a1a', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }}
            onMouseEnter={e => { const t = e.target as HTMLElement; t.style.background = '#333'; t.style.borderColor = '#333' }}
            onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = '#1a1a1a'; t.style.borderColor = '#1a1a1a' }}
          >
            Preview
          </a>
        </td>

        {/* Actions: Send & Lock + Delete */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {!isLocked ? (
              <button
                onClick={() => {
                  if (!confirm(`Send and lock this ${wo.tradeTypeLabel || wo.work_type} work order? Scope items will become read-only.`)) return
                  onLock(wo.id)
                }}
                title="Send and lock work order"
                style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: '#1e40af', color: '#fff', border: '1px solid #1e40af', cursor: 'pointer' }}
                onMouseEnter={e => { const t = e.currentTarget; t.style.background = '#1d3fad' }}
                onMouseLeave={e => { const t = e.currentTarget; t.style.background = '#1e40af' }}
              >
                Send & Lock
              </button>
            ) : (
              <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: '#eff4ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                Locked
              </span>
            )}
            {!isLocked && (
              <button
                onClick={() => {
                  if (!confirm(`Delete this ${wo.tradeTypeLabel || wo.work_type} work order? Its scope items will become unallocated.`)) return
                  onDelete(wo.id)
                }}
                title="Delete work order"
                style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, background: '#fff', color: '#991b1b', border: '1px solid #fca5a5', cursor: 'pointer' }}
                onMouseEnter={e => { const t = e.currentTarget; t.style.background = '#fee2e2' }}
                onMouseLeave={e => { const t = e.currentTarget; t.style.background = '#fff' }}
              >
                Delete
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded scope editor */}
      {expanded && (
        <tr>
          <td colSpan={15} style={{ padding: 0, borderBottom: '1px solid #e8e4de' }}>
            <ScopeItemsEditor
              wo={wo}
              isLocked={isLocked}
              onUpdateScopeItem={onUpdateScopeItem}
              onSoftDeleteScopeItem={onSoftDeleteScopeItem}
              onCreateScopeItem={onCreateScopeItem}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Work order table ──────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '4px 10px',
  textAlign: 'left',
  fontSize: 9,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: '#9a9590',
  borderBottom: '1px solid #e8e4de',
  background: '#fff',
  whiteSpace: 'nowrap',
}

function WOTable({
  workOrders,
  trades,
  onUpdate,
  onDelete,
  onLock,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
}: {
  workOrders: WorkOrderWithDetails[]
  trades: TradeRow[]
  onUpdate: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null; trade_name: string | undefined }>) => void
  onDelete: (id: string) => void
  onLock: (id: string) => void
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          <th style={{ ...TH, width: 28, padding: '4px 4px' }} />
          <th style={TH}>Seq</th>
          <th style={TH}>Trade</th>
          <th style={{ ...TH, maxWidth: '140px', whiteSpace: 'normal' }}>Contractor</th>
          <th style={TH}>Status</th>
          <th style={TH}>Gary</th>
          <th style={TH}>Hours</th>
          <th style={TH}>Lag</th>
          <th style={TH}>Quoted</th>
          <th style={TH}>Override</th>
          <th style={TH}>Trade cost</th>
          <th style={TH}>Invoice chain</th>
          <th style={TH}>Xero</th>
          <th style={TH}>Preview</th>
          <th style={TH} />
        </tr>
      </thead>
      <tbody>
        {workOrders.map(wo => (
          <WORow
            key={wo.id}
            wo={wo}
            trades={trades}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onLock={onLock}
            onUpdateScopeItem={onUpdateScopeItem}
            onSoftDeleteScopeItem={onSoftDeleteScopeItem}
            onCreateScopeItem={onCreateScopeItem}
          />
        ))}
      </tbody>
    </table>
  )
}

// ─── Unallocated works section ─────────────────────────────────────────────────

function UnallocatedSection({
  scopeItems,
  workOrders,
  quotes,
  onAddWorkOrderForTrade,
}: {
  scopeItems: ScopeItemRow[]
  workOrders: WorkOrderWithDetails[]
  quotes: QuoteRow[]
  onAddWorkOrderForTrade: (quoteId: string, tradeName: string) => Promise<void>
}) {
  // Find (quoteId, trade) groups with no active work order
  const groups: { quoteId: string; trade: string; items: ScopeItemRow[] }[] = []

  const seen = new Set<string>()
  for (const si of scopeItems) {
    if (!si.trade) continue
    const key = `${si.quote_id}:${si.trade}`
    if (seen.has(key)) continue
    seen.add(key)

    const hasWO = workOrders.some(wo => wo.quote_id === si.quote_id && wo.tradeTypeLabel === si.trade)
    if (!hasWO) {
      const items = scopeItems.filter(s => s.quote_id === si.quote_id && s.trade === si.trade)
      groups.push({ quoteId: si.quote_id, trade: si.trade, items })
    }
  }

  if (groups.length === 0) return null

  const quoteMap = new Map(quotes.map(q => [q.id, q]))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 20px', background: '#fef3e2', borderBottom: '1px solid #fcd38d', gap: 8, position: 'sticky', top: 0, zIndex: 4 }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#92400e', color: '#fff', letterSpacing: '.03em' }}>
          Unallocated works
        </span>
        <span style={{ fontSize: 10, color: '#92400e' }}>
          {groups.length} trade{groups.length !== 1 ? 's' : ''} without a work order
        </span>
      </div>

      {groups.map(({ quoteId, trade, items }) => {
        const quote = quoteMap.get(quoteId)
        const quoteRef = quote?.quote_ref ?? `Q-${quoteId.slice(0, 8)}`
        const subtotal = items.reduce((s, i) => s + (i.line_total ?? 0), 0)

        return (
          <div key={`${quoteId}:${trade}`} style={{ borderBottom: '1px solid #fcd38d', padding: '10px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#92400e' }}>{trade}</span>
              <span style={{ fontSize: 9, color: '#9a9590', fontFamily: 'DM Mono, monospace' }}>{quoteRef}</span>
              <span style={{ fontSize: 9, color: '#9a9590', fontFamily: 'DM Mono, monospace' }}>{aud.format(subtotal)} ex GST</span>
              <span style={{ fontSize: 9, color: '#9a9590' }}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
              <button
                onClick={() => onAddWorkOrderForTrade(quoteId, trade)}
                style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 10px', borderRadius: 4, border: '1px solid #fcd38d', background: '#fff', color: '#92400e', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                onMouseEnter={e => { const t = e.currentTarget; t.style.background = '#92400e'; t.style.color = '#fff' }}
                onMouseLeave={e => { const t = e.currentTarget; t.style.background = '#fff'; t.style.color = '#92400e' }}
              >
                + Re-add work order
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {items.slice(0, 5).map(item => (
                <span key={item.id} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: '#fef3e2', color: '#92400e', border: '1px solid #fcd38d' }}>
                  {item.item_description ?? '(no description)'}
                </span>
              ))}
              {items.length > 5 && (
                <span style={{ fontSize: 9, color: '#9a9590' }}>+{items.length - 5} more</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Bottom panel ──────────────────────────────────────────────────────────────

export interface BottomPanelProps {
  workOrders:  WorkOrderWithDetails[]
  scopeItems:  ScopeItemRow[]
  quotes:      QuoteRow[]
  trades:      TradeRow[]
  jobId:       string
  tenantId:    string
  onAddToQuote: (quoteId: string) => void
  onAddAdditional: () => void
  onUpdateWorkOrder: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null; trade_name: string | undefined }>) => void
  onDeleteWorkOrder: (id: string) => Promise<void>
  onLockWorkOrder: (id: string) => Promise<void>
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
  onAddWorkOrderForTrade: (quoteId: string, tradeName: string) => Promise<void>
  onRefresh: () => void
}

export function BottomPanel({
  workOrders,
  scopeItems,
  quotes,
  trades,
  jobId,
  tenantId,
  onAddToQuote,
  onAddAdditional,
  onUpdateWorkOrder,
  onDeleteWorkOrder,
  onLockWorkOrder,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
  onAddWorkOrderForTrade,
  onRefresh,
}: BottomPanelProps) {
  const [open,    setOpen]    = useState(true)
  const [syncing, setSyncing] = useState(false)

  async function handleSyncFromQuote() {
    setSyncing(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/work-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? 'Failed to sync work orders')
      } else {
        const created = data.workOrdersCreated?.length ?? 0
        alert(created > 0 ? `${created} work order${created === 1 ? '' : 's'} created.` : (data.message ?? 'No new work orders created.'))
      }
      onRefresh()
    } finally {
      setSyncing(false)
    }
  }

  const quotedWOs     = workOrders.filter(wo => wo.quote_id !== null && wo.work_type !== 'make_safe')
  const additionalWOs = workOrders.filter(wo => wo.quote_id === null  || wo.work_type === 'make_safe')

  function quoteTotal(quoteId: string) {
    return quotedWOs.filter(wo => wo.quote_id === quoteId).reduce((s, wo) => s + wo.quotedAllowance, 0)
  }

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #ddd8d0', background: '#fff', display: 'flex', flexDirection: 'column', height: 'auto', transition: 'height .2s ease' }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', padding: '7px 20px', background: '#ede9e3', borderBottom: '1px solid #ddd8d0', cursor: 'pointer', gap: 9, userSelect: 'none', flexShrink: 0 }}
      >
        <span style={{ fontSize: 9, color: '#9a9590' }}>{open ? '▲' : '▼'}</span>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.09em', color: '#5a5650', flex: 1 }}>
          All work orders — by quote
        </span>
        <span style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#9a9590' }}>
          {workOrders.length} orders
        </span>
      </div>

      {open && (
        <div style={{ overflowX: 'auto', paddingBottom: '24px' }}>
          {/* Quote sections */}
          {quotes.map(quote => {
            const qWOs = quotedWOs.filter(wo => wo.quote_id === quote.id)
            return (
              <div key={quote.id}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 20px', background: '#f5f2ee', borderBottom: '1px solid #e8e4de', gap: 8, position: 'sticky', top: 0, zIndex: 4 }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#1a1a1a', color: '#fff', letterSpacing: '.03em' }}>
                    {quote.quote_ref ?? `Q-${quote.id.slice(0, 8)}`}
                  </span>
                  <span style={{ fontSize: 10, color: '#9a9590' }}>
                    {aud.format(quoteTotal(quote.id))} ex GST · {qWOs.length} orders
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleSyncFromQuote}
                      disabled={syncing}
                      style={{ padding: '2px 9px', fontSize: 10, fontFamily: 'DM Sans, sans-serif', border: '1px solid #ddd8d0', borderRadius: 4, background: '#fff', color: '#9a9590', cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1 }}
                      onMouseEnter={e => { if (syncing) return; const t = e.target as HTMLElement; t.style.background = '#1a1a1a'; t.style.color = '#fff'; t.style.borderColor = '#1a1a1a' }}
                      onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = '#fff'; t.style.color = '#9a9590'; t.style.borderColor = '#ddd8d0' }}
                    >
                      {syncing ? 'Syncing…' : '↻ Sync from quote'}
                    </button>
                    <button
                      onClick={() => onAddToQuote(quote.id)}
                      style={{ padding: '2px 9px', fontSize: 10, fontFamily: 'DM Sans, sans-serif', border: '1px solid #ddd8d0', borderRadius: 4, background: '#fff', color: '#9a9590', cursor: 'pointer' }}
                      onMouseEnter={e => { const t = e.target as HTMLElement; t.style.background = '#1a1a1a'; t.style.color = '#fff'; t.style.borderColor = '#1a1a1a' }}
                      onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = '#fff'; t.style.color = '#9a9590'; t.style.borderColor = '#ddd8d0' }}
                    >
                      + Add to quote
                    </button>
                  </div>
                </div>
                {qWOs.length > 0 ? (
                  <WOTable
                    workOrders={qWOs}
                    trades={trades}
                    onUpdate={onUpdateWorkOrder}
                    onDelete={onDeleteWorkOrder}
                    onLock={onLockWorkOrder}
                    onUpdateScopeItem={onUpdateScopeItem}
                    onSoftDeleteScopeItem={onSoftDeleteScopeItem}
                    onCreateScopeItem={onCreateScopeItem}
                  />
                ) : (
                  <div style={{ padding: '10px 20px', fontSize: 11, color: '#9a9590' }}>
                    No work orders for this quote yet.
                  </div>
                )}
              </div>
            )
          })}

          {/* Unallocated works */}
          <UnallocatedSection
            scopeItems={scopeItems}
            workOrders={workOrders}
            quotes={quotes}
            onAddWorkOrderForTrade={onAddWorkOrderForTrade}
          />

          {/* Additional works */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 20px', background: '#f5f2ee', borderBottom: '1px solid #e8e4de', gap: 8, position: 'sticky', top: 0, zIndex: 4 }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'transparent', border: '1px solid #ddd8d0', color: '#5a5650', letterSpacing: '.03em' }}>
                Additional works
              </span>
              <span style={{ fontSize: 10, color: '#9a9590' }}>Make safes · Specialist reports · Non-quoted</span>
              <button
                onClick={onAddAdditional}
                style={{ marginLeft: 'auto', padding: '2px 9px', fontSize: 10, fontFamily: 'DM Sans, sans-serif', border: '1px solid #ddd8d0', borderRadius: 4, background: '#fff', color: '#9a9590', cursor: 'pointer' }}
                onMouseEnter={e => { const t = e.target as HTMLElement; t.style.background = '#1a1a1a'; t.style.color = '#fff'; t.style.borderColor = '#1a1a1a' }}
                onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = '#fff'; t.style.color = '#9a9590'; t.style.borderColor = '#ddd8d0' }}
              >
                + Add
              </button>
            </div>
            {additionalWOs.length > 0 ? (
              <WOTable
                workOrders={additionalWOs}
                trades={trades}
                onUpdate={onUpdateWorkOrder}
                onDelete={onDeleteWorkOrder}
                onLock={onLockWorkOrder}
                onUpdateScopeItem={onUpdateScopeItem}
                onSoftDeleteScopeItem={onSoftDeleteScopeItem}
                onCreateScopeItem={onCreateScopeItem}
              />
            ) : (
              <div style={{ padding: '10px 20px', fontSize: 11, color: '#9a9590' }}>
                No additional work orders yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
