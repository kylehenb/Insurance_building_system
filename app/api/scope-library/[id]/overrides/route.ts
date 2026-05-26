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

export async function GET(
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
    .from('scope_library_overrides')
    .select('*, insurer:clients(id, trading_name, name)')
    .eq('tenant_id', tenantId)
    .eq('scope_library_id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const overrides = ((data ?? []) as OverrideWithInsurer[]).map(mapOverride)
  return NextResponse.json(overrides)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { id } = await params

  const body: {
    insurer_id: string
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

  const { data, error } = await supabase
    .from('scope_library_overrides')
    .upsert(
      {
        tenant_id: tenantId,
        scope_library_id: id,
        insurer_id: body.insurer_id,
        labour_per_unit: body.labour_per_unit ?? null,
        materials_per_unit: body.materials_per_unit ?? null,
        total_per_unit: body.total_per_unit ?? null,
        pricing_tiers: (body.pricing_tiers as Database['public']['Tables']['scope_library_overrides']['Insert']['pricing_tiers']) ?? null,
        split_format: body.split_format ?? null,
        wording_single: body.wording_single ?? null,
        wording_labour: body.wording_labour ?? null,
        wording_materials: body.wording_materials ?? null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'tenant_id,scope_library_id,insurer_id',
      }
    )
    .select('*, insurer:clients(id, trading_name, name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const override = mapOverride(data as OverrideWithInsurer)
  return NextResponse.json(override, { status: 201 })
}
