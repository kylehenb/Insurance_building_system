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

interface RowEditState {
  dirty: boolean
  saving: boolean
  saved: boolean
  error: string | null
}

export default function TradeSequencePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [rows, setRows] = useState<TradeTypeSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [editStates, setEditStates] = useState<Record<string, RowEditState>>({})
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

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
        // Initialize edit states
        const initialEditStates: Record<string, RowEditState> = {}
        data.forEach((row: TradeTypeSequence) => {
          initialEditStates[row.id] = { dirty: false, saving: false, saved: false, error: null }
        })
        setEditStates(initialEditStates)
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
    // Mark as dirty
    setEditStates(prev => ({
      ...prev,
      [rows[index].id]: { ...prev[rows[index].id], dirty: true, saved: false, error: null }
    }))
  }

  const toggleArrayField = (index: number, field: keyof TradeTypeSequence, tradeType: string) => {
    const row = rows[index]
    const currentArray = (row[field] as string[]) || []
    const newArray = currentArray.includes(tradeType)
      ? currentArray.filter(t => t !== tradeType)
      : [...currentArray, tradeType]
    updateRow(index, field, newArray)
  }

  const handleSaveRow = async (index: number) => {
    const row = rows[index]
    setEditStates(prev => ({
      ...prev,
      [row.id]: { ...prev[row.id], saving: true, error: null }
    }))

    try {
      const response = await fetch('/api/settings/trade-sequence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([row]),
      })
      
      if (!response.ok) throw new Error('Save failed')
      
      setEditStates(prev => ({
        ...prev,
        [row.id]: { ...prev[row.id], saving: false, saved: true, error: null }
      }))

      // Clear saved confirmation after 2 seconds
      setTimeout(() => {
        setEditStates(prev => ({
          ...prev,
          [row.id]: { ...prev[row.id], saved: false }
        }))
      }, 2000)
    } catch (error) {
      setEditStates(prev => ({
        ...prev,
        [row.id]: { ...prev[row.id], saving: false, saved: false, error: 'Save failed — please try again.' }
      }))
    }
  }

  const allTradeTypes = rows.map(r => r.trade_type)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f2ee] p-8">
        <div className="max-w-5xl mx-auto">
          <div className="h-8 bg-[#e8e4e0] rounded w-48 mb-2"></div>
          <div className="h-4 bg-[#e8e4e0] rounded w-96 mb-6"></div>
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-[#e8e4e0] rounded-lg p-4 mb-3">
              <div className="h-5 bg-[#e8e4e0] rounded w-48 mb-3"></div>
              <div className="flex gap-4">
                <div className="h-8 bg-[#fafaf9] border border-[#e8e4e0] rounded w-20"></div>
                <div className="h-8 bg-[#fafaf9] border border-[#e8e4e0] rounded w-16"></div>
                <div className="h-8 bg-[#fafaf9] border border-[#e8e4e0] rounded w-32"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">Trade Type Sequence</h1>
          <p className="text-sm text-[#9e998f] mt-1">
            Define the default sequence and scheduling hints for each trade type. Used by the AI when drafting repair schedule blueprints.
          </p>
          <div className="bg-[#fff8ed] border border-[#c9a96e] rounded px-4 py-3 mt-4">
            <p className="text-sm text-[#1a1a1a]">
              <span className="font-semibold">Typically</span> — These settings provide guidance to the AI for generating job blueprints. They are typical patterns, not hard-coded rules. The AI may deviate based on job-specific requirements.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {rows.map((row, index) => {
            const editState = editStates[row.id] || { dirty: false, saving: false, saved: false, error: null }
            
            return (
              <div
                key={row.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(index)}
                className="bg-white border border-[#e8e4e0] rounded-lg p-5 transition-opacity cursor-move hover:border-[#c9a96e]"
              >
                {/* Header row */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-[#b0a89e] text-lg cursor-grab">⠿</div>
                  <div className="font-mono text-lg font-semibold text-[#1a1a1a]">{row.trade_type}</div>
                  <div className="text-xs text-[#9e998f] ml-auto">
                    Order: {index + 1}
                  </div>
                </div>

                {/* Fields grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  {/* Visits */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Typical visits
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={row.typical_visit_count}
                      onChange={(e) => updateRow(index, 'typical_visit_count', parseInt(e.target.value) || 1)}
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#c9a96e]"
                    />
                  </div>

                  {/* Lag days */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Lag days
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={row.typical_lag_days}
                      onChange={(e) => updateRow(index, 'typical_lag_days', parseInt(e.target.value) || 0)}
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#c9a96e]"
                    />
                  </div>

                  {/* Lag description */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Lag description
                    </label>
                    <input
                      type="text"
                      value={row.lag_description || ''}
                      onChange={(e) => updateRow(index, 'lag_description', e.target.value)}
                      placeholder="e.g. drying time"
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#c9a96e]"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Notes
                    </label>
                    <input
                      type="text"
                      value={row.notes || ''}
                      onChange={(e) => updateRow(index, 'notes', e.target.value)}
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#c9a96e]"
                    />
                  </div>
                </div>

                {/* Relationship fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Typically follows
                    </label>
                    <CompactMultiSelect
                      selected={row.typical_depends_on || []}
                      available={allTradeTypes.filter(t => t !== row.trade_type)}
                      onToggle={(tradeType) => toggleArrayField(index, 'typical_depends_on', tradeType)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Typically comes before
                    </label>
                    <CompactMultiSelect
                      selected={row.typical_comes_before || []}
                      available={allTradeTypes.filter(t => t !== row.trade_type)}
                      onToggle={(tradeType) => toggleArrayField(index, 'typical_comes_before', tradeType)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Typically paired with
                    </label>
                    <div className="text-xs text-[#6b6763] mb-1.5">Parent/child relationships (e.g., cabinet maker + electrician)</div>
                    <CompactMultiSelect
                      selected={row.typically_paired_with || []}
                      available={allTradeTypes.filter(t => t !== row.trade_type)}
                      onToggle={(tradeType) => toggleArrayField(index, 'typically_paired_with', tradeType)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Can run concurrent with
                    </label>
                    <CompactMultiSelect
                      selected={row.can_run_concurrent_with || []}
                      available={allTradeTypes.filter(t => t !== row.trade_type)}
                      onToggle={(tradeType) => toggleArrayField(index, 'can_run_concurrent_with', tradeType)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5">
                      Can't run concurrent with
                    </label>
                    <CompactMultiSelect
                      selected={row.cant_run_concurrent_with || []}
                      available={allTradeTypes.filter(t => t !== row.trade_type)}
                      onToggle={(tradeType) => toggleArrayField(index, 'cant_run_concurrent_with', tradeType)}
                    />
                  </div>
                </div>

                {/* Action row */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e8e4e0]">
                  {editState.error && (
                    <span className="text-xs text-red-600">{editState.error}</span>
                  )}
                  {editState.saved && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved
                    </span>
                  )}
                  <button
                    onClick={() => handleSaveRow(index)}
                    disabled={!editState.dirty || editState.saving}
                    className="px-4 py-2 text-sm bg-[#c9a96e] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#b8985e] transition-colors"
                  >
                    {editState.saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CompactMultiSelect({ selected, available, onToggle }: { selected: string[], available: string[], onToggle: (tradeType: string) => void }) {
  const [open, setOpen] = useState(false)

  const availableNotSelected = available.filter(t => !selected.includes(t))

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.length > 0 && (
        <span className="text-[10px] text-[#3a3530] font-mono truncate">{selected.join(', ')}</span>
      )}
      {availableNotSelected.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="text-[10px] text-[#9e998f] hover:text-[#1a1a1a] underline"
          >
            +{selected.length === 0 ? ' Add' : ''}
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
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-[#f5f2ee] font-mono whitespace-nowrap"
                >
                  {tradeType}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <button
          onClick={() => {
            selected.forEach(t => onToggle(t))
          }}
          className="text-[10px] text-[#9e998f] hover:text-red-600"
        >
          ×
        </button>
      )}
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
