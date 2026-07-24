'use client'

import { useState, useEffect, useRef } from 'react'

interface TradeType {
  id: string
  trade_type: string
}

interface TradeTypesModalProps {
  isOpen: boolean
  onClose: () => void
  onChanged: () => void
}

export function TradeTypesModal({ isOpen, onClose, onChanged }: TradeTypesModalProps) {
  const [tradeTypes, setTradeTypes] = useState<TradeType[]>([])
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<TradeType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      load()
      setError(null)
      setNewName('')
    }
  }, [isOpen])

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/settings/trade-types')
    if (res.ok) setTradeTypes(await res.json())
    setLoading(false)
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    setError(null)
    const res = await fetch('/api/settings/trade-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade_type: name }),
    })
    if (res.ok) {
      setNewName('')
      await load()
      onChanged()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to add trade type')
    }
    setAdding(false)
  }

  async function handleRename(item: TradeType) {
    const name = editingValue.trim()
    setEditingId(null)
    if (!name || name === item.trade_type) return
    setError(null)
    const res = await fetch('/api/settings/trade-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_name: item.trade_type, new_name: name }),
    })
    if (res.ok) {
      await load()
      onChanged()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to rename trade type')
    }
  }

  async function handleDelete(item: TradeType) {
    setError(null)
    const res = await fetch('/api/settings/trade-types', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade_type: item.trade_type }),
    })
    setDeleteConfirm(null)
    if (res.ok) {
      await load()
      onChanged()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to delete trade type')
    }
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-6 w-full max-w-sm flex flex-col" style={{ maxHeight: '70vh' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[#1a1a1a]">Manage Trade Types</h2>
            <button
              onClick={onClose}
              className="text-[#1a1a1a]/40 hover:text-[#1a1a1a] transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto rounded-lg border border-[#e4dfd8] divide-y divide-[#f0ece6]">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-[#b0a898]">Loading...</div>
            ) : tradeTypes.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-[#b0a898]">No trade types yet</div>
            ) : (
              tradeTypes.map(item => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[#faf9f7] group">
                  {editingId === item.id ? (
                    <input
                      ref={editInputRef}
                      className="flex-1 rounded border border-[#c9a96e] px-2 py-0.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                      value={editingValue}
                      onChange={e => setEditingValue(e.target.value)}
                      onBlur={() => handleRename(item)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(item)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                  ) : (
                    <span
                      className="flex-1 text-sm text-[#1a1a1a] cursor-pointer"
                      onClick={() => { setEditingId(item.id); setEditingValue(item.trade_type) }}
                      title="Click to rename"
                    >
                      {item.trade_type}
                    </span>
                  )}
                  <button
                    onClick={() => { setEditingId(item.id); setEditingValue(item.trade_type) }}
                    className="text-[#1a1a1a]/30 hover:text-[#1a1a1a] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Rename"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(item)}
                    className="text-[#1a1a1a]/30 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Delete"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="New trade type..."
              className="flex-1 rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="px-4 py-2 text-sm font-medium text-[#f5f0e8] bg-[#1a1a1a] rounded-lg hover:bg-[#1a1a1a]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">Delete Trade Type</h3>
            <p className="text-sm text-[#1a1a1a]/70 mb-1">
              Delete <strong>{deleteConfirm.trade_type}</strong>?
            </p>
            <p className="text-xs text-[#1a1a1a]/50 mb-5">
              Existing contractors assigned to this type will keep their current assignment, but it will no longer appear as an option when adding new contractors.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-[#3a3530] bg-white border border-[#e0dbd4] rounded-lg hover:bg-[#f5f0e8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
