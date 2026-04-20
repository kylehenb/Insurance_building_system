import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { Database } from '@/lib/supabase/database.types'

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

interface RadiusZone {
  id: string
  label: string
  address: string
  lat: number | null
  lng: number | null
  standard_km: number
  extended_km: number
}

interface SuburbTag {
  suburb: string
  state: string
  postcode: string
}

interface SpecificArea {
  id: string
  label: string
  suburbs: SuburbTag[]
  extended_km: number
}

interface CatArea {
  id: string
  label: string
  type: 'state' | 'region'
  states: string[]
  notes: string
  region_description: string
  is_active: boolean
}

interface ServiceAreaConfig {
  radius_zones: RadiusZone[]
  specific_areas: SpecificArea[]
  cat_areas: CatArea[]
}

// Extends the generated TenantRow with columns added by migration
// (trading_name, abn, service_area_config). These are not yet in
// database.types.ts because that file is auto-generated from the
// schema snapshot — update it after running the migration.
type BaseTenantRow = Database['public']['Tables']['tenants']['Row']
type BaseTenantUpdate = Database['public']['Tables']['tenants']['Update']

interface ExtendedTenantRow extends BaseTenantRow {
  trading_name: string | null
  abn: string | null
  service_area_config: ServiceAreaConfig | null
}

interface TenantPatchBody {
  name?: string
  trading_name?: string | null
  abn?: string | null
  job_prefix?: string
  job_sequence?: number | null
  contact_email?: string | null
  contact_phone?: string | null
  address?: string | null
  logo_storage_path?: string | null
  service_area_config?: ServiceAreaConfig | null
}

// -----------------------------------------------------------------
// GET — returns full tenant row + job count for the authenticated user
// -----------------------------------------------------------------
export async function GET() {
  try {
    const userSession = await getUser()

    if (!userSession || !userSession.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()

    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenantData) {
      console.error('Error fetching tenant:', tenantError)
      return NextResponse.json({ error: 'Failed to fetch tenant' }, { status: 500 })
    }

    // Count jobs to determine if job_sequence is editable
    const { count: jobCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)

    return NextResponse.json({
      tenant: tenantData as unknown as ExtendedTenantRow,
      job_count: jobCount ?? 0,
    })
  } catch (err) {
    console.error('Error in GET /api/settings/tenant:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// -----------------------------------------------------------------
// PATCH — accepts partial tenant fields + service_area_config
// -----------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const userSession = await getUser()

    if (!userSession || !userSession.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()
    const body = (await req.json()) as TenantPatchBody

    // Build update payload with only permitted fields
    const updatePayload: Record<string, unknown> = {}
    const allowedFields: (keyof TenantPatchBody)[] = [
      'name',
      'trading_name',
      'abn',
      'job_prefix',
      'job_sequence',
      'contact_email',
      'contact_phone',
      'address',
      'logo_storage_path',
      'service_area_config',
    ]

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updatePayload[field] = body[field]
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Cast through unknown to allow new columns not yet in generated types
    const { data, error } = await supabase
      .from('tenants')
      .update(updatePayload as unknown as BaseTenantUpdate)
      .eq('id', tenantId)
      .select('*')
      .single()

    if (error) {
      console.error('Error updating tenant:', error)
      return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 })
    }

    return NextResponse.json(data as unknown as ExtendedTenantRow)
  } catch (err) {
    console.error('Error in PATCH /api/settings/tenant:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
