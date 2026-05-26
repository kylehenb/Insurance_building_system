import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { ScopeLibraryItem, ScopeLibraryOverride, PricingTiers } from '@/lib/types/scope-library'
import type { Database } from '@/lib/supabase/database.types'

type OverrideRow = Database['public']['Tables']['scope_library_overrides']['Row']
type LibraryRow = Database['public']['Tables']['scope_library']['Row']

interface OverrideWithInsurer extends OverrideRow {
  insurer: { id: string; trading_name: string | null; name: string } | null
}

export async function GET(request: NextRequest) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id

  const { searchParams } = new URL(request.url)
  const tradeFilter = searchParams.get('trade')
  const insurerIdFilter = searchParams.get('insurer_id')
  const searchFilter = searchParams.get('search')

  const supabase = createServiceClient()

  let query = supabase
    .from('scope_library')
    .select('*')
    .eq('tenant_id', tenantId)
    .neq('approval_status', 'archived')
    .order('trade', { ascending: true })
    .order('item_description', { ascending: true })

  if (tradeFilter) {
    query = query.eq('trade', tradeFilter)
  }

  if (searchFilter) {
    query = query.or(
      `item_description.ilike.%${searchFilter}%,keyword.ilike.%${searchFilter}%`
    )
  }

  const { data: rows, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const libraryRows = (rows ?? []) as LibraryRow[]

  if (libraryRows.length === 0) {
    return NextResponse.json([])
  }

  const itemIds = libraryRows.map((r) => r.id)

  let overridesQuery = supabase
    .from('scope_library_overrides')
    .select('*, insurer:clients(id, trading_name, name)')
    .eq('tenant_id', tenantId)
    .in('scope_library_id', itemIds)

  if (insurerIdFilter) {
    overridesQuery = overridesQuery.eq('insurer_id', insurerIdFilter)
  }

  const { data: overrideRows, error: overridesError } = await overridesQuery

  if (overridesError) {
    return NextResponse.json({ error: overridesError.message }, { status: 500 })
  }

  const typedOverrides = (overrideRows ?? []) as OverrideWithInsurer[]

  const overridesByItemId = new Map<string, ScopeLibraryOverride[]>()
  for (const ov of typedOverrides) {
    const mapped: ScopeLibraryOverride = {
      id: ov.id,
      tenant_id: ov.tenant_id,
      scope_library_id: ov.scope_library_id,
      insurer_id: ov.insurer_id,
      labour_per_unit: ov.labour_per_unit,
      materials_per_unit: ov.materials_per_unit,
      total_per_unit: ov.total_per_unit,
      pricing_tiers: ov.pricing_tiers as PricingTiers | null,
      split_format: ov.split_format ?? false,
      wording_single: ov.wording_single,
      wording_labour: ov.wording_labour,
      wording_materials: ov.wording_materials,
      imported_at: ov.imported_at,
      import_source: ov.import_source,
      insurer: ov.insurer ?? undefined,
    }
    const existing = overridesByItemId.get(ov.scope_library_id) ?? []
    existing.push(mapped)
    overridesByItemId.set(ov.scope_library_id, existing)
  }

  const items: ScopeLibraryItem[] = libraryRows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    trade: row.trade,
    keyword: row.keyword,
    site_notes: row.site_notes,
    item_description: row.item_description,
    unit: row.unit,
    labour_per_unit: row.labour_per_unit,
    materials_per_unit: row.materials_per_unit,
    total_per_unit: row.total_per_unit,
    pricing_tiers: row.pricing_tiers as PricingTiers | null,
    estimated_hours: row.estimated_hours,
    price_updated_at: row.price_updated_at,
    is_draft: row.is_draft ?? false,
    draft_source_quote_id: row.draft_source_quote_id,
    draft_source_job_ref: row.draft_source_job_ref,
    updated_at: row.updated_at,
    overrides: overridesByItemId.get(row.id) ?? [],
  }))

  return NextResponse.json(items)
}

export async function POST(request: NextRequest) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id

  const body: {
    trade?: string | null
    keyword?: string | null
    item_description?: string | null
    unit?: string | null
    labour_per_unit?: number | null
    materials_per_unit?: number | null
    total_per_unit?: number | null
    estimated_hours?: number | null
    site_notes?: string | null
    pricing_tiers?: PricingTiers | null
  } = await request.json()

  const supabase = createServiceClient()

  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('scope_library')
    .insert({
      tenant_id: tenantId,
      trade: body.trade ?? null,
      keyword: body.keyword ?? null,
      item_description: body.item_description ?? null,
      unit: body.unit ?? null,
      labour_per_unit: body.labour_per_unit ?? null,
      materials_per_unit: body.materials_per_unit ?? null,
      total_per_unit: body.total_per_unit ?? null,
      estimated_hours: body.estimated_hours ?? null,
      site_notes: body.site_notes ?? null,
      pricing_tiers: (body.pricing_tiers as Database['public']['Tables']['scope_library']['Insert']['pricing_tiers']) ?? null,
      price_updated_at: today,
      is_draft: false,
      approval_status: 'approved',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const row = data as LibraryRow
  const item: ScopeLibraryItem = {
    id: row.id,
    tenant_id: row.tenant_id,
    trade: row.trade,
    keyword: row.keyword,
    site_notes: row.site_notes,
    item_description: row.item_description,
    unit: row.unit,
    labour_per_unit: row.labour_per_unit,
    materials_per_unit: row.materials_per_unit,
    total_per_unit: row.total_per_unit,
    pricing_tiers: row.pricing_tiers as PricingTiers | null,
    estimated_hours: row.estimated_hours,
    price_updated_at: row.price_updated_at,
    is_draft: row.is_draft ?? false,
    draft_source_quote_id: row.draft_source_quote_id,
    draft_source_job_ref: row.draft_source_job_ref,
    updated_at: row.updated_at,
    overrides: [],
  }

  return NextResponse.json(item, { status: 201 })
}
