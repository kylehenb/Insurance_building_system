'use client'

import React, { useState, useCallback } from 'react'

// Field definitions for trades table
const TRADES_FIELDS = [
  { key: 'primary_trade', label: 'Primary Trade', required: true },
  { key: 'business_name', label: 'Business Name', required: true },
  { key: 'trade_code', label: 'Trade Code', required: false },
  { key: 'entity_name', label: 'Entity Name', required: false },
  { key: 'abn', label: 'ABN', required: false },
  { key: 'primary_contact', label: 'Primary Contact', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'contact_email', label: 'Contact Email', required: false },
  { key: 'contact_mobile', label: 'Contact Mobile', required: false },
  { key: 'contact_office', label: 'Contact Office', required: false },
  { key: 'can_do_make_safe', label: 'Can Do Make Safe', required: false },
  { key: 'makesafe_priority', label: 'Make Safe Priority', required: false },
  { key: 'can_do_reports', label: 'Can Do Reports', required: false },
  { key: 'availability', label: 'Availability', required: false },
  { key: 'priority_rank', label: 'Priority Rank', required: false },
  { key: 'service_area', label: 'Service Area', required: false },
  { key: 'gary_opt_out', label: 'Gary Opt Out', required: false },
  { key: 'gary_contact_preference', label: 'Gary Contact Preference', required: false },
  { key: 'gary_notes', label: 'Gary Notes', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'status_note', label: 'Status Note', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const

type TradesFieldKey = typeof TRADES_FIELDS[number]['key']

// Common aliases for field names
const FIELD_ALIASES: Record<string, string[]> = {
  primary_trade: ['primary_trade', 'trade', 'trade_name', 'category', 'type'],
  business_name: ['business_name', 'company', 'company_name', 'name'],
  trade_code: ['trade_code', 'code'],
  entity_name: ['entity_name', 'entity'],
  abn: ['abn', 'australian_business_number'],
  primary_contact: ['primary_contact', 'contact', 'contact_person', 'contact_name'],
  address: ['address', 'street_address', 'location'],
  contact_email: ['contact_email', 'email'],
  contact_mobile: ['contact_mobile', 'mobile', 'mobile_phone', 'cell'],
  contact_office: ['contact_office', 'office', 'office_phone', 'phone'],
  can_do_make_safe: ['can_do_make_safe', 'make_safe', 'makesafe'],
  makesafe_priority: ['makesafe_priority', 'priority'],
  can_do_reports: ['can_do_reports', 'reports'],
  availability: ['availability', 'capacity'],
  priority_rank: ['priority_rank', 'rank'],
  service_area: ['service_area', 'service_area', 'service_areas'],
  gary_opt_out: ['gary_opt_out', 'opt_out'],
  gary_contact_preference: ['gary_contact_preference', 'gary_preference', 'contact_preference'],
  gary_notes: ['gary_notes'],
  status: ['status'],
  status_note: ['status_note'],
  notes: ['notes', 'comments'],
}

const NUMERIC_FIELDS: string[] = [
  'makesafe_priority',
  'priority_rank',
]

const STAR_RATING_FIELDS: string[] = [
  'priority_rank',
]

const BOOLEAN_FIELDS: string[] = [
  'can_do_make_safe',
  'can_do_reports',
  'gary_opt_out',
]

interface CsvRow {
  [key: string]: string
}

interface Mapping {
  csvColumn: string
  tradesField: string
}

export interface TradesImportRow {
  primary_trade?: string | null
  business_name?: string | null
  trade_code?: string | null
  entity_name?: string | null
  abn?: string | null
  primary_contact?: string | null
  address?: string | null
  contact_email?: string | null
  contact_mobile?: string | null
  contact_office?: string | null
  can_do_make_safe?: boolean | null
  makesafe_priority?: number | null
  can_do_reports?: boolean | null
  availability?: string | null
  priority_rank?: number | null
  service_area?: string[] | null
  gary_opt_out?: boolean | null
  gary_contact_preference?: string | null
  gary_notes?: string | null
  status?: string | null
  status_note?: string | null
  notes?: string | null
}

interface TradesCsvImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: TradesImportRow[]) => Promise<void>
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

    mappings.push({ csvColumn: csvCol, tradesField: matchedField || '' })
  }

  return mappings
}

export function TradesCsvImportDialog({ isOpen, onClose, onImport }: TradesCsvImportDialogProps) {
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping[]>([])
  const [step, setStep] = useState<'input' | 'mapping' | 'preview'>('input')
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<TradesImportRow[]>([])
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
      updated[index] = { ...updated[index], tradesField: newField }
      return updated
    })
  }

  const generatePreview = useCallback((): TradesImportRow[] => {
    return parsedRows.map(row => {
      const item: TradesImportRow = {}

      for (const map of mapping) {
        if (!map.tradesField) continue
        const value = row[map.csvColumn] || ''

        if (NUMERIC_FIELDS.includes(map.tradesField)) {
          const cleaned = value.replace(/[^0-9.-]+/g, '').trim()
          if (cleaned !== '') {
            const num = parseFloat(cleaned)
            if (!isNaN(num)) {
              // Validate star rating fields are 1-5
              if (STAR_RATING_FIELDS.includes(map.tradesField)) {
                const rounded = Math.round(num)
                const clamped = Math.max(1, Math.min(5, rounded))
                ;(item as any)[map.tradesField] = clamped
              } else {
                ;(item as any)[map.tradesField] = num
              }
            }
          }
        } else if (BOOLEAN_FIELDS.includes(map.tradesField)) {
          const normalized = value.toLowerCase().trim()
          if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') {
            (item as any)[map.tradesField] = true
          } else if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') {
            (item as any)[map.tradesField] = false
          }
        } else {
          const trimmed = value.trim()
          if (trimmed !== '') {
            (item as any)[map.tradesField] = trimmed
          }
        }
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
          maxWidth: 900,
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 24,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4, color: '#1a1a1a' }}>
          Import Trades from CSV
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
                placeholder={`Primary Trade,Business Name,Trade Code,Primary Contact,Contact Mobile,Contact Email,Address
Plumber,ABC Plumbing,PL01,John Smith,0412345678,john@abcplumbing.com.au,123 Main St
Electrician,Sparky Solutions,EL01,Jane Doe,0423456789,jane@sparky.com.au,456 High Rd`}
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
              Map your CSV columns to trades fields. Required fields are marked with *.
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
                          value={mapping[idx]?.tradesField || ''}
                          onChange={e => handleMappingChange(idx, e.target.value)}
                          style={{ padding: 6, fontSize: 12, border: '1px solid #e0dbd4', borderRadius: 4, minWidth: 160 }}
                        >
                          <option value="">-- Ignore --</option>
                          {TRADES_FIELDS.map(field => (
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
              {previewItems.length} trade{previewItems.length !== 1 ? 's' : ''} ready to import
            </p>

            <div style={{ marginBottom: 16, maxHeight: 320, overflow: 'auto', border: '1px solid #e0dbd4', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Primary Trade</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Business Name</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Contact</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Mobile</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Email</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.slice(0, 20).map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e0dbd4' }}>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.primary_trade || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.business_name || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.primary_contact || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.contact_mobile || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.contact_email || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.status || '-'}</td>
                    </tr>
                  ))}
                  {previewItems.length > 20 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 8, textAlign: 'center', color: '#9e998f' }}>
                        ... and {previewItems.length - 20} more trades
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
                {importing ? 'Importing...' : `Import ${previewItems.length} Trade${previewItems.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
