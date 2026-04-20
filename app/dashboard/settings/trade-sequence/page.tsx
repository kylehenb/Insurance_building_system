'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface TradeTypeSequence {
  id: string
  tenant_id: string
  trade_type: string
  typical_sequence_order: number | null
  typical_visit_count: number
  notes: string | null
  typical_depends_on: string[]
  typical_comes_before: string[]
  typically_paired_with: string[]
  can_run_concurrent_with: string[]
  cant_run_concurrent_with: string[]
  typical_lag_days: number
  lag_description: string | null
  updated_at: string
  created_at: string
}

export default function TradeSequencePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [rows, setRows] = useState<TradeTypeSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Effect 1: get session
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }
      setUserId(session.user.id)
    }
    getSession()
  }, [router])

  // Effect 2: fetch data once userId is set
  useEffect(() => {
    if (!userId) return
    
    const fetchData = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/settings/trade-sequence')
        if (!response.ok) throw new Error('Failed to fetch')
        const data = await response.json()
        setRows(data)
      } catch (error) {
        console.error('Error fetching trade sequence:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [userId])

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (dropIndex: number) => {
    if (draggedIndex === null || draggedIndex === dropIndex) return
    
    const newRows = [...rows]
    const [draggedRow] = newRows.splice(draggedIndex, 1)
    newRows.splice(dropIndex, 0, draggedRow)
    
    // Recalculate typical_sequence_order as position × 10
    const reorderedRows = newRows.map((row, index) => ({
      ...row,
      typical_sequence_order: (index + 1) * 10
    }))
    
    setRows(reorderedRows)
    setDraggedIndex(null)
  }

  const updateRow = (index: number, field: keyof TradeTypeSequence, value: any) => {
    setRows(prev => prev.map((row, i) => 
      i === index ? { ...row, [field]: value } : row
    ))
  }

  const toggleArrayField = (index: number, field: keyof TradeTypeSequence, tradeType: string) => {
    const row = rows[index]
    const currentArray = (row[field] as string[]) || []
    const newArray = currentArray.includes(tradeType)
      ? currentArray.filter(t => t !== tradeType)
      : [...currentArray, tradeType]
    updateRow(index, field, newArray)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings/trade-sequence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      })
      
      if (!response.ok) throw new Error('Failed to save')
      
      setToast({ type: 'success', message: 'Trade sequence saved' })
      setTimeout(() => setToast(null), 3000)
    } catch (error) {
      console.error('Error saving trade sequence:', error)
      setToast({ type: 'error', message: 'Failed to save trade sequence' })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const allTradeTypes = rows.map(r => r.trade_type)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f5f2ee]">
        <div className="text-[#9e998f]">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] pb-24">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-[#1a1a1a] mb-2">Trade Type Sequence</h1>
          <p className="text-[#9e998f] mb-4">
            Define the default sequence and scheduling hints for each trade type. Used by the AI when drafting repair schedule blueprints.
          </p>
          <div className="bg-[#fff8ed] border border-[#c9a96e] rounded px-4 py-3">
            <p className="text-sm text-[#1a1a1a]">
              <span className="font-semibold">Typically</span> — These settings provide guidance to the AI for generating job blueprints. They are typical patterns, not hard-coded rules. The AI may deviate based on job-specific requirements.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {rows.map((row, index) => (
            <div
              key={row.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(index)}
              className={`bg-white border border-[#e8e4e0] rounded-lg p-5 transition-opacity ${
                draggedIndex === index ? 'opacity-50' : ''
              } ${draggedIndex !== null && draggedIndex !== index ? 'border-[#c9a96e]' : ''}`}
            >
              {/* Header row */}
              <div className="flex items-center gap-4 mb-4 pb-4 border-b border-[#e8e4e0]">
                {/* Drag handle */}
                <div className="text-[#b0a89e] cursor-grab text-xl">⠿</div>

                {/* Trade type name (read-only) */}
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">Trade type</div>
                  <div className="font-mono text-lg text-[#1a1a1a]">{row.trade_type}</div>
                </div>

                {/* Visits */}
                <div className="w-[100px]">
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">Typical visits</div>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={row.typical_visit_count}
                    onChange={(e) => updateRow(index, 'typical_visit_count', parseInt(e.target.value) || 1)}
                    className="w-full border border-[#e8e4e0] rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                  />
                </div>

                {/* Lag days */}
                <div className="w-[80px]">
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">Lag days</div>
                  <input
                    type="number"
                    min={0}
                    value={row.typical_lag_days}
                    onChange={(e) => updateRow(index, 'typical_lag_days', parseInt(e.target.value) || 0)}
                    className="w-full border border-[#e8e4e0] rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                  />
                </div>

                {/* Lag description */}
                <div className="w-[180px]">
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">Lag description</div>
                  <input
                    type="text"
                    value={row.lag_description || ''}
                    onChange={(e) => updateRow(index, 'lag_description', e.target.value)}
                    placeholder="e.g. drying time"
                    className="w-full border border-[#e8e4e0] rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                  />
                </div>
              </div>

              {/* Relationship fields */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Typically follows */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">Typically follows</div>
                  <MultiSelectTags
                    selected={row.typical_depends_on || []}
                    available={allTradeTypes.filter(t => t !== row.trade_type)}
                    onToggle={(tradeType) => toggleArrayField(index, 'typical_depends_on', tradeType)}
                  />
                </div>

                {/* Typically comes before */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">Typically comes before</div>
                  <MultiSelectTags
                    selected={row.typical_comes_before || []}
                    available={allTradeTypes.filter(t => t !== row.trade_type)}
                    onToggle={(tradeType) => toggleArrayField(index, 'typical_comes_before', tradeType)}
                  />
                </div>

                {/* Typically paired with */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">Typically paired with</div>
                  <div className="text-xs text-[#6b6763] mb-2">Parent/child relationships (e.g., cabinet maker + electrician/plumber)</div>
                  <MultiSelectTags
                    selected={row.typically_paired_with || []}
                    available={allTradeTypes.filter(t => t !== row.trade_type)}
                    onToggle={(tradeType) => toggleArrayField(index, 'typically_paired_with', tradeType)}
                  />
                </div>

                {/* Can run concurrent with */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">Can run concurrent with</div>
                  <MultiSelectTags
                    selected={row.can_run_concurrent_with || []}
                    available={allTradeTypes.filter(t => t !== row.trade_type)}
                    onToggle={(tradeType) => toggleArrayField(index, 'can_run_concurrent_with', tradeType)}
                  />
                </div>

                {/* Can't run concurrent with */}
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">Can't run concurrent with</div>
                  <MultiSelectTags
                    selected={row.cant_run_concurrent_with || []}
                    available={allTradeTypes.filter(t => t !== row.trade_type)}
                    onToggle={(tradeType) => toggleArrayField(index, 'cant_run_concurrent_with', tradeType)}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">Notes</div>
                <input
                  type="text"
                  value={row.notes || ''}
                  onChange={(e) => updateRow(index, 'notes', e.target.value)}
                  className="w-full border border-[#e8e4e0] rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Save button */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e8e4e0] p-4">
          <div className="max-w-6xl mx-auto flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#1a1a1a] text-white px-4 py-2 rounded text-sm hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Toast notification */}
        {toast && (
          <div className={`fixed bottom-20 right-6 px-4 py-2 rounded text-sm ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}>
            {toast.message}
          </div>
        )}
      </div>
    </div>
  )
}

function MultiSelectTags({ selected, available, onToggle }: { selected: string[], available: string[], onToggle: (tradeType: string) => void }) {
  const [open, setOpen] = useState(false)

  const availableNotSelected = available.filter(t => !selected.includes(t))

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected.map((tradeType) => (
        <span
          key={tradeType}
          className="bg-[#f5f2ee] border border-[#e8e4e0] text-[#3a3530] text-xs px-2 py-0.5 rounded font-mono flex items-center gap-1"
        >
          {tradeType}
          <button
            onClick={() => onToggle(tradeType)}
            className="hover:text-[#1a1a1a]"
          >
            ×
          </button>
        </span>
      ))}
      {availableNotSelected.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="text-xs text-[#9e998f] hover:text-[#1a1a1a] underline"
          >
            + Add
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-[#e8e4e0] rounded shadow-lg z-10 max-h-48 overflow-y-auto">
              {availableNotSelected.map((tradeType) => (
                <button
                  key={tradeType}
                  onClick={() => {
                    onToggle(tradeType)
                    setOpen(false)
                  }}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-[#f5f2ee] font-mono whitespace-nowrap"
                >
                  {tradeType}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
