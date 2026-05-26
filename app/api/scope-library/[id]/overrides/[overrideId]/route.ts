import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { ScopeLibraryOverride, PricingTiers } from '@/lib/types/scope-library'
import type { Database } from '@/lib/supabase/database.types'

type OverrideRow = Database['public']['Tables']['scope_library_overrides']['Row']

interface OverrideWithInsurer extends OverrideRow {
  insurer: { id: string; trading_name: string | null; name: string } | null
}

function mapOverride(ov: OverrideWithInsurer): ScopeLibraryOverride {
  return {
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
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; overrideId: string }> }
) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { overrideId } = await params

  const body: {
    labour_per_unit?: number | null
    materials_per_unit?: number | null
    total_per_unit?: number | null
    pricing_tiers?: PricingTiers | null
    split_format?: boolean | null
    wording_single?: string | null
    wording_labour?: string | null
    wording_materials?: string | null
  } = await request.json()

  const supabase = createServiceClient()

  const updatePayload: Database['public']['Tables']['scope_library_overrides']['Update'] = {
    updated_at: new Date().toISOString(),
  }
  if (body.labour_per_unit !== undefined) updatePayload.labour_per_unit = body.labour_per_unit
  if (body.materials_per_unit !== undefined) updatePayload.materials_per_unit = body.materials_per_unit
  if (body.total_per_unit !== undefined) updatePayload.total_per_unit = body.total_per_unit
  if (body.pricing_tiers !== undefined) {
    updatePayload.pricing_tiers = body.pricing_tiers as Database['public']['Tables']['scope_library_overrides']['Update']['pricing_tiers']
  }
  if (body.split_format !== undefined) updatePayload.split_format = body.split_format
  if (body.wording_single !== undefined) updatePayload.wording_single = body.wording_single
  if (body.wording_labour !== undefined) updatePayload.wording_labour = body.wording_labour
  if (body.wording_materials !== undefined) updatePayload.wording_materials = body.wording_materials

  const { data, error } = await supabase
    .from('scope_library_overrides')
    .update(updatePayload)
    .eq('id', overrideId)
    .eq('tenant_id', tenantId)
    .select('*, insurer:clients(id, trading_name, name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const override = mapOverride(data as OverrideWithInsurer)
  return NextResponse.json(override)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; overrideId: string }> }
) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { overrideId } = await params

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('scope_library_overrides')
    .delete()
    .eq('id', overrideId)
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
