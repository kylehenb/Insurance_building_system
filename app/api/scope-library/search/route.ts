import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function formatRefDate(isoStr: string | null): string | null {
  if (!isoStr) return null
  const d = new Date(isoStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')

  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })

  const supabase = createServiceClient()

  // ── Library items ────────────────────────────────────────────────────────
  const { data: libData, error: libError } = await supabase
    .from('scope_library')
    .select(
      'id, insurer_specific, trade, keyword, item_description, unit, labour_per_unit, materials_per_unit, total_per_unit, trade_rate_total, estimated_hours'
    )
    .eq('tenant_id', tenantId)
    .neq('approval_status', 'archived')
    .order('item_description')

  if (libError) return NextResponse.json({ error: libError.message }, { status: 500 })

  const libraryResults = (libData ?? []).map(item => ({
    result_type: 'library' as const,
    id: item.id,
    item_description: item.item_description,
    unit: item.unit,
    rate_labour: item.labour_per_unit,
    rate_materials: item.materials_per_unit,
    rate_total: item.total_per_unit,
    trade: item.trade,
    keyword: item.keyword,
    insurer_specific: item.insurer_specific,
    trade_rate_total: item.trade_rate_total,
    estimated_hours: item.estimated_hours,
    quote_ref: null,
    job_number: null,
    reference_date: null,
  }))

  // ── Reference items from scope_items ─────────────────────────────────────
  const { data: refRaw } = await supabase
    .from('scope_items')
    .select('id, item_description, unit, rate_labour, rate_materials, rate_total, trade, created_at, quote_id')
    .eq('tenant_id', tenantId)
    .eq('is_reference', true)
    .order('item_description')
    .order('created_at', { ascending: false })
    .limit(200)

  // Deduplicate by description — first occurrence is most recent (ordered by created_at DESC within each description)
  const seen = new Set<string>()
  const deduped = (refRaw ?? []).filter(item => {
    const desc = (item.item_description ?? '').toLowerCase()
    if (seen.has(desc)) return false
    seen.add(desc)
    return true
  })

  // Batch-fetch quotes
  const quoteIds = [...new Set(deduped.map(i => i.quote_id).filter((id): id is string => id != null))]
  const quoteMap = new Map<string, { quote_ref: string | null; job_id: string }>()

  if (quoteIds.length > 0) {
    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, quote_ref, job_id')
      .in('id', quoteIds)

    for (const q of quotes ?? []) {
      quoteMap.set(q.id, { quote_ref: q.quote_ref, job_id: q.job_id })
    }
  }

  // Batch-fetch jobs
  const jobIds = [...new Set([...quoteMap.values()].map(q => q.job_id).filter((id): id is string => id != null))]
  const jobMap = new Map<string, string>()

  if (jobIds.length > 0) {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, job_number')
      .in('id', jobIds)

    for (const j of jobs ?? []) {
      jobMap.set(j.id, j.job_number)
    }
  }

  const referenceResults = deduped.map(item => {
    const quote = quoteMap.get(item.quote_id ?? '')
    const jobNumber = quote ? (jobMap.get(quote.job_id) ?? null) : null
    return {
      result_type: 'reference' as const,
      id: item.id,
      item_description: item.item_description,
      unit: item.unit,
      rate_labour: item.rate_labour,
      rate_materials: item.rate_materials,
      rate_total: item.rate_total,
      trade: item.trade,
      keyword: null,
      insurer_specific: null,
      trade_rate_total: null,
      estimated_hours: null,
      quote_ref: quote?.quote_ref ?? null,
      job_number: jobNumber,
      reference_date: formatRefDate(item.created_at),
    }
  })

  return NextResponse.json([...libraryResults, ...referenceResults], {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
