'use client'

import React, { useState } from 'react'
import { formatEstHours } from '@/lib/utils'
import {
  type WorkOrderWithDetails,
  type QuoteRow,
  type TradeRow,
  type ScopeItemRow,
  getTradeColor,
  garyLabel,
  aud,
  INVOICE_CHAIN_STEPS,
  woIsSent,
  getDeletedScopeItemIds,
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
  const activeIdx = INVOICE_CHAIN_STEPS.findIndex(s => s.key === extStatus)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {INVOICE_CHAIN_STEPS.map((step, i) => {
        const isDone = i < activeIdx
        const isCur  = i === activeIdx
        return (
          <React.Fragment key={step.key}>
            {i > 0 && <span style={{ color: '#ddd8d0', margin: '0 1px', fontSize: 9 }}>›</span>}
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: isDone ? '#eaf4ef' : isCur ? '#fef3e2' : '#ede9e3', color: isDone ? '#2d6a4f' : isCur ? '#92400e' : '#9a9590', fontWeight: isCur ? 600 : 400, whiteSpace: 'nowrap' }}>
              {step.label}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Scope item editor ─────────────────────────────────────────────────────────

type ScopeItemData = { item_description: string; qty: number; rate_labour: number; rate_materials: number; line_total: number }

function EditCell({
  value,
  type = 'text',
  width,
  isModified,
  isDeleted,
  onSave,
}: {
  value: string
  type?: 'text' | 'number'
  width?: number
  isModified: boolean
  isDeleted: boolean
  onSave: (val: string) => void
}) {
  const [local, setLocal] = useState(value)

  React.useEffect(() => { setLocal(value) }, [value])

  const bg = isDeleted ? 'transparent' : isModified ? '#fef3e2' : '#fff'
  const border = isDeleted ? '1px solid transparent' : isModified ? '1px solid #fcd38d' : '1px solid #e8e4de'

  return (
    <input
      type={type}
      value={local}
      disabled={isDeleted}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onSave(local)
      }}
      style={{
        fontFamily: type === 'number' ? 'DM Mono, monospace' : 'DM Sans, sans-serif',
        fontSize: 10,
        padding: '3px 6px',
        borderRadius: 4,
        border,
        background: bg,
        color: isDeleted ? '#9a9590' : '#1a1a1a',
        width: width ? `${width}px` : '100%',
        textDecoration: isDeleted ? 'line-through' : 'none',
        outline: 'none',
      }}
    />
  )
}

function ScopeItemEditRow({
  item,
  index,
  isDeleted,
  isNew,
  modifiedFields,
  onUpdate,
  onToggleDelete,
}: {
  item: ScopeItemRow
  index: number
  isDeleted: boolean
  isNew: boolean
  modifiedFields: Set<string>
  onUpdate: (updates: Partial<ScopeItemRow>, changedField: string) => void
  onToggleDelete: () => void
}) {
  const rowBg = isDeleted ? '#fff0f0' : isNew ? '#f0fdf4' : 'transparent'

  return (
    <tr style={{ background: rowBg }}>
      {/* Index */}
      <td style={{ width: 28, padding: '4px 6px', fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9a9590', textAlign: 'center', textDecoration: isDeleted ? 'line-through' : 'none' }}>
        {index + 1}
      </td>

      {/* Description */}
      <td style={{ padding: '4px 6px', minWidth: 160 }}>
        <EditCell
          value={item.item_description ?? ''}
          isModified={modifiedFields.has('item_description')}
          isDeleted={isDeleted}
          onSave={v => onUpdate({ item_description: v }, 'item_description')}
        />
      </td>

      {/* Qty */}
      <td style={{ padding: '4px 6px', width: 70 }}>
        <EditCell
          value={String(item.qty ?? '')}
          type="number"
          width={60}
          isModified={modifiedFields.has('qty')}
          isDeleted={isDeleted}
          onSave={v => onUpdate({ qty: parseFloat(v) || 0 }, 'qty')}
        />
      </td>

      {/* Labour Rate */}
      <td style={{ padding: '4px 6px', width: 100 }}>
        <EditCell
          value={String(item.rate_labour ?? '')}
          type="number"
          width={88}
          isModified={modifiedFields.has('rate_labour')}
          isDeleted={isDeleted}
          onSave={v => onUpdate({ rate_labour: parseFloat(v) || 0 }, 'rate_labour')}
        />
      </td>

      {/* Material Rate */}
      <td style={{ padding: '4px 6px', width: 110 }}>
        <EditCell
          value={String(item.rate_materials ?? '')}
          type="number"
          width={96}
          isModified={modifiedFields.has('rate_materials')}
          isDeleted={isDeleted}
          onSave={v => onUpdate({ rate_materials: parseFloat(v) || 0 }, 'rate_materials')}
        />
      </td>

      {/* Subtotal */}
      <td style={{ padding: '4px 6px', width: 100 }}>
        <EditCell
          value={String(item.line_total ?? '')}
          type="number"
          width={88}
          isModified={modifiedFields.has('line_total')}
          isDeleted={isDeleted}
          onSave={v => onUpdate({ line_total: parseFloat(v) || 0 }, 'line_total')}
        />
      </td>

      {/* Tags */}
      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
        {isDeleted && (
          <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
            Removed
          </span>
        )}
        {isNew && !isDeleted && (
          <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>
            New
          </span>
        )}
        {!isNew && !isDeleted && modifiedFields.size > 0 && (
          <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#fef3e2', color: '#92400e', border: '1px solid #fcd38d' }}>
            Modified
          </span>
        )}
      </td>

      {/* Delete toggle */}
      <td style={{ padding: '4px 6px', width: 36, textAlign: 'center' }}>
        <button
          onClick={onToggleDelete}
          title={isDeleted ? 'Restore item' : 'Remove item'}
          style={{
            fontSize: 12,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: isDeleted ? '#2d6a4f' : '#991b1b',
            padding: '2px 4px',
            borderRadius: 3,
            lineHeight: 1,
          }}
        >
          {isDeleted ? '↩' : '×'}
        </button>
      </td>
    </tr>
  )
}

function NewItemRow({
  tradeLabel,
  onAdd,
}: {
  tradeLabel: string
  onAdd: (data: ScopeItemData) => void
}) {
  const blank = { item_description: '', qty: 1, rate_labour: 0, rate_materials: 0, line_total: 0 }
  const [form, setForm] = useState<ScopeItemData>(blank)

  function field<K extends keyof ScopeItemData>(key: K, val: string) {
    setForm(prev => ({ ...prev, [key]: key === 'item_description' ? val : parseFloat(val) || 0 }))
  }

  function handleAdd() {
    if (!form.item_description.trim()) return
    onAdd(form)
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
      <td style={{ padding: '4px 6px', width: 70 }}>
        <input type="number" value={form.qty} onChange={e => field('qty', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 60 }} />
      </td>
      <td style={{ padding: '4px 6px', width: 100 }}>
        <input type="number" value={form.rate_labour} onChange={e => field('rate_labour', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 88 }} />
      </td>
      <td style={{ padding: '4px 6px', width: 110 }}>
        <input type="number" value={form.rate_materials} onChange={e => field('rate_materials', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 96 }} />
      </td>
      <td style={{ padding: '4px 6px', width: 100 }}>
        <input type="number" value={form.line_total} onChange={e => field('line_total', e.target.value)} style={{ ...inputStyle, fontFamily: 'DM Mono, monospace', width: 88 }} />
      </td>
      <td style={{ padding: '4px 8px' }} />
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
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
}: {
  wo: WorkOrderWithDetails
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
}) {
  const [newItemIds,     setNewItemIds]     = useState<Set<string>>(new Set())
  const [modifiedFields, setModifiedFields] = useState<Map<string, Set<string>>>(new Map())

  const deletedIds = new Set(getDeletedScopeItemIds(wo.notes))

  function markModified(itemId: string, field: string) {
    setModifiedFields(prev => {
      const next = new Map(prev)
      const fields = new Set(next.get(itemId) ?? [])
      fields.add(field)
      next.set(itemId, fields)
      return next
    })
  }

  async function handleUpdate(itemId: string, updates: Partial<ScopeItemRow>, changedField: string) {
    markModified(itemId, changedField)
    await onUpdateScopeItem(itemId, updates)
  }

  async function handleCreate(data: ScopeItemData) {
    if (!wo.quote_id) return
    const newId = await onCreateScopeItem(wo.quote_id, wo.tradeTypeLabel, wo.id, data)
    if (newId) {
      setNewItemIds(prev => new Set([...prev, newId]))
    }
  }

  const items = wo.scopeItems

  if (items.length === 0 && !wo.quote_id) {
    return (
      <div style={{ padding: '12px 20px', fontSize: 11, color: '#9a9590', background: '#faf8f5' }}>
        This work order has no scope items (additional/make-safe work).
      </div>
    )
  }

  return (
    <div style={{ background: '#faf8f5', borderTop: '1px solid #e8e4de', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={SCOPE_TH}>#</th>
            <th style={{ ...SCOPE_TH, minWidth: 160 }}>Description</th>
            <th style={SCOPE_TH}>Qty</th>
            <th style={SCOPE_TH}>Labour Rate</th>
            <th style={SCOPE_TH}>Material Rate</th>
            <th style={SCOPE_TH}>Subtotal</th>
            <th style={SCOPE_TH}>Status</th>
            <th style={SCOPE_TH} />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <ScopeItemEditRow
              key={item.id}
              item={item}
              index={i}
              isDeleted={deletedIds.has(item.id)}
              isNew={newItemIds.has(item.id)}
              modifiedFields={modifiedFields.get(item.id) ?? new Set()}
              onUpdate={(updates, field) => handleUpdate(item.id, updates, field)}
              onToggleDelete={() => onSoftDeleteScopeItem(wo.id, item.id)}
            />
          ))}
          {wo.quote_id && (
            <NewItemRow tradeLabel={wo.tradeTypeLabel} onAdd={handleCreate} />
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
  allPlaced,
  trades,
  onUpdate,
  onDelete,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
}: {
  wo: WorkOrderWithDetails
  allPlaced: WorkOrderWithDetails[]
  trades: TradeRow[]
  onUpdate: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null }>) => void
  onDelete: (id: string) => void
  onUpdateScopeItem: (itemId: string, updates: Partial<ScopeItemRow>) => Promise<void>
  onSoftDeleteScopeItem: (workOrderId: string, scopeItemId: string) => Promise<void>
  onCreateScopeItem: (quoteId: string, tradeLabel: string, workOrderId: string, data: ScopeItemData) => Promise<string | null>
}) {
  const [expanded,         setExpanded]         = useState(false)
  const [localTradeId,     setLocalTradeId]      = React.useState(wo.trade_id || '')
  const [localAgreedAmt,   setLocalAgreedAmt]    = React.useState(wo.agreed_amount?.toString() || '')

  const color   = getTradeColor(wo.tradeTypeLabel)
  const predWo  = wo.predecessor_work_order_id
    ? allPlaced.find(p => p.id === wo.predecessor_work_order_id)
    : null

  const xeroStyle =
    wo.invoice?.xero_sync_status === 'synced'
      ? { bg: '#eaf4ef', color: '#2d6a4f', border: '#a7d4bc', label: 'Synced' }
      : { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'Pending' }

  const isEditable = wo.status === 'pending'
  const tradeType = wo.work_type === 'make_safe' ? 'make_safe' : wo.tradeTypeLabel
  const eligibleTrades = trades.filter(t => t.primary_trade === tradeType || t.primary_trade === tradeType.toLowerCase())

  React.useEffect(() => {
    setLocalTradeId(wo.trade_id || '')
    setLocalAgreedAmt(wo.agreed_amount?.toString() || '')
  }, [wo.trade_id, wo.agreed_amount])

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
        <td style={{ ...TD, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 5, verticalAlign: 'middle' }} />
          {wo.tradeTypeLabel || wo.work_type}
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
            <input
              type="number"
              value={localAgreedAmt}
              onChange={e => setLocalAgreedAmt(e.target.value)}
              onBlur={() => {
                const newValue = localAgreedAmt ? parseFloat(localAgreedAmt) : null
                if (newValue !== wo.agreed_amount) onUpdate(wo.id, { agreed_amount: newValue })
              }}
              placeholder="0"
              style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 4px', borderRadius: 4, border: '1px solid #ddd8d0', background: '#fff', color: '#1a1a1a', width: 80 }}
            />
          ) : (
            wo.agreed_amount ? aud.format(wo.agreed_amount) : '—'
          )}
        </td>

        {/* Trade cost */}
        <td style={{ ...MONO }}>{wo.trade_cost ? aud.format(wo.trade_cost) : '—'}</td>

        {/* Invoice chain */}
        <td style={{ ...TD }}>
          <InvoiceChain extStatus={woIsSent(wo) ? (wo.invoice?.external_status ?? 'sent_awaiting_invoice') : null} />
        </td>

        {/* Depends on */}
        <td style={{ ...TD, fontSize: 10, color: '#5a5650', whiteSpace: 'nowrap' }}>
          {predWo ? `${predWo.tradeTypeLabel || predWo.work_type} · ${predWo.trade?.business_name?.split(' ')[0] ?? '?'}` : '—'}
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

        {/* Delete WO */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
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
        </td>
      </tr>

      {/* Expanded scope editor */}
      {expanded && (
        <tr>
          <td colSpan={16} style={{ padding: 0, borderBottom: '1px solid #e8e4de' }}>
            <ScopeItemsEditor
              wo={wo}
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
  allWorkOrders,
  trades,
  onUpdate,
  onDelete,
  onUpdateScopeItem,
  onSoftDeleteScopeItem,
  onCreateScopeItem,
}: {
  workOrders: WorkOrderWithDetails[]
  allWorkOrders: WorkOrderWithDetails[]
  trades: TradeRow[]
  onUpdate: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null }>) => void
  onDelete: (id: string) => void
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
          <th style={TH}>Depends on</th>
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
            allPlaced={allWorkOrders}
            trades={trades}
            onUpdate={onUpdate}
            onDelete={onDelete}
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
  onUpdateWorkOrder: (id: string, updates: Partial<{ trade_id: string | undefined; agreed_amount: number | null }>) => void
  onDeleteWorkOrder: (id: string) => Promise<void>
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
    return quotedWOs.filter(wo => wo.quote_id === quoteId).reduce((s, wo) => s + (wo.quotedAllowance || wo.agreed_amount || 0), 0)
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
                    allWorkOrders={workOrders}
                    trades={trades}
                    onUpdate={onUpdateWorkOrder}
                    onDelete={onDeleteWorkOrder}
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
                allWorkOrders={workOrders}
                trades={trades}
                onUpdate={onUpdateWorkOrder}
                onDelete={onDeleteWorkOrder}
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
