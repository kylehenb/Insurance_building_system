import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { ScopeLibraryItem, PricingTiers } from '@/lib/types/scope-library'
import type { Database } from '@/lib/supabase/database.types'

type LibraryRow = Database['public']['Tables']['scope_library']['Row']

const PRICE_FIELDS = ['labour_per_unit', 'materials_per_unit', 'total_per_unit', 'pricing_tiers'] as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const userId = session.session?.user.id ?? null

  const { id } = await params

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
    price_updated_at?: string | null
    is_draft?: boolean | null
    approval_status?: string | null
    draft_source_quote_id?: string | null
    draft_source_job_ref?: string | null
  } = await request.json()

  const supabase = createServiceClient()

  // Fetch current row for history snapshot
  const { data: currentRow, error: fetchError } = await supabase
    .from('scope_library')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchError || !currentRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Write history snapshot of before-state
  await supabase.from('scope_library_history').insert({
    tenant_id: tenantId,
    scope_library_id: id,
    snapshot: currentRow as Database['public']['Tables']['scope_library_history']['Insert']['snapshot'],
    changed_by: userId,
    changed_at: new Date().toISOString(),
  })

  // Auto-stamp price_updated_at if price fields changed and caller didn't explicitly pass it
  const typedCurrent = currentRow as LibraryRow
  let priceUpdatedAt = body.price_updated_at
  if (priceUpdatedAt === undefined) {
    const priceChanged = PRICE_FIELDS.some((field) => {
      if (!(field in body)) return false
      if (field === 'pricing_tiers') {
        return JSON.stringify(body.pricing_tiers) !== JSON.stringify(typedCurrent.pricing_tiers)
      }
      return body[field] !== typedCurrent[field]
    })
    if (priceChanged) {
      priceUpdatedAt = new Date().toISOString().slice(0, 10)
    }
  }

  const updatePayload: Database['public']['Tables']['scope_library']['Update'] = {}
  if (body.trade !== undefined) updatePayload.trade = body.trade
  if (body.keyword !== undefined) updatePayload.keyword = body.keyword
  if (body.item_description !== undefined) updatePayload.item_description = body.item_description
  if (body.unit !== undefined) updatePayload.unit = body.unit
  if (body.labour_per_unit !== undefined) updatePayload.labour_per_unit = body.labour_per_unit
  if (body.materials_per_unit !== undefined) updatePayload.materials_per_unit = body.materials_per_unit
  if (body.total_per_unit !== undefined) updatePayload.total_per_unit = body.total_per_unit
  if (body.estimated_hours !== undefined) updatePayload.estimated_hours = body.estimated_hours
  if (body.site_notes !== undefined) updatePayload.site_notes = body.site_notes
  if (body.pricing_tiers !== undefined) {
    updatePayload.pricing_tiers = body.pricing_tiers as Database['public']['Tables']['scope_library']['Update']['pricing_tiers']
  }
  if (body.is_draft !== undefined) updatePayload.is_draft = body.is_draft
  if (body.approval_status !== undefined) updatePayload.approval_status = body.approval_status
  if (body.draft_source_quote_id !== undefined) updatePayload.draft_source_quote_id = body.draft_source_quote_id
  if (body.draft_source_job_ref !== undefined) updatePayload.draft_source_job_ref = body.draft_source_job_ref
  if (priceUpdatedAt !== undefined) updatePayload.price_updated_at = priceUpdatedAt

  const { data: updatedRow, error: updateError } = await supabase
    .from('scope_library')
    .update(updatePayload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const row = updatedRow as LibraryRow
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { id } = await params

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('scope_library')
    .update({ approval_status: 'archived' })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
