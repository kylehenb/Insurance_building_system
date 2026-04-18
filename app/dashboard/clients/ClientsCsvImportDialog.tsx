'use client'

import React, { useState, useCallback } from 'react'

// Field definitions for clients table
const CLIENTS_FIELDS = [
  { key: 'client_type', label: 'Client Type', required: true },
  { key: 'name', label: 'Name', required: true },
  { key: 'trading_name', label: 'Trading Name', required: false },
  { key: 'abn', label: 'ABN', required: false },
  { key: 'submission_email', label: 'Submission Email', required: false },
  { key: 'contact_phone', label: 'Contact Phone', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'kpi_contact_hours', label: 'KPI Contact Hours', required: false },
  { key: 'kpi_booking_hours', label: 'KPI Booking Hours', required: false },
  { key: 'kpi_visit_days', label: 'KPI Visit Days', required: false },
  { key: 'kpi_report_days', label: 'KPI Report Days', required: false },
  { key: 'send_booking_confirmation', label: 'Send Booking Confirmation', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const

type ClientsFieldKey = typeof CLIENTS_FIELDS[number]['key']

// Common aliases for field names
const FIELD_ALIASES: Record<string, string[]> = {
  client_type: ['client_type', 'type', 'category'],
  name: ['name', 'client_name', 'insurer_name'],
  trading_name: ['trading_name', 'trading_as', 'doing_business_as', 'dba'],
  abn: ['abn', 'australian_business_number'],
  submission_email: ['submission_email', 'email', 'reports_email'],
  contact_phone: ['contact_phone', 'phone', 'contact_number'],
  address: ['address', 'street_address', 'location'],
  kpi_contact_hours: ['kpi_contact_hours', 'contact_hours', 'contact_kpi'],
  kpi_booking_hours: ['kpi_booking_hours', 'booking_hours', 'booking_kpi'],
  kpi_visit_days: ['kpi_visit_days', 'visit_days', 'visit_kpi'],
  kpi_report_days: ['kpi_report_days', 'report_days', 'report_kpi'],
  send_booking_confirmation: ['send_booking_confirmation', 'booking_confirmation', 'send_confirmation'],
  status: ['status'],
  notes: ['notes', 'comments'],
}

const NUMERIC_FIELDS: string[] = [
  'kpi_contact_hours',
  'kpi_booking_hours',
  'kpi_visit_days',
  'kpi_report_days',
]

const BOOLEAN_FIELDS: string[] = [
  'send_booking_confirmation',
]

interface CsvRow {
  [key: string]: string
}

interface Mapping {
  csvColumn: string
  clientsField: string
}

export interface ClientsImportRow {
  client_type?: string | null
  name?: string | null
  trading_name?: string | null
  abn?: string | null
  submission_email?: string | null
  contact_phone?: string | null
  address?: string | null
  kpi_contact_hours?: number | null
  kpi_booking_hours?: number | null
  kpi_visit_days?: number | null
  kpi_report_days?: number | null
  send_booking_confirmation?: boolean | null
  status?: string | null
  notes?: string | null
}

interface ClientsCsvImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: ClientsImportRow[]) => Promise<void>
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

    mappings.push({ csvColumn: csvCol, clientsField: matchedField || '' })
  }

  return mappings
}

export function ClientsCsvImportDialog({ isOpen, onClose, onImport }: ClientsCsvImportDialogProps) {
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping[]>([])
  const [step, setStep] = useState<'input' | 'mapping' | 'preview'>('input')
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<ClientsImportRow[]>([])
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
      updated[index] = { ...updated[index], clientsField: newField }
      return updated
    })
  }

  const generatePreview = useCallback((): ClientsImportRow[] => {
    return parsedRows.map(row => {
      const item: ClientsImportRow = {}

      for (const map of mapping) {
        if (!map.clientsField) continue
        const value = row[map.csvColumn] || ''

        if (NUMERIC_FIELDS.includes(map.clientsField)) {
          const cleaned = value.replace(/[^0-9.-]+/g, '').trim()
          if (cleaned !== '') {
            const num = parseFloat(cleaned)
            if (!isNaN(num)) {
              (item as any)[map.clientsField] = num
            }
          }
        } else if (BOOLEAN_FIELDS.includes(map.clientsField)) {
          const normalized = value.toLowerCase().trim()
          if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') {
            (item as any)[map.clientsField] = true
          } else if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') {
            (item as any)[map.clientsField] = false
          }
        } else {
          const trimmed = value.trim()
          if (trimmed !== '') {
            (item as any)[map.clientsField] = trimmed
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
          Import Clients from CSV
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
                placeholder={`Client Type,Name,Trading Name,ABN,Submission Email,Contact Phone,Address
Insurer,Allianz,Allianz Australia Limited,51180387220,reports@allianz.com.au,13000000000,123 George St Sydney
Adjuster Firm,Sedgwick,Sedgwick Australia Pty Ltd,60680287545,claims@sedgwick.com.au,13000000000,456 Pitt St Sydney`}
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
              Map your CSV columns to clients fields. Required fields are marked with *.
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
                          value={mapping[idx]?.clientsField || ''}
                          onChange={e => handleMappingChange(idx, e.target.value)}
                          style={{ padding: 6, fontSize: 12, border: '1px solid #e0dbd4', borderRadius: 4, minWidth: 160 }}
                        >
                          <option value="">-- Ignore --</option>
                          {CLIENTS_FIELDS.map(field => (
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
              {previewItems.length} client{previewItems.length !== 1 ? 's' : ''} ready to import
            </p>

            <div style={{ marginBottom: 16, maxHeight: 320, overflow: 'auto', border: '1px solid #e0dbd4', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Type</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Name</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Trading Name</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Email</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Phone</th>
                    <th style={{ padding: 8, textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.slice(0, 20).map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e0dbd4' }}>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.client_type || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.name || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.trading_name || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.submission_email || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.contact_phone || '-'}</td>
                      <td style={{ padding: 8, color: '#3a3530' }}>{item.status || '-'}</td>
                    </tr>
                  ))}
                  {previewItems.length > 20 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 8, textAlign: 'center', color: '#9e998f' }}>
                        ... and {previewItems.length - 20} more clients
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
                {importing ? 'Importing...' : `Import ${previewItems.length} Client${previewItems.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
