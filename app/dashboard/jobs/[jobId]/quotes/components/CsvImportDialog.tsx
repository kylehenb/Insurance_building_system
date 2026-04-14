'use client'

import React, { useState, useCallback } from 'react'
import type { ScopeItem } from '../hooks/useQuote'

// Field definitions for scope_items table
const SCOPE_FIELDS = [
  { key: 'room', label: 'Room', required: true },
  { key: 'trade', label: 'Trade', required: true },
  { key: 'item_description', label: 'Description', required: true },
  { key: 'qty', label: 'Quantity', required: true },
  { key: 'rate_labour', label: 'Rate Labour', required: true },
  { key: 'rate_materials', label: 'Rate Materials', required: true },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'room_length', label: 'Room Length', required: false },
  { key: 'room_width', label: 'Room Width', required: false },
  { key: 'room_height', label: 'Room Height', required: false },
  { key: 'keyword', label: 'Keyword', required: false },
  { key: 'split_type', label: 'Split Type', required: false },
] as const

// Common aliases for field names
const FIELD_ALIASES: Record<string, string[]> = {
  room: ['room', 'location', 'area', 'space'],
  trade: ['trade', 'category', 'type'],
  item_description: ['item_description', 'description', 'desc', 'item', 'name'],
  qty: ['qty', 'quantity', 'qty', 'amount'],
  rate_labour: ['rate_labour', 'labour_rate', 'labor_rate', 'labour', 'labor'],
  rate_materials: ['rate_materials', 'materials_rate', 'material_rate', 'materials', 'material'],
  unit: ['unit', 'uom', 'measure'],
  room_length: ['room_length', 'length', 'l'],
  room_width: ['room_width', 'width', 'w'],
  room_height: ['room_height', 'height', 'h'],
  keyword: ['keyword', 'key'],
  split_type: ['split_type', 'split'],
}

interface CsvRow {
  [key: string]: string
}

interface Mapping {
  csvColumn: string
  scopeField: string
}

interface CsvImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: Partial<ScopeItem>[]) => void
  quoteId: string
  tenantId: string
}

export function CsvImportDialog({ isOpen, onClose, onImport, quoteId, tenantId }: CsvImportDialogProps) {
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping[]>([])
  const [showMapping, setShowMapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<Partial<ScopeItem>[]>([])

  const parseCSV = useCallback((text: string) => {
    const lines = text.split('\n').filter(line => line.trim())
    if (lines.length < 2) {
      setError('CSV must have at least a header row and one data row')
      return
    }

    // Parse header
    const headerLine = lines[0]
    const headerCols = parseCSVLine(headerLine)
    setHeaders(headerCols)

    // Parse data rows
    const dataRows: CsvRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      if (values.length === headerCols.length) {
        const row: CsvRow = {}
        headerCols.forEach((col, idx) => {
          row[col] = values[idx]?.trim() || ''
        })
        dataRows.push(row)
      }
    }

    setParsedRows(dataRows)
    setError(null)

    // Auto-map headers
    const autoMapping = autoMapHeaders(headerCols)
    setMapping(autoMapping)
    setShowMapping(true)
  }, [])

  const parseCSVLine = (line: string): string[] => {
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

  const autoMapHeaders = (csvHeaders: string[]): Mapping[] => {
    const mappings: Mapping[] = []
    const mappedFields = new Set<string>()

    for (const csvCol of csvHeaders) {
      const normalized = csvCol.toLowerCase().trim()
      let matchedField: string | null = null

      // Try to find a direct match or alias match
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.some(alias => normalized === alias.toLowerCase()) && !mappedFields.has(field)) {
          matchedField = field
          mappedFields.add(field)
          break
        }
      }

      mappings.push({
        csvColumn: csvCol,
        scopeField: matchedField || '',
      })
    }

    return mappings
  }

  const handleMappingChange = (index: number, newField: string) => {
    setMapping(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], scopeField: newField }
      return updated
    })
  }

  const generatePreview = useCallback(() => {
    const items: Partial<ScopeItem>[] = []

    for (const row of parsedRows) {
      const item: Partial<ScopeItem> = {
        tenant_id: tenantId,
        quote_id: quoteId,
        is_custom: true,
        approval_status: 'pending',
      }

      for (const map of mapping) {
        if (map.scopeField) {
          const value = row[map.csvColumn] || ''
          
          // Convert numeric fields
          if (['qty', 'rate_labour', 'rate_materials', 'room_length', 'room_width', 'room_height'].includes(map.scopeField)) {
            const trimmedValue = value.trim()
            if (trimmedValue !== '') {
              const numValue = parseFloat(trimmedValue)
              if (!isNaN(numValue)) {
                (item as any)[map.scopeField] = numValue
              }
            }
          } else {
            const trimmedValue = value.trim()
            if (trimmedValue !== '') {
              (item as any)[map.scopeField] = trimmedValue
            }
          }
        }
      }

      // Default room to "General" if not provided
      if (!item.room) {
        item.room = 'General'
      }

      // Calculate line_total if we have qty and rate_labour/rate_materials
      if (item.qty) {
        const labourRate = item.rate_labour ?? 0
        const materialsRate = item.rate_materials ?? 0
        item.line_total = item.qty * (labourRate + materialsRate)
      }

      items.push(item)
    }

    setPreviewItems(items)
  }, [parsedRows, mapping, tenantId, quoteId])

  const handleConfirmMapping = () => {
    generatePreview()
    setShowMapping(false)
  }

  const handleImport = () => {
    // All items should have a room now (default to "General" if not provided)
    const validItems = previewItems

    if (validItems.length === 0) {
      setError('No items to import')
      return
    }

    // Warn about items with missing data but still import them
    const itemsMissingData = previewItems.filter(item => {
      return !item.trade || !item.item_description || item.qty === null || item.rate_labour === null || item.rate_materials === null
    })

    if (itemsMissingData.length > 0) {
      setError(`${itemsMissingData.length} items have missing required fields and will be imported with blank values`)
      // Continue with import despite warning
    }

    onImport(validItems)
    handleClose()
  }

  const handleClose = () => {
    setCsvText('')
    setParsedRows([])
    setHeaders([])
    setMapping([])
    setShowMapping(false)
    setError(null)
    setPreviewItems([])
    onClose()
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
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#1a1a1a' }}>
          Import CSV
        </h2>

        {!showMapping && previewItems.length === 0 && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#3a3530', display: 'block', marginBottom: 8 }}>
                Paste CSV content or upload a file
              </label>
              <textarea
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                placeholder="Room,Trade,Description,Quantity,Rate Total,Unit&#10;Kitchen,Plumber,Install sink,1,250,each&#10;Bathroom,Plumber,Install toilet,1,180,each"
                style={{
                  width: '100%',
                  height: 150,
                  padding: 12,
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  resize: 'vertical',
                }}
              />
              <input
                type="file"
                accept=".csv"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onload = event => {
                      setCsvText(event.target?.result as string)
                    }
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
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => parseCSV(csvText)}
                disabled={!csvText.trim()}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a1a1a',
                  border: 'none',
                  borderRadius: 6,
                  cursor: csvText.trim() ? 'pointer' : 'not-allowed',
                  opacity: csvText.trim() ? 1 : 0.5,
                }}
              >
                Next
              </button>
            </div>
          </>
        )}

        {showMapping && (
          <>
            <p style={{ fontSize: 13, color: '#3a3530', marginBottom: 16 }}>
              Map CSV columns to quote fields. Required fields are marked with *.
            </p>

            <div style={{ marginBottom: 16, maxHeight: 300, overflow: 'auto', border: '1px solid #e0dbd4', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: 10, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>CSV Column</th>
                    <th style={{ padding: 10, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header, idx) => (
                    <tr key={header} style={{ borderBottom: '1px solid #e0dbd4' }}>
                      <td style={{ padding: 10, color: '#3a3530' }}>{header}</td>
                      <td style={{ padding: 10 }}>
                        <select
                          value={mapping[idx]?.scopeField || ''}
                          onChange={e => handleMappingChange(idx, e.target.value)}
                          style={{
                            padding: 6,
                            fontSize: 12,
                            border: '1px solid #e0dbd4',
                            borderRadius: 4,
                            minWidth: 150,
                          }}
                        >
                          <option value="">-- Ignore --</option>
                          {SCOPE_FIELDS.map(field => (
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
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMapping}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a1a1a',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Preview Import
              </button>
            </div>
          </>
        )}

        {previewItems.length > 0 && (
          <>
            <p style={{ fontSize: 13, color: '#3a3530', marginBottom: 16 }}>
              Preview: {previewItems.length} items will be imported
            </p>

            <div style={{ marginBottom: 16, maxHeight: 300, overflow: 'auto', border: '1px solid #e0dbd4', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Room</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Trade</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Description</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Qty</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Labour</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Materials</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.slice(0, 20).map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e0dbd4' }}>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.room || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.trade || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.item_description || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.qty || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.rate_labour || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.rate_materials || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.line_total || '-'}</td>
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
                onClick={() => {
                  setShowMapping(true)
                  setPreviewItems([])
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button
                onClick={handleImport}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a1a1a',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Import {previewItems.length} Items
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
