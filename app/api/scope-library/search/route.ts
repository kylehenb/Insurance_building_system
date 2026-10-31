import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { loadJobInsurer, loadScopeCatalogue } from '@/lib/scope-library/catalogue'
import { usesByItem } from '@/lib/scope-library/search'

function formatRefDate(isoStr: string | null): string | null {
  if (!isoStr) return null
  const d = new Date(isoStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  // ── Library items: what this job can pick, at its insurer's prices ──────
  const jobId = req.nextUrl.searchParams.get('jobId')
  let catalogue
  try {
    catalogue = await loadScopeCatalogue(supabase, tenantId, await loadJobInsurer(supabase, tenantId, jobId))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load the scope library' }, { status: 500 })
  }

  // How often each item is used, so the everyday items lead the search. Without it the search still works.
  const { data: usage, error: usageError } = await supabase.rpc('scope_library_usage', { p_tenant_id: tenantId })
  if (usageError) console.error('scope_library_usage', usageError.message)
  const uses = usesByItem(catalogue, usage ?? [])

  const libraryResults = catalogue.map(item => ({
    result_type: 'library' as const, id: item.id, item_description: item.item_description, unit: item.unit, rate_labour: item.rate_labour, rate_materials: item.rate_materials, rate_total: item.rate_labour == null && item.rate_materials == null ? null : (item.rate_labour ?? 0) + (item.rate_materials ?? 0), trade: item.trade, keyword: item.keyword, insurer_specific: item.insurer_specific, pending: item.pending, trade_rate_total: item.trade_rate_total, estimated_hours: item.estimated_hours, quote_ref: null, job_number: null, reference_date: null, uses: uses.get(item.id) ?? 0,
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
      result_type: 'reference' as const, id: item.id, item_description: item.item_description, unit: item.unit, rate_labour: item.rate_labour, rate_materials: item.rate_materials, rate_total: item.rate_total, trade: item.trade, keyword: null, insurer_specific: null, pending: false, trade_rate_total: null, estimated_hours: null, quote_ref: quote?.quote_ref ?? null, job_number: jobNumber, reference_date: formatRefDate(item.created_at), uses: 0,
    }
  })

  // Not cached: a change in the scope library shows on the next search
  return NextResponse.json([...libraryResults, ...referenceResults], {
    headers: { 'Cache-Control': 'no-store' },
  })
}
