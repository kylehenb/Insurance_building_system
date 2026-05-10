'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface LibraryItem {
  id: string
  tenant_id: string
  invoice_type: string
  description: string
  default_quantity: number | null
  default_unit_price: number | null
  unit: string | null
  sort_order: number | null
  is_active: boolean | null
}

const INVOICE_TYPES = ['make_safe', 'repair', 'general'] as const
type InvoiceType = typeof INVOICE_TYPES[number]

const TYPE_LABELS: Record<InvoiceType, string> = {
  make_safe: 'Make Safe',
  repair: 'Repair',
  general: 'General',
}

const UNIT_OPTIONS = ['ea', 'hr', 'm2', 'lm', 'item', 'day', 'ls']

const IRC_DEFAULTS: Array<Omit<LibraryItem, 'id' | 'tenant_id'>> = [
  { invoice_type: 'make_safe', description: 'Emergency make safe — labour', default_quantity: 2, default_unit_price: 185, unit: 'hr', sort_order: 0, is_active: true },
  { invoice_type: 'make_safe', description: 'Temporary roof tarp', default_quantity: 1, default_unit_price: 450, unit: 'ea', sort_order: 1, is_active: true },
  { invoice_type: 'make_safe', description: 'Temporary boarding up — windows/doors', default_quantity: 1, default_unit_price: 280, unit: 'ea', sort_order: 2, is_active: true },
  { invoice_type: 'make_safe', description: 'Emergency tree removal (small)', default_quantity: 1, default_unit_price: 800, unit: 'ea', sort_order: 3, is_active: true },
  { invoice_type: 'make_safe', description: 'Emergency tree removal (large)', default_quantity: 1, default_unit_price: 1800, unit: 'ea', sort_order: 4, is_active: true },
  { invoice_type: 'make_safe', description: 'Water extraction — labour', default_quantity: 2, default_unit_price: 185, unit: 'hr', sort_order: 5, is_active: true },
  { invoice_type: 'make_safe', description: 'Skip bin hire', default_quantity: 1, default_unit_price: 380, unit: 'ea', sort_order: 6, is_active: true },
  { invoice_type: 'repair', description: 'Project management', default_quantity: 1, default_unit_price: null, unit: 'ls', sort_order: 0, is_active: true },
  { invoice_type: 'repair', description: 'Supervisor attendance', default_quantity: null, default_unit_price: 165, unit: 'hr', sort_order: 1, is_active: true },
]

export default function InvoiceLibraryPage() {
  const router = useRouter()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [editingItem, setEditingItem] = useState<LibraryItem | null>(null)

  // ── Auth bootstrap ────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single()
      if (!profile) { router.push('/login'); return }
      setTenantId((profile as { tenant_id: string }).tenant_id)
    }
    init()
  }, [router])

  // ── Load items ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    try {
      const { data } = await supabase
        .from('invoice_line_item_library')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('invoice_type')
        .order('sort_order')
      setItems((data ?? []) as LibraryItem[])
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    load()
  }, [tenantId, load])

  // ── Seed defaults if empty ────────────────────────────────────────────────

  const seedDefaults = useCallback(async () => {
    if (!tenantId) return
    const { count } = await supabase
      .from('invoice_line_item_library')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if ((count ?? 0) > 0) return

    const toInsert = IRC_DEFAULTS.map(d => ({ ...d, tenant_id: tenantId }))
    await supabase.from('invoice_line_item_library').insert(toInsert)
    load()
  }, [tenantId, load])

  useEffect(() => {
    if (!tenantId || loading) return
    if (items.length === 0) seedDefaults()
  }, [tenantId, loading, items.length, seedDefaults])

  // ── Save item ─────────────────────────────────────────────────────────────

  const saveItem = useCallback(async (item: LibraryItem) => {
    if (!tenantId) return
    setSaving(prev => ({ ...prev, [item.id]: true }))
    try {
      await fetch(`/api/invoice-library/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          description: item.description,
          default_quantity: item.default_quantity,
          default_unit_price: item.default_unit_price,
          unit: item.unit,
          invoice_type: item.invoice_type,
          sort_order: item.sort_order,
          is_active: item.is_active,
        }),
      })
    } finally {
      setSaving(prev => ({ ...prev, [item.id]: false }))
      setEditingItem(null)
    }
  }, [tenantId])

  const updateLocal = (id: string, field: keyof LibraryItem, value: string | number | boolean | null) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
    setEditingItem(prev => prev?.id === id ? { ...prev, [field]: value } : prev)
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  const toggleActive = useCallback(async (item: LibraryItem) => {
    if (!tenantId) return
    const updated = { ...item, is_active: !item.is_active }
    setItems(prev => prev.map(i => i.id === item.id ? updated : i))
    await fetch(`/api/invoice-library/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, is_active: updated.is_active }),
    })
  }, [tenantId])

  // ── Add new item ──────────────────────────────────────────────────────────

  const addItem = useCallback(async (invoiceType: InvoiceType) => {
    if (!tenantId) return
    const res = await fetch('/api/invoice-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        invoice_type: invoiceType,
        description: 'New item',
        default_quantity: 1,
        sort_order: items.filter(i => i.invoice_type === invoiceType).length,
      }),
    })
    if (res.ok) {
      const newItem: LibraryItem = await res.json()
      setItems(prev => [...prev, newItem])
      setEditingItem(newItem)
    }
  }, [tenantId, items])

  const grouped = INVOICE_TYPES.reduce<Record<InvoiceType, LibraryItem[]>>((acc, t) => {
    acc[t] = items.filter(i => i.invoice_type === t)
    return acc
  }, { make_safe: [], repair: [], general: [] })

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#9e998f' }}>
        Loading…
      </div>
    )
  }

  return (
    <>
      <style>{`
        .il { padding: 32px 36px 48px; font-family: 'DM Sans', sans-serif; color: #3a3530; }
        .il-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
        .il-title { font-size: 20px; font-weight: 700; color: #1a1a1a; }
        .il-sub { font-size: 13px; color: #9e998f; margin-bottom: 28px; }
        .il-group { margin-bottom: 32px; }
        .il-group-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .il-group-title { font-size: 13px; font-weight: 600; color: #3a3530; }
        .il-add-btn { font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; background: #fff; color: #3a3530; border: 1px solid #e0dbd4; }
        .il-add-btn:hover { border-color: #c8b89a; }
        .il-table-wrap { background: #fff; border: 1px solid #e0dbd4; border-radius: 8px; overflow: hidden; }
        .il-table { width: 100%; border-collapse: collapse; }
        .il-table th { font-size: 11px; font-weight: 600; color: #9e998f; text-align: left; padding: 10px 12px; border-bottom: 1px solid #e0dbd4; background: #fafaf8; }
        .il-table td { font-size: 13px; color: #3a3530; padding: 10px 12px; border-bottom: 1px solid #f0ece6; vertical-align: middle; }
        .il-table tr:last-child td { border-bottom: none; }
        .il-input { font-size: 13px; color: #3a3530; background: #f5f2ee; border: 1px solid #e0dbd4; border-radius: 4px; padding: 5px 8px; font-family: 'DM Sans', sans-serif; width: 100%; }
        .il-input:focus { outline: none; border-color: #c8b89a; }
        .il-num-input { font-size: 13px; color: #3a3530; background: #f5f2ee; border: 1px solid #e0dbd4; border-radius: 4px; padding: 5px 8px; font-family: 'DM Mono', monospace; width: 80px; text-align: right; }
        .il-num-input:focus { outline: none; border-color: #c8b89a; }
        .il-select { font-size: 13px; color: #3a3530; background: #f5f2ee; border: 1px solid #e0dbd4; border-radius: 4px; padding: 5px 8px; font-family: 'DM Sans', sans-serif; }
        .il-select:focus { outline: none; border-color: #c8b89a; }
        .il-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
        .il-save-btn { font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; background: #3a3530; color: #fff; border: none; }
        .il-save-btn:hover { background: #2a2520; }
        .il-inactive { opacity: 0.5; }
      `}</style>

      <div className="il">
        <div className="il-header">
          <span className="il-title">Invoice Line Item Library</span>
        </div>
        <p className="il-sub">
          Shared line items for quick-adding to make safe, repair, and general invoices. Changes apply to all future invoices.
        </p>

        {INVOICE_TYPES.map(type => (
          <div key={type} className="il-group">
            <div className="il-group-header">
              <span className="il-group-title">{TYPE_LABELS[type]}</span>
              <button className="il-add-btn" onClick={() => addItem(type)}>+ Add item</button>
            </div>
            <div className="il-table-wrap">
              {grouped[type].length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 13, color: '#9e998f' }}>
                  No items — click &quot;Add item&quot; to create one.
                </div>
              ) : (
                <table className="il-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th style={{ width: 80 }}>Default Qty</th>
                      <th style={{ width: 110 }}>Default Price</th>
                      <th style={{ width: 80 }}>Unit</th>
                      <th style={{ width: 70 }}>Sort</th>
                      <th style={{ width: 70 }}>Active</th>
                      <th style={{ width: 70 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[type].map(item => {
                      const isEditing = editingItem?.id === item.id
                      const isSaving = saving[item.id]
                      return (
                        <tr key={item.id} className={item.is_active ? '' : 'il-inactive'}>
                          <td>
                            <input
                              className="il-input"
                              value={isEditing ? (editingItem?.description ?? item.description) : item.description}
                              onFocus={() => setEditingItem(item)}
                              onChange={e => updateLocal(item.id, 'description', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="il-num-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={isEditing ? (editingItem?.default_quantity ?? '') : (item.default_quantity ?? '')}
                              onFocus={() => setEditingItem(item)}
                              onChange={e => updateLocal(item.id, 'default_quantity', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <input
                              className="il-num-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={isEditing ? (editingItem?.default_unit_price ?? '') : (item.default_unit_price ?? '')}
                              onFocus={() => setEditingItem(item)}
                              onChange={e => updateLocal(item.id, 'default_unit_price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <select
                              className="il-select"
                              value={isEditing ? (editingItem?.unit ?? '') : (item.unit ?? '')}
                              onFocus={() => setEditingItem(item)}
                              onChange={e => updateLocal(item.id, 'unit', e.target.value || null)}
                            >
                              <option value="">—</option>
                              {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td>
                            <input
                              className="il-num-input"
                              type="number"
                              min="0"
                              style={{ width: 50 }}
                              value={isEditing ? (editingItem?.sort_order ?? 0) : (item.sort_order ?? 0)}
                              onFocus={() => setEditingItem(item)}
                              onChange={e => updateLocal(item.id, 'sort_order', parseInt(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <label className="il-toggle">
                              <input
                                type="checkbox"
                                checked={item.is_active ?? true}
                                onChange={() => toggleActive(item)}
                              />
                              <span style={{ fontSize: 12, color: '#9e998f' }}>{item.is_active ? 'Yes' : 'No'}</span>
                            </label>
                          </td>
                          <td>
                            {isEditing && (
                              <button
                                className="il-save-btn"
                                disabled={isSaving}
                                onClick={() => saveItem(editingItem!)}
                              >
                                {isSaving ? '…' : 'Save'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
