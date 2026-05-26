'use client'

import { useState, useRef } from 'react'
import type { InsurersOption } from '@/lib/types/scope-library'

interface CsvRow {
  keyword: string
  description: string
  unit: string
  labour: string
  materials: string
  total: string
}

interface ImportResult {
  updated: number
  unmatched: CsvRow[]
}

interface ResolvedRow {
  index: number
  method: 'mapped' | 'created'
}

interface Props {
  isOpen: boolean
  tenantId: string
  insurers: InsurersOption[]
  onClose: () => void
  onImported: () => void
}

export function ScopeLibraryImportModal({ isOpen, tenantId, insurers, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedInsurerId, setSelectedInsurerId] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [resolved, setResolved] = useState<ResolvedRow[]>([])
  const [mapSearch, setMapSearch] = useState<Record<number, string>>({})
  const [mapResults, setMapResults] = useState<Record<number, Array<{ id: string; item_description: string | null; keyword: string | null }>>>({})
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  async function handleImport() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Please select a CSV file.')
      return
    }
    if (!selectedInsurerId) {
      setError('Please select an insurer.')
      return
    }
    setError(null)
    setImporting(true)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('insurer_id', selectedInsurerId)

      const res = await fetch('/api/scope-library/import', { method: 'POST', body: fd })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Import failed')
        return
      }
      const data = await res.json() as ImportResult
      setResult(data)
      setResolved([])
      setMapSearch({})
      setMapResults({})
    } catch {
      setError('Unexpected error during import.')
    } finally {
      setImporting(false)
    }
  }

  async function handleMapSearch(rowIndex: number, query: string) {
    setMapSearch((prev) => ({ ...prev, [rowIndex]: query }))
    if (query.length < 2) {
      setMapResults((prev) => ({ ...prev, [rowIndex]: [] }))
      return
    }
    const res = await fetch(`/api/scope-library?search=${encodeURIComponent(query)}`)
    if (res.ok) {
      const items = await res.json() as Array<{ id: string; item_description: string | null; keyword: string | null }>
      setMapResults((prev) => ({ ...prev, [rowIndex]: items.slice(0, 8) }))
    }
  }

  async function handleMapToExisting(rowIndex: number, itemId: string, csvRow: CsvRow) {
    const labourVal = parseFloat(csvRow.labour) || null
    const materialsVal = parseFloat(csvRow.materials) || null
    const totalVal = parseFloat(csvRow.total) || null

    const res = await fetch(`/api/scope-library/${itemId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insurer_id: selectedInsurerId,
        labour_per_unit: labourVal,
        materials_per_unit: materialsVal,
        total_per_unit: totalVal,
      }),
    })
    if (res.ok) {
      setResolved((prev) => [...prev, { index: rowIndex, method: 'mapped' }])
      setMapSearch((prev) => ({ ...prev, [rowIndex]: '' }))
      setMapResults((prev) => ({ ...prev, [rowIndex]: [] }))
    }
  }

  async function handleCreateBase(rowIndex: number, csvRow: CsvRow) {
    const labourVal = parseFloat(csvRow.labour) || null
    const materialsVal = parseFloat(csvRow.materials) || null
    const totalVal = parseFloat(csvRow.total) || null

    const createRes = await fetch('/api/scope-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: csvRow.keyword,
        item_description: csvRow.description,
        unit: csvRow.unit || null,
        labour_per_unit: labourVal,
        materials_per_unit: materialsVal,
        total_per_unit: totalVal,
      }),
    })
    if (!createRes.ok) return
    const newItem = await createRes.json() as { id: string }

    await fetch(`/api/scope-library/${newItem.id}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insurer_id: selectedInsurerId,
        labour_per_unit: labourVal,
        materials_per_unit: materialsVal,
        total_per_unit: totalVal,
      }),
    })

    setResolved((prev) => [...prev, { index: rowIndex, method: 'created' }])
  }

  function handleClose() {
    if (result) onImported()
    setResult(null)
    setError(null)
    setSelectedInsurerId('')
    onClose()
  }

  const resolvedIndices = new Set(resolved.map((r) => r.index))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-[#faf9f7] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-[#e0dbd4]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0dbd4]">
          <h2 className="text-base font-semibold text-[#1a1a1a]">Import Insurer Pricing CSV</h2>
          <button onClick={handleClose} className="text-[#b0a898] hover:text-[#1a1a1a] transition-colors">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {!result ? (
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">Insurer</label>
              <select
                value={selectedInsurerId}
                onChange={(e) => setSelectedInsurerId(e.target.value)}
                className="w-full border border-[#e0dbd4] rounded-lg px-3 py-2 text-sm bg-white text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e]"
              >
                <option value="">Select insurer…</option>
                {insurers.map((ins) => (
                  <option key={ins.id} value={ins.id}>
                    {ins.trading_name ?? ins.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3a3530] mb-1">CSV File</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="block w-full text-sm text-[#3a3530] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-[#e0dbd4] file:text-[#3a3530] hover:file:bg-[#c9a96e] hover:file:text-white file:cursor-pointer"
              />
              <p className="mt-1.5 text-xs text-[#b0a898]">Columns: keyword, description, unit, labour, materials, total</p>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-[#3a3530] hover:text-[#1a1a1a] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-2 text-sm font-medium bg-[#c9a96e] text-white rounded-lg hover:bg-[#b8956a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-sm font-medium px-3 py-1 rounded-full border border-green-200">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {result.updated} item{result.updated !== 1 ? 's' : ''} updated
              </span>
              {result.unmatched.length > 0 && (
                <span className="text-sm text-[#b0a898]">{result.unmatched.length} unmatched row{result.unmatched.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {result.unmatched.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#3a3530] uppercase tracking-wide mb-3">Unmatched Rows</p>
                <div className="space-y-3">
                  {result.unmatched.map((csvRow, idx) => {
                    const isResolved = resolvedIndices.has(idx)
                    const resolvedEntry = resolved.find((r) => r.index === idx)
                    return (
                      <div
                        key={idx}
                        className={`border rounded-lg p-3 text-sm ${isResolved ? 'border-green-200 bg-green-50' : 'border-[#e0dbd4] bg-white'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-medium text-[#1a1a1a]">{csvRow.keyword || '(no keyword)'}</span>
                            {csvRow.description && (
                              <span className="ml-2 text-[#b0a898] text-xs">{csvRow.description}</span>
                            )}
                          </div>
                          {isResolved && (
                            <span className="flex-shrink-0 flex items-center gap-1 text-green-600 text-xs font-medium">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6.5l2.5 2.5 5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {resolvedEntry?.method === 'created' ? 'Created' : 'Mapped'}
                            </span>
                          )}
                        </div>

                        {!isResolved && (
                          <div className="mt-2 space-y-2">
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Search existing items to map…"
                                value={mapSearch[idx] ?? ''}
                                onChange={(e) => handleMapSearch(idx, e.target.value)}
                                className="w-full border border-[#e0dbd4] rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#c9a96e]"
                              />
                              {(mapResults[idx]?.length ?? 0) > 0 && (
                                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-[#e0dbd4] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                  {(mapResults[idx] ?? []).map((item) => (
                                    <button
                                      key={item.id}
                                      onClick={() => handleMapToExisting(idx, item.id, csvRow)}
                                      className="w-full text-left px-3 py-2 text-xs hover:bg-[#f5f0e8] text-[#1a1a1a]"
                                    >
                                      <span className="font-medium">{item.keyword ?? '—'}</span>
                                      {item.item_description && (
                                        <span className="ml-1.5 text-[#b0a898]">{item.item_description}</span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <button
                              onClick={() => handleCreateBase(idx, csvRow)}
                              className="text-xs text-[#c9a96e] hover:text-[#b8956a] font-medium"
                            >
                              + Create base item
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium bg-[#c9a96e] text-white rounded-lg hover:bg-[#b8956a] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
