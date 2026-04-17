'use client'

import React, { useState, useCallback } from 'react'

// Field definitions for scope_library table
const LIBRARY_FIELDS = [
  { key: 'trade', label: 'Trade', required: true },
  { key: 'item_description', label: 'Description', required: true },
  { key: 'keyword', label: 'Keyword', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'labour_rate_per_hour', label: 'Labour Rate /Hr', required: false },
  { key: 'labour_per_unit', label: 'Labour /Unit', required: false },
  { key: 'materials_per_unit', label: 'Materials /Unit', required: false },
  { key: 'total_per_unit', label: 'Total /Unit', required: false },
  { key: 'estimated_hours', label: 'Estimated Hours', required: false },
  { key: 'insurer_specific', label: 'Insurer', required: false },
] as const

type LibraryFieldKey = typeof LIBRARY_FIELDS[number]['key']

// Common aliases for field names
const FIELD_ALIASES: Record<string, string[]> = {
  trade: ['trade', 'category', 'type', 'trade_name'],
  item_description: ['item_description', 'description', 'desc', 'item', 'name', 'scope_description'],
  keyword: ['keyword', 'key', 'tag'],
  unit: ['unit', 'uom', 'measure', 'unit_of_measure'],
  labour_rate_per_hour: ['labour_rate_per_hour', 'labour_rate', 'labor_rate', 'rate_per_hour', 'hourly_rate'],
  labour_per_unit: ['labour_per_unit', 'labour_unit', 'labor_per_unit', 'labor_unit', 'labour', 'labor'],
  materials_per_unit: ['materials_per_unit', 'materials_unit', 'material_per_unit', 'materials', 'material'],
  total_per_unit: ['total_per_unit', 'total_unit', 'total', 'rate', 'price', 'unit_price'],
  estimated_hours: ['estimated_hours', 'est_hours', 'hours', 'est_hrs', 'hrs'],
  insurer_specific: ['insurer_specific', 'insurer', 'insurance', 'insurer_name'],
}

const NUMERIC_FIELDS: string[] = [
  'labour_rate_per_hour',
  'labour_per_unit',
  'materials_per_unit',
  'total_per_unit',
  'estimated_hours',
]

interface CsvRow {
  [key: string]: string
}

interface Mapping {
  csvColumn: string
  libraryField: string
}

export interface ScopeLibraryImportRow {
  trade?: string | null
  item_description?: string | null
  keyword?: string | null
  unit?: string | null
  labour_rate_per_hour?: number | null
  labour_per_unit?: number | null
  materials_per_unit?: number | null
  total_per_unit?: number | null
  estimated_hours?: number | null
  insurer_specific?: string | null
}

interface ScopeLibraryCsvImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: ScopeLibraryImportRow[]) => Promise<void>
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function autoMapHeaders(csvHeaders: string[]): Mapping[] {
  const mappings: Mapping[] = []
  const mappedFields = new Set<string>()

  for (const csvCol of csvHeaders) {
    const normalized = csvCol.toLowerCase().trim().replace(/\s+/g, '_')
    let matchedField: string | null = null

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some(alias => normalized === alias.toLowerCase()) && !mappedFields.has(field)) {
        matchedField = field
        mappedFields.add(field)
        break
      }
    }

    mappings.push({ csvColumn: csvCol, libraryField: matchedField || '' })
  }

  return mappings
}

export function ScopeLibraryCsvImportDialog({ isOpen, onClose, onImport }: ScopeLibraryCsvImportDialogProps) {
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping[]>([])
  const [step, setStep] = useState<'input' | 'mapping' | 'preview'>('input')
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<ScopeLibraryImportRow[]>([])
  const [importing, setImporting] = useState(false)

  const handleClose = () => {
    setCsvText('')
    setParsedRows([])
    setHeaders([])
    setMapping([])
    setStep('input')
    setError(null)
    setPreviewItems([])
    setImporting(false)
    onClose()
  }

  const parseCSV = useCallback((text: string) => {
    const lines = text.split('\n').filter(line => line.trim())
    if (lines.length < 2) {
      setError('CSV must have at least a header row and one data row')
      return
    }

    const headerCols = parseCSVLine(lines[0])
    setHeaders(headerCols)

    const dataRows: CsvRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      if (values.some(v => v.trim())) {
        const row: CsvRow = {}
        headerCols.forEach((col, idx) => {
          row[col] = values[idx]?.trim() || ''
        })
        dataRows.push(row)
      }
    }

    setParsedRows(dataRows)
    setMapping(autoMapHeaders(headerCols))
    setError(null)
    setStep('mapping')
  }, [])

  const handleMappingChange = (index: number, newField: string) => {
    setMapping(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], libraryField: newField }
      return updated
    })
  }

  const generatePreview = useCallback((): ScopeLibraryImportRow[] => {
    return parsedRows.map(row => {
      const item: ScopeLibraryImportRow = {}

      for (const map of mapping) {
        if (!map.libraryField) continue
        const value = row[map.csvColumn] || ''

        if (NUMERIC_FIELDS.includes(map.libraryField)) {
          const cleaned = value.replace(/[^0-9.-]+/g, '').trim()
          if (cleaned !== '') {
            const num = parseFloat(cleaned)
            if (!isNaN(num)) {
              (item as any)[map.libraryField] = num
            }
          }
        } else {
          const trimmed = value.trim()
          if (trimmed !== '') {
            (item as any)[map.libraryField] = trimmed
          }
        }
      }

      // Auto-calculate total if labour + materials are present and total is not mapped
      if (item.total_per_unit == null && (item.labour_per_unit != null || item.materials_per_unit != null)) {
        item.total_per_unit = (item.labour_per_unit ?? 0) + (item.materials_per_unit ?? 0)
      }

      return item
    })
  }, [parsedRows, mapping])

  const handleConfirmMapping = () => {
    const items = generatePreview()
    setPreviewItems(items)
    setStep('preview')
  }

  const handleImport = async () => {
    if (previewItems.length === 0) {
      setError('No items to import')
      return
    }
    setImporting(true)
    try {
      await onImport(previewItems)
      handleClose()
    } catch {
      setError('Import failed. Please try again.')
      setImporting(false)
    }
  }

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '-'
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          width: '90%',
          maxWidth: 800,
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 24,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4, color: '#1a1a1a' }}>
          Import Scope Library from CSV
        </h2>
        <p style={{ fontSize: 13, color: '#9e998f', marginBottom: 16 }}>
          Step {step === 'input' ? 1 : step === 'mapping' ? 2 : 3} of 3 —{' '}
          {step === 'input' ? 'Upload or paste CSV' : step === 'mapping' ? 'Map columns' : 'Review & import'}
        </p>

        {/* Step 1: Input */}
        {step === 'input' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#3a3530', display: 'block', marginBottom: 8 }}>
                Paste CSV content or upload a file
              </label>
              <textarea
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                placeholder={`Trade,Description,Keyword,Unit,Labour/Unit,Materials/Unit,Total/Unit\nPlumber,Install basin waste,basin_waste,ea,45.00,12.00,57.00\nPainter,Prepare and paint ceiling,paint_ceiling,m²,8.00,4.00,12.00`}
                style={{
                  width: '100%',
                  height: 160,
                  padding: 12,
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="file"
                accept=".csv"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onload = event => setCsvText(event.target?.result as string)
                    reader.readAsText(file)
                  }
                }}
                style={{ marginTop: 8, fontSize: 12 }}
              />
            </div>

            {error && (
              <div style={{ marginBottom: 16, padding: 12, background: '#fee2e2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#3a3530', background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => parseCSV(csvText)}
                disabled={!csvText.trim()}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#ffffff', background: '#1a1a1a', border: 'none', borderRadius: 6, cursor: csvText.trim() ? 'pointer' : 'not-allowed', opacity: csvText.trim() ? 1 : 0.5 }}
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* Step 2: Mapping */}
        {step === 'mapping' && (
          <>
            <p style={{ fontSize: 13, color: '#3a3530', marginBottom: 16 }}>
              Map your CSV columns to scope library fields. Required fields are marked with *.
            </p>

            <div style={{ marginBottom: 16, maxHeight: 320, overflow: 'auto', border: '1px solid #e0dbd4', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: 10, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>CSV Column</th>
                    <th style={{ padding: 10, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Preview</th>
                    <th style={{ padding: 10, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header, idx) => (
                    <tr key={header} style={{ borderBottom: '1px solid #e0dbd4' }}>
                      <td style={{ padding: 10, color: '#3a3530', fontWeight: 500 }}>{header}</td>
                      <td style={{ padding: 10, color: '#9e998f', fontFamily: 'monospace', fontSize: 11 }}>
                        {parsedRows[0]?.[header] || '—'}
                      </td>
                      <td style={{ padding: 10 }}>
                        <select
                          value={mapping[idx]?.libraryField || ''}
                          onChange={e => handleMappingChange(idx, e.target.value)}
                          style={{ padding: 6, fontSize: 12, border: '1px solid #e0dbd4', borderRadius: 4, minWidth: 160 }}
                        >
                          <option value="">-- Ignore --</option>
                          {LIBRARY_FIELDS.map(field => (
                            <option key={field.key} value={field.key}>
                              {field.label}{field.required ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#3a3530', background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('input')}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#3a3530', background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={handleConfirmMapping}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#ffffff', background: '#1a1a1a', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Preview Import
              </button>
            </div>
          </>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <>
            <p style={{ fontSize: 13, color: '#3a3530', marginBottom: 16 }}>
              {previewItems.length} item{previewItems.length !== 1 ? 's' : ''} ready to import
            </p>

            <div style={{ marginBottom: 16, maxHeight: 320, overflow: 'auto', border: '1px solid #e0dbd4', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Trade</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Keyword</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Description</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Unit</th>
                    <th style={{ padding: 8, textAlign: 'right', fontWeight: 600, color: '#1a1a1a' }}>Labour</th>
                    <th style={{ padding: 8, textAlign: 'right', fontWeight: 600, color: '#1a1a1a' }}>Materials</th>
                    <th style={{ padding: 8, textAlign: 'right', fontWeight: 600, color: '#1a1a1a' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.slice(0, 20).map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e0dbd4' }}>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.trade || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530', fontFamily: 'monospace' }}>{item.keyword || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530', maxWidth: 200 }}>{item.item_description || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.unit || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.labour_per_unit)}</td>
                      <td style={{ padding: 8, color: '#3a3530', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.materials_per_unit)}</td>
                      <td style={{ padding: 8, color: '#3a3530', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(item.total_per_unit)}</td>
                    </tr>
                  ))}
                  {previewItems.length > 20 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 8, textAlign: 'center', color: '#9e998f' }}>
                        ... and {previewItems.length - 20} more items
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {error && (
              <div style={{ marginBottom: 16, padding: 12, background: '#fee2e2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#3a3530', background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('mapping')}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#3a3530', background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#ffffff', background: '#1a1a1a', border: 'none', borderRadius: 6, cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.7 : 1 }}
              >
                {importing ? 'Importing...' : `Import ${previewItems.length} Item${previewItems.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
