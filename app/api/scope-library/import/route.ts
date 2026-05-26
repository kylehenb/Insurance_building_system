import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { Database } from '@/lib/supabase/database.types'

type LibraryRow = Database['public']['Tables']['scope_library']['Row']

interface CsvRow {
  keyword: string
  description: string
  unit: string
  labour: string
  materials: string
  total: string
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length < 2) return []

  const headerLine = nonEmpty[0]
  const headers = parseCsvLine(headerLine).map((h) => h.toLowerCase().trim())

  const keywordIdx = headers.indexOf('keyword')
  const descIdx = headers.indexOf('description')
  const unitIdx = headers.indexOf('unit')
  const labourIdx = headers.indexOf('labour')
  const materialsIdx = headers.indexOf('materials')
  const totalIdx = headers.indexOf('total')

  const rows: CsvRow[] = []
  for (let i = 1; i < nonEmpty.length; i++) {
    const fields = parseCsvLine(nonEmpty[i])
    rows.push({
      keyword: keywordIdx >= 0 ? (fields[keywordIdx] ?? '') : '',
      description: descIdx >= 0 ? (fields[descIdx] ?? '') : '',
      unit: unitIdx >= 0 ? (fields[unitIdx] ?? '') : '',
      labour: labourIdx >= 0 ? (fields[labourIdx] ?? '') : '',
      materials: materialsIdx >= 0 ? (fields[materialsIdx] ?? '') : '',
      total: totalIdx >= 0 ? (fields[totalIdx] ?? '') : '',
    })
  }
  return rows
}

export async function POST(request: NextRequest) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id

  const formData = await request.formData()
  const file = formData.get('file')
  const insurerId = formData.get('insurer_id')

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!insurerId || typeof insurerId !== 'string') {
    return NextResponse.json({ error: 'No insurer_id provided' }, { status: 400 })
  }

  const text = await (file as File).text()
  const csvRows = parseCsv(text)

  if (csvRows.length === 0) {
    return NextResponse.json({ updated: 0, unmatched: [] })
  }

  const supabase = createServiceClient()

  // Fetch all non-archived items for this tenant
  const { data: libraryItems, error: fetchError } = await supabase
    .from('scope_library')
    .select('id, keyword')
    .eq('tenant_id', tenantId)
    .neq('approval_status', 'archived')

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const rows = (libraryItems ?? []) as Pick<LibraryRow, 'id' | 'keyword'>[]
  const keywordMap = new Map<string, string>()
  for (const row of rows) {
    if (row.keyword) {
      keywordMap.set(row.keyword.toLowerCase(), row.id)
    }
  }

  let updated = 0
  const unmatched: CsvRow[] = []

  for (const csvRow of csvRows) {
    const matchId = keywordMap.get(csvRow.keyword.toLowerCase())
    if (!matchId) {
      unmatched.push(csvRow)
      continue
    }

    const labourVal = parseFloat(csvRow.labour) || null
    const materialsVal = parseFloat(csvRow.materials) || null
    const totalVal = parseFloat(csvRow.total) || null

    const { error: upsertError } = await supabase
      .from('scope_library_overrides')
      .upsert(
        {
          tenant_id: tenantId,
          scope_library_id: matchId,
          insurer_id: insurerId,
          labour_per_unit: labourVal,
          materials_per_unit: materialsVal,
          total_per_unit: totalVal,
          import_source: 'csv',
          imported_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'tenant_id,scope_library_id,insurer_id',
        }
      )

    if (!upsertError) {
      updated++
    }
  }

  return NextResponse.json({ updated, unmatched })
}
