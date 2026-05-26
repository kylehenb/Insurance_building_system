import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { ScopeLibraryItem, PricingTiers } from '@/lib/types/scope-library'
import type { Database } from '@/lib/supabase/database.types'

type LibraryRow = Database['public']['Tables']['scope_library']['Row']

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { id } = await params

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('scope_library')
    .update({
      is_draft: false,
      draft_source_quote_id: null,
      draft_source_job_ref: null,
      approval_status: 'approved',
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
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

  return NextResponse.json(item)
}
