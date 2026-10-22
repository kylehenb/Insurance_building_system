'use client'

import React, { useState } from 'react'
import { Lock, Trash2 } from 'lucide-react'
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
  getUnallocatedScopeItems,
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
  if (!extStatus) return <span style={{ fontSize: 10, color: 'var(--subtle-2)' }}>—</span>
  const step = INVOICE_CHAIN_STEPS.find(s => s.key === extStatus)
  const label = step?.label ?? extStatus
  return (
    <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning-dark)', border: '1px solid var(--warning-soft)', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// Lock icon; the "Locked" label only appears on hover
function LockedBadge() {
  const [hover, setHover] = useState(false)
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Locked"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: '#eff4ff', color: 'var(--info-dark)', border: '1px solid #bfdbfe', cursor: 'default' }}
    >
      <Lock size={11} strokeWidth={2.2} />
      {hover && 'Locked'}
    </span>
  )
}

// Bin icon for cancelling a sent work order; "Cancel" appears on hover
function CancelWOButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Cancel work order"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: hover ? 'var(--danger-bg-3)' : 'var(--paper)', color: 'var(--danger-dark)', border: '1px solid var(--danger-soft)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
    >
      <Trash2 size={11} strokeWidth={2.2} />
      {hover && 'Cancel'}
    </button>
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
      <span style={{ fontFamily: mono ? 'DM Mono, monospace' : 'DM Sans, sans-serif', fontSize: 10, color: 'var(--body-soft)', display: 'block', padding: '3px 4px' }}>
        {value || '—'}
      </span>
    )
  }

  const canEditRoom = item.isAddedInWO && !isLocked && !deleted

  return (
    <tr style={{ background: rowBg }}>
      {/* Index */}
      <td style={{ width: 28, padding: '4px 6px', fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--subtle-2)', textAlign: 'center', textDecoration: deleted ? 'line-through' : 'none' }}>
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
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: deleted ? 'var(--subtle-2)' : 'var(--body-soft)', display: 'block', padding: '3px 4px', textDecoration: deleted ? 'line-through' : 'none' }}>
          {aud.format(computedTotal)}
        </span>
      </td>

      {/* Delete toggle — hidden when locked */}
      <td style={{ padding: '4px 6px', width: 36, textAlign: 'center' }}>
        {!isLocked && (
          <button
            onClick={onToggleDelete}
            title={deleted ? 'Restore item' : 'Remove item'}
            style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: deleted ? 'var(--forest)' : 'var(--danger-dark)', padding: '2px 4px', borderRadius: 3, lineHeight: 1 }}
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
    <tr style={{ background: 'var(--success-bg-2)', borderTop: '1px dashed #86efac' }}>
      <td style={{ padding: '4px 6px', width: 28, color: 'var(--subtle-2)', fontSize: 10, textAlign: 'center' }}>+</td>
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
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--body-soft)', display: 'block', padding: '3px 4px' }}>
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
            color: form.item_description.trim() ? 'var(--paper)' : 'var(--subtle-2)',
            cursor: form.item_description.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Add
        </button>
      </td>
    </tr>
  )
}

// Picker for claiming an unallocated item (quoted under a different trade)
// into this work order. Only ever offers items still sitting in Unallocated —
// moving an item that already belongs to another work order isn't supported
// from here.
function ClaimItemRow({
  eligibleItems,
  onClaim,
}: {
  eligibleItems: ScopeItemRow[]
  onClaim: (scopeItemId: string) => void
}) {
  const [selected, setSelected] = useState('')

  function handleClaim() {
    if (!selected) return
    onClaim(selected)
    setSelected('')
  }

  return (
    <tr style={{ background: 'var(--warning-bg)', borderTop: '1px dashed var(--warning-soft)' }}>
      <td style={{ padding: '4px 6px', width: 28, color: 'var(--warning-dark)', fontSize: 10, textAlign: 'center' }}>+</td>
      <td colSpan={5} style={{ padding: '4px 6px' }}>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: 10, padding: '3px 6px', borderRadius: 4,
            border: '1px solid var(--warning-soft)', background: 'var(--paper)', color: 'var(--ink)', width: '100%', maxWidth: 420,
          }}
        >
          <option value="">Add an unallocated item from another trade…</option>
          {eligibleItems.map(item => (
            <option key={item.id} value={item.id}>
              {item.item_description ?? '(no description)'} — {item.trade} — {aud.format(item.line_total ?? 0)}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px 6px', width: 36 }}>
        <button
          onClick={handleClaim}
          disabled={!selected}
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            border: '1px solid var(--warning-soft)',
            background: selected ? 'var(--warning-dark)' : '#fde8c8',
            color: selected ? 'var(--paper)' : 'var(--subtle-2)',
            cursor: selected ? 'pointer' : 'not-allowed',
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
  unallocatedItems,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
  onClaimScopeItem,
}: {
  wo: WorkOrderWithDetails
  isLocked: boolean
  unallocatedItems: ScopeItemRow[]
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
  onClaimScopeItem: (scopeItemId: string, workOrderId: string) => Promise<void>
}) {
  const [newItemIds,     setNewItemIds]     = useState<Set<string>>(new Set())
  const [modifiedFields, setModifiedFields] = useState<Map<string, Set<string>>>(new Map())
  const [editingRoom,    setEditingRoom]    = useState<string | null>(null)
  const [editRoomValue,  setEditRoomValue]  = useState('')

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

  async function handleRenameRoom(displayRoom: string, groupItems: WODisplayItem[]) {
    const newDisplay = editRoomValue.trim() || 'General'
    setEditingRoom(null)
    if (newDisplay === displayRoom) return
    const newRoomVal = newDisplay === 'General' ? null : newDisplay
    for (const item of groupItems.filter(i => !i.isDeleted)) {
      await onUpdateScopeItem(item.id, { room: newRoomVal })
    }
  }

  const items = wo.woDisplayItems

  // Unallocated items from the same quote, eligible to be claimed into this WO
  const eligibleUnallocated = unallocatedItems.filter(item => item.quote_id === wo.quote_id)

  // Datalist of rooms already used in this WO (for the combo-box suggestions)
  const datalistId = `room-opts-${wo.id}`
  const roomOptions = Array.from(new Set(
    items.filter(i => i.room && !i.isDeleted).map(i => i.room as string)
  ))

  // Group items by room
  const roomOrder: string[] = []
  const byRoom = new Map<string, WODisplayItem[]>()
  for (const item of items) {
    const room = item.room ?? 'General'
    if (!byRoom.has(room)) { byRoom.set(room, []); roomOrder.push(room) }
    byRoom.get(room)!.push(item)
  }

  // Flat ordered list with room awareness for index numbering
  let globalIdx = 0

  return (
    <div style={{ background: 'var(--surface-8)', borderTop: '1px solid var(--line-4)', overflowX: 'auto' }}>
      {/* Shared datalist for room suggestions — one per WO to avoid cross-contamination */}
      <datalist id={datalistId}>
        {roomOptions.map(r => <option key={r} value={r} />)}
      </datalist>

      {isLocked && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', background: '#eff4ff', borderBottom: '1px solid #bfdbfe' }}>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'var(--info-dark)', color: 'var(--paper)', letterSpacing: '.04em' }}>
            LOCKED
          </span>
          <span style={{ fontSize: 10, color: 'var(--info-dark)' }}>
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
                  <td colSpan={8} style={{ padding: '4px 10px', background: '#f0ede8', borderBottom: '1px solid var(--line-4)', borderTop: '4px solid var(--surface-8)' }}>
                    {!isLocked && editingRoom === room ? (
                      <input
                        autoFocus
                        value={editRoomValue}
                        onChange={e => setEditRoomValue(e.target.value)}
                        onBlur={() => handleRenameRoom(room, roomItems)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameRoom(room, roomItems)
                          if (e.key === 'Escape') setEditingRoom(null)
                        }}
                        style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--body-soft)', background: 'var(--paper)', border: '1px solid #c5bfb8', borderRadius: 3, padding: '1px 5px', outline: 'none', width: 140 }}
                      />
                    ) : (
                      <span
                        title={!isLocked ? 'Click to rename room' : undefined}
                        onClick={!isLocked ? () => { setEditingRoom(room); setEditRoomValue(room) } : undefined}
                        style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--body-soft)', cursor: !isLocked ? 'text' : 'default' }}
                      >
                        {room}
                      </span>
                    )}
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
          {!isLocked && eligibleUnallocated.length > 0 && (
            <ClaimItemRow
              eligibleItems={eligibleUnallocated}
              onClaim={itemId => onClaimScopeItem(itemId, wo.id)}
            />
          )}
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
        <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--subtle-2)' }}>
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
  tradeTypes,
  unallocatedItems,
  onUpdate,
  onDelete,
  onLock,
  onCancel,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
  onClaimScopeItem,
}: {
  wo: WorkOrderWithDetails
  trades: TradeRow[]
  tradeTypes: string[]
  unallocatedItems: ScopeItemRow[]
  onUpdate: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null; trade_name: string | undefined }>) => void
  onDelete: (id: string) => void
  onLock: (id: string) => void
  onCancel: (id: string) => void
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
  onClaimScopeItem: (scopeItemId: string, workOrderId: string) => Promise<void>
}) {
  const [expanded,       setExpanded]     = useState(false)
  const [localTradeId,   setLocalTradeId] = React.useState(wo.trade_id || '')
  const [localTradeName, setLocalTradeName] = React.useState(wo.tradeTypeLabel || wo.trade_name || '')
  const [localAgreedAmt, setLocalAgreedAmt] = React.useState(
    (wo.agreed_amount ?? wo.lineItemsTotal).toString()
  )

  const color    = getTradeColor(wo.tradeTypeLabel)
  const isLocked = woIsSent(wo)

  // Null when there's no trade invoice yet — nothing to sync, so show a dash
  const xeroStyle =
    !wo.invoice ? null
    : wo.invoice.accounting_sync_status === 'synced'
      ? { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc', label: 'Synced' }
      : { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'Pending' }

  const isEditable  = wo.status === 'pending'
  const isAdditional = !wo.quote_id
  const effectiveTrade = isAdditional && wo.work_type !== 'make_safe' ? localTradeName : wo.tradeTypeLabel
  const tradeType  = wo.work_type === 'make_safe' ? 'make_safe' : effectiveTrade
  const tradeTypeLower = tradeType.toLowerCase()
  const eligibleTrades = trades.filter(t =>
    t.primary_trade?.toLowerCase() === tradeTypeLower ||
    t.trade_specialties?.some(s => s.toLowerCase() === tradeTypeLower)
  )
  const tradeOptions = tradeTypes

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
      <tr style={{ background: expanded ? 'var(--surface)' : undefined }}>
        {/* Expand toggle */}
        <td style={{ ...TD, width: 28, textAlign: 'center', padding: '6px 4px' }}>
          <button
            onClick={() => setExpanded(e => !e)}
            title={expanded ? 'Collapse scope' : 'Expand scope items'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: 'var(--subtle-2)', padding: 2, lineHeight: 1 }}
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
              style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line-strong)', background: 'var(--paper)', color: 'var(--ink)', maxWidth: '130px', width: '100%' }}
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
        <td style={{ ...TD, color: 'var(--ink)', maxWidth: '140px', wordWrap: 'break-word', overflowWrap: 'break-word' }}>
          {isEditable ? (
            <select
              value={localTradeId}
              onChange={e => setLocalTradeId(e.target.value)}
              onBlur={() => {
                if (localTradeId !== (wo.trade_id || '')) onUpdate(wo.id, { trade_id: localTradeId || undefined })
              }}
              style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line-strong)', background: 'var(--paper)', color: 'var(--ink)', maxWidth: '140px', width: '100%' }}
            >
              <option value="">Select contractor...</option>
              {eligibleTrades.map(t => (
                <option key={t.id} value={t.id}>{t.business_name || t.primary_trade}</option>
              ))}
            </select>
          ) : (
            wo.trade?.business_name ?? <span style={{ color: 'var(--danger-dark)', fontSize: 10 }}>No contractor</span>
          )}
        </td>

        {/* Status */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}><StatusPill status={wo.status} /></td>

        {/* Gary */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}><GaryPill state={wo.gary_state} /></td>

        {/* Hours */}
        <td style={{ ...MONO }}>{formatEstHours(wo.estimated_hours)}</td>

        {/* Lag */}
        <td style={{ ...MONO, color: wo.lagDays > 0 ? 'var(--warning-dark)' : 'var(--subtle-2)' }}>
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
                style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line-strong)', background: 'var(--paper)', color: 'var(--ink)', width: 80 }}
              />
              {wo.agreed_amount !== null && Math.abs(wo.agreed_amount - wo.lineItemsTotal) > 0.01 && (
                <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: 'var(--warning-bg)', color: 'var(--warning-dark)', border: '1px solid var(--warning-soft)', whiteSpace: 'nowrap' }}>
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
          {xeroStyle ? (
            <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 10, background: xeroStyle.bg, color: xeroStyle.color, border: `1px solid ${xeroStyle.border}` }}>
              {xeroStyle.label}
            </span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--subtle-2)' }}>—</span>
          )}
        </td>

        {/* Preview */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <a
              href={`/print/work-orders/${wo.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }}
              onMouseEnter={e => { const t = e.target as HTMLElement; t.style.background = '#333'; t.style.borderColor = '#333' }}
              onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = 'var(--ink)'; t.style.borderColor = 'var(--ink)' }}
            >
              Preview
            </a>
            <a
              href={`/api/work-orders/${wo.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the trade PDF in a new tab"
              style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line-strong)', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }}
            >
              PDF
            </a>
          </div>
        </td>

        {/* Actions: Send & Lock + Delete, or Locked + Cancel once sent */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {!isLocked ? (
              <button
                onClick={() => onLock(wo.id)}
                title="Send and lock work order"
                style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'var(--info-dark)', color: 'var(--paper)', border: '1px solid var(--info-dark)', cursor: 'pointer' }}
                onMouseEnter={e => { const t = e.currentTarget; t.style.background = '#1d3fad' }}
                onMouseLeave={e => { const t = e.currentTarget; t.style.background = 'var(--info-dark)' }}
              >
                Send & Lock
              </button>
            ) : (
              <>
                <LockedBadge />
                <CancelWOButton onClick={() => onCancel(wo.id)} />
              </>
            )}
            {!isLocked && (
              <button
                onClick={() => {
                  if (!confirm(`Delete this ${wo.tradeTypeLabel || wo.work_type} work order? Its scope items will become unallocated.`)) return
                  onDelete(wo.id)
                }}
                title="Delete work order"
                style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, background: 'var(--paper)', color: 'var(--danger-dark)', border: '1px solid var(--danger-soft)', cursor: 'pointer' }}
                onMouseEnter={e => { const t = e.currentTarget; t.style.background = 'var(--danger-bg-3)' }}
                onMouseLeave={e => { const t = e.currentTarget; t.style.background = 'var(--paper)' }}
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
          <td colSpan={15} style={{ padding: 0, borderBottom: '1px solid var(--line-4)' }}>
            <ScopeItemsEditor
              wo={wo}
              isLocked={isLocked}
              unallocatedItems={unallocatedItems}
              onUpdateScopeItem={onUpdateScopeItem}
              onSoftDeleteScopeItem={onSoftDeleteScopeItem}
              onCreateScopeItem={onCreateScopeItem}
              onClaimScopeItem={onClaimScopeItem}
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
  tradeTypes,
  unallocatedItems,
  onUpdate,
  onDelete,
  onLock,
  onCancel,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
  onClaimScopeItem,
}: {
  workOrders: WorkOrderWithDetails[]
  trades: TradeRow[]
  tradeTypes: string[]
  unallocatedItems: ScopeItemRow[]
  onUpdate: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null; trade_name: string | undefined }>) => void
  onDelete: (id: string) => void
  onLock: (id: string) => void
  onCancel: (id: string) => void
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
  onClaimScopeItem: (scopeItemId: string, workOrderId: string) => Promise<void>
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
            tradeTypes={tradeTypes}
            unallocatedItems={unallocatedItems}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onLock={onLock}
            onCancel={onCancel}
            onUpdateScopeItem={onUpdateScopeItem}
            onSoftDeleteScopeItem={onSoftDeleteScopeItem}
            onCreateScopeItem={onCreateScopeItem}
            onClaimScopeItem={onClaimScopeItem}
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
  // Items with no owning work order — excludes anything explicitly claimed
  // into a work order elsewhere, even if that item's own trade has no WO.
  const unallocated = getUnallocatedScopeItems(scopeItems, workOrders)

  // Group by (quoteId, trade) for display
  const groups: { quoteId: string; trade: string; items: ScopeItemRow[] }[] = []

  const seen = new Set<string>()
  for (const si of unallocated) {
    const key = `${si.quote_id}:${si.trade}`
    if (seen.has(key)) continue
    seen.add(key)

    const items = unallocated.filter(s => s.quote_id === si.quote_id && s.trade === si.trade)
    groups.push({ quoteId: si.quote_id, trade: si.trade!, items })
  }

  if (groups.length === 0) return null

  const quoteMap = new Map(quotes.map(q => [q.id, q]))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 20px', background: 'var(--warning-bg)', borderBottom: '1px solid var(--warning-soft)', gap: 8, position: 'sticky', top: 0, zIndex: 4 }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--warning-dark)', color: 'var(--paper)', letterSpacing: '.03em' }}>
          Unallocated works
        </span>
        <span style={{ fontSize: 10, color: 'var(--warning-dark)' }}>
          {groups.length} trade{groups.length !== 1 ? 's' : ''} without a work order
        </span>
      </div>

      {groups.map(({ quoteId, trade, items }) => {
        const quote = quoteMap.get(quoteId)
        const quoteRef = quote?.quote_ref ?? `Q-${quoteId.slice(0, 8)}`
        const subtotal = items.reduce((s, i) => s + (i.line_total ?? 0), 0)

        return (
          <div key={`${quoteId}:${trade}`} style={{ borderBottom: '1px solid var(--warning-soft)', padding: '10px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--warning-dark)' }}>{trade}</span>
              <span style={{ fontSize: 9, color: 'var(--subtle-2)', fontFamily: 'DM Mono, monospace' }}>{quoteRef}</span>
              <span style={{ fontSize: 9, color: 'var(--subtle-2)', fontFamily: 'DM Mono, monospace' }}>{aud.format(subtotal)} ex GST</span>
              <span style={{ fontSize: 9, color: 'var(--subtle-2)' }}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
              <button
                onClick={() => onAddWorkOrderForTrade(quoteId, trade)}
                style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 10px', borderRadius: 4, border: '1px solid var(--warning-soft)', background: 'var(--paper)', color: 'var(--warning-dark)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                onMouseEnter={e => { const t = e.currentTarget; t.style.background = 'var(--warning-dark)'; t.style.color = 'var(--paper)' }}
                onMouseLeave={e => { const t = e.currentTarget; t.style.background = 'var(--paper)'; t.style.color = 'var(--warning-dark)' }}
              >
                + Re-add work order
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {items.slice(0, 5).map(item => (
                <span key={item.id} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'var(--warning-bg)', color: 'var(--warning-dark)', border: '1px solid var(--warning-soft)' }}>
                  {item.item_description ?? '(no description)'}
                </span>
              ))}
              {items.length > 5 && (
                <span style={{ fontSize: 9, color: 'var(--subtle-2)' }}>+{items.length - 5} more</span>
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
  tradeTypes:  string[]
  jobId:       string
  tenantId:    string
  onAddToQuote: (quoteId: string) => void
  onAddAdditional: () => void
  onUpdateWorkOrder: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null; trade_name: string | undefined }>) => void
  onDeleteWorkOrder: (id: string) => Promise<void>
  onLockWorkOrder: (id: string) => Promise<void>
  onCancelWorkOrder: (id: string) => void
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
  onClaimScopeItem: (scopeItemId: string, workOrderId: string) => Promise<void>
  onAddWorkOrderForTrade: (quoteId: string, tradeName: string) => Promise<void>
  onRefresh: () => void
}

export function BottomPanel({
  workOrders,
  scopeItems,
  quotes,
  trades,
  tradeTypes,
  jobId,
  tenantId,
  onAddToQuote,
  onAddAdditional,
  onUpdateWorkOrder,
  onDeleteWorkOrder,
  onLockWorkOrder,
  onCancelWorkOrder,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
  onClaimScopeItem,
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
  const unallocatedItems = getUnallocatedScopeItems(scopeItems, workOrders)

  function quoteTotal(quoteId: string) {
    return quotedWOs.filter(wo => wo.quote_id === quoteId).reduce((s, wo) => s + wo.quotedAllowance, 0)
  }

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--line-strong)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', height: 'auto', transition: 'height .2s ease' }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', padding: '7px 20px', background: '#ede9e3', borderBottom: '1px solid var(--line-strong)', cursor: 'pointer', gap: 9, userSelect: 'none', flexShrink: 0 }}
      >
        <span style={{ fontSize: 9, color: 'var(--subtle-2)' }}>{open ? '▲' : '▼'}</span>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--body-soft)', flex: 1 }}>
          All work orders — by quote
        </span>
        <span style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: 'var(--subtle-2)' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line-4)', gap: 8, position: 'sticky', top: 0, zIndex: 4 }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--ink)', color: 'var(--paper)', letterSpacing: '.03em' }}>
                    {quote.quote_ref ?? `Q-${quote.id.slice(0, 8)}`}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--subtle-2)' }}>
                    {aud.format(quoteTotal(quote.id))} ex GST · {qWOs.length} orders
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleSyncFromQuote}
                      disabled={syncing}
                      style={{ padding: '2px 9px', fontSize: 10, fontFamily: 'DM Sans, sans-serif', border: '1px solid var(--line-strong)', borderRadius: 4, background: 'var(--paper)', color: 'var(--subtle-2)', cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1 }}
                      onMouseEnter={e => { if (syncing) return; const t = e.target as HTMLElement; t.style.background = 'var(--ink)'; t.style.color = 'var(--paper)'; t.style.borderColor = 'var(--ink)' }}
                      onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = 'var(--paper)'; t.style.color = 'var(--subtle-2)'; t.style.borderColor = 'var(--line-strong)' }}
                    >
                      {syncing ? 'Syncing…' : '↻ Sync from quote'}
                    </button>
                    <button
                      onClick={() => onAddToQuote(quote.id)}
                      style={{ padding: '2px 9px', fontSize: 10, fontFamily: 'DM Sans, sans-serif', border: '1px solid var(--line-strong)', borderRadius: 4, background: 'var(--paper)', color: 'var(--subtle-2)', cursor: 'pointer' }}
                      onMouseEnter={e => { const t = e.target as HTMLElement; t.style.background = 'var(--ink)'; t.style.color = 'var(--paper)'; t.style.borderColor = 'var(--ink)' }}
                      onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = 'var(--paper)'; t.style.color = 'var(--subtle-2)'; t.style.borderColor = 'var(--line-strong)' }}
                    >
                      + Add to quote
                    </button>
                  </div>
                </div>
                {qWOs.length > 0 ? (
                  <WOTable
                    workOrders={qWOs}
                    trades={trades}
                    tradeTypes={tradeTypes}
                    unallocatedItems={unallocatedItems}
                    onUpdate={onUpdateWorkOrder}
                    onDelete={onDeleteWorkOrder}
                    onLock={onLockWorkOrder}
                    onCancel={onCancelWorkOrder}
                    onUpdateScopeItem={onUpdateScopeItem}
                    onSoftDeleteScopeItem={onSoftDeleteScopeItem}
                    onCreateScopeItem={onCreateScopeItem}
                    onClaimScopeItem={onClaimScopeItem}
                  />
                ) : (
                  <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--subtle-2)' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line-4)', gap: 8, position: 'sticky', top: 0, zIndex: 4 }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'transparent', border: '1px solid var(--line-strong)', color: 'var(--body-soft)', letterSpacing: '.03em' }}>
                Additional works
              </span>
              <span style={{ fontSize: 10, color: 'var(--subtle-2)' }}>Make safes · Specialist reports · Non-quoted</span>
              <button
                onClick={onAddAdditional}
                style={{ marginLeft: 'auto', padding: '2px 9px', fontSize: 10, fontFamily: 'DM Sans, sans-serif', border: '1px solid var(--line-strong)', borderRadius: 4, background: 'var(--paper)', color: 'var(--subtle-2)', cursor: 'pointer' }}
                onMouseEnter={e => { const t = e.target as HTMLElement; t.style.background = 'var(--ink)'; t.style.color = 'var(--paper)'; t.style.borderColor = 'var(--ink)' }}
                onMouseLeave={e => { const t = e.target as HTMLElement; t.style.background = 'var(--paper)'; t.style.color = 'var(--subtle-2)'; t.style.borderColor = 'var(--line-strong)' }}
              >
                + Add
              </button>
            </div>
            {additionalWOs.length > 0 ? (
              <WOTable
                workOrders={additionalWOs}
                trades={trades}
                tradeTypes={tradeTypes}
                unallocatedItems={unallocatedItems}
                onUpdate={onUpdateWorkOrder}
                onDelete={onDeleteWorkOrder}
                onLock={onLockWorkOrder}
                onCancel={onCancelWorkOrder}
                onUpdateScopeItem={onUpdateScopeItem}
                onSoftDeleteScopeItem={onSoftDeleteScopeItem}
                onCreateScopeItem={onCreateScopeItem}
                onClaimScopeItem={onClaimScopeItem}
              />
            ) : (
              <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--subtle-2)' }}>
                No additional work orders yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
