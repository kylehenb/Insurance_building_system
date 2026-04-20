import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

/*
Schema change required (run this migration first):

ALTER TABLE trade_type_sequence
  ADD COLUMN IF NOT EXISTS typical_depends_on TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS can_run_concurrent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS typical_lag_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lag_description TEXT;
*/

interface TradeTypeSequence {
  id: string
  tenant_id: string
  trade_type: string
  typical_sequence_order: number | null
  typical_visit_count: number
  notes: string | null
  typical_depends_on: string[]
  typical_comes_before: string[]
  typically_paired_with: string[]
  can_run_concurrent_with: string[]
  cant_run_concurrent_with: string[]
  typical_lag_days: number
  lag_description: string | null
  updated_at: string
  created_at: string
}

// Default seed values for documentation purposes only
// This upsert can be run manually to restore IRC defaults
const defaultSeedValues: Omit<TradeTypeSequence, 'id' | 'tenant_id' | 'updated_at' | 'created_at'>[] = [
  {
    trade_type: 'Builder',
    typical_sequence_order: 10,
    typical_visit_count: 1,
    notes: 'Structural work, framing, general building',
    typical_depends_on: [],
    typical_comes_before: [],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Cabinet Maker',
    typical_sequence_order: 40,
    typical_visit_count: 2,
    notes: 'Kitchen and bathroom joinery; requires disconnect/reconnect from electrician and plumber',
    typical_depends_on: ['demolition', 'plasterer'],
    typical_comes_before: ['tiler', 'painter'],
    typically_paired_with: ['Electrician', 'Plumber'],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Carpenter',
    typical_sequence_order: 35,
    typical_visit_count: 2,
    notes: 'Skirting, doors, shelving, architraves',
    typical_depends_on: ['plasterer'],
    typical_comes_before: ['painter', 'floorer'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Carpet Layer',
    typical_sequence_order: 70,
    typical_visit_count: 1,
    notes: 'Carpet and underlay installation',
    typical_depends_on: ['painter', 'tiler'],
    typical_comes_before: [],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Ceiling Fixer',
    typical_sequence_order: 25,
    typical_visit_count: 2,
    notes: 'Ceiling repairs, cornice, insulation',
    typical_depends_on: ['demolition'],
    typical_comes_before: ['plasterer', 'painter'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Cleaner',
    typical_sequence_order: 90,
    typical_visit_count: 1,
    notes: 'Final builders clean',
    typical_depends_on: ['painter', 'tiler', 'floorer'],
    typical_comes_before: [],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Electrician',
    typical_sequence_order: 15,
    typical_visit_count: 2,
    notes: 'Disconnect first visit; reconnect last visit; lighting, power points, appliances',
    typical_depends_on: [],
    typical_comes_before: ['plasterer', 'painter', 'Cabinet Maker'],
    typically_paired_with: ['Cabinet Maker', 'Plumber'],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Fencer',
    typical_sequence_order: 20,
    typical_visit_count: 1,
    notes: 'Fence repairs and replacement',
    typical_depends_on: [],
    typical_comes_before: [],
    typically_paired_with: [],
    can_run_concurrent_with: ['demolition', 'landscaper'],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Floorer',
    typical_sequence_order: 65,
    typical_visit_count: 1,
    notes: 'Timber flooring, vinyl, laminate',
    typical_depends_on: ['plasterer', 'tiler'],
    typical_comes_before: ['painter'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Glazier',
    typical_sequence_order: 30,
    typical_visit_count: 1,
    notes: 'Window and glass replacement',
    typical_depends_on: ['demolition'],
    typical_comes_before: ['plasterer', 'painter'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Painter',
    typical_sequence_order: 60,
    typical_visit_count: 2,
    notes: 'Internal and external painting; check lag complete before painting',
    typical_depends_on: ['plasterer', 'carpenter', 'tiler', 'Glazier'],
    typical_comes_before: ['Cleaner', 'Carpet Layer'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Plasterer',
    typical_sequence_order: 35,
    typical_visit_count: 2,
    notes: 'Strip visit + reinstate visit; wall and ceiling linings',
    typical_depends_on: ['demolition', 'Ceiling Fixer', 'Electrician', 'Plumber'],
    typical_comes_before: ['Carpenter', 'tiler', 'painter'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 14,
    lag_description: 'drying time',
  },
  {
    trade_type: 'Plumber',
    typical_sequence_order: 20,
    typical_visit_count: 2,
    notes: 'Disconnect first visit; reconnect last visit; water supply, drainage, gas',
    typical_depends_on: [],
    typical_comes_before: ['plasterer', 'tiler', 'Cabinet Maker'],
    typically_paired_with: ['Cabinet Maker', 'Electrician'],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Restorer',
    typical_sequence_order: 10,
    typical_visit_count: 1,
    notes: 'Mould remediation, water damage restoration',
    typical_depends_on: [],
    typical_comes_before: ['demolition', 'plasterer'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Roof Plumber',
    typical_sequence_order: 25,
    typical_visit_count: 1,
    notes: 'Roof drainage, guttering, downpipes',
    typical_depends_on: [],
    typical_comes_before: [],
    typically_paired_with: ['Roofer'],
    can_run_concurrent_with: ['Roofer'],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Roof Tiler',
    typical_sequence_order: 25,
    typical_visit_count: 1,
    notes: 'Roof tile repairs and replacement',
    typical_depends_on: [],
    typical_comes_before: [],
    typically_paired_with: [],
    can_run_concurrent_with: ['Roofer', 'Roof Plumber'],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Tiler',
    typical_sequence_order: 50,
    typical_visit_count: 1,
    notes: 'Floor and wall tiling',
    typical_depends_on: ['demolition', 'waterproofing'],
    typical_comes_before: ['painter', 'floorer'],
    typically_paired_with: ['waterproofing'],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 3,
    lag_description: 'grout cure time',
  },
  {
    trade_type: 'Brick Layer',
    typical_sequence_order: 20,
    typical_visit_count: 1,
    notes: 'Brickwork and masonry repairs',
    typical_depends_on: ['demolition'],
    typical_comes_before: ['plasterer', 'Roofer'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Brick Paver',
    typical_sequence_order: 45,
    typical_visit_count: 1,
    notes: 'Paving and driveway repairs',
    typical_depends_on: [],
    typical_comes_before: [],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'Removalist',
    typical_sequence_order: 5,
    typical_visit_count: 1,
    notes: 'Furniture and contents removal',
    typical_depends_on: [],
    typical_comes_before: ['demolition'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'demolition',
    typical_sequence_order: 10,
    typical_visit_count: 1,
    notes: 'Strip out and removal of damaged materials',
    typical_depends_on: ['Removalist'],
    typical_comes_before: ['Builder', 'Ceiling Fixer', 'Plasterer', 'Tiler', 'Brick Layer', 'Roofer'],
    typically_paired_with: [],
    can_run_concurrent_with: [],
    cant_run_concurrent_with: [],
    typical_lag_days: 0,
    lag_description: null,
  },
]

export async function GET(req: NextRequest) {
  try {
    const userSession = await getUser()

    if (!userSession || !userSession.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()

    const { data: rows, error } = await supabase
      .from('trade_type_sequence')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('typical_sequence_order', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('Error fetching trade type sequence:', error)
      return NextResponse.json({ error: 'Failed to fetch trade type sequence' }, { status: 500 })
    }

    return NextResponse.json(rows || [])
  } catch (error) {
    console.error('Error in GET /api/settings/trade-sequence:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userSession = await getUser()

    if (!userSession || !userSession.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()
    const body: TradeTypeSequence[] = await req.json()

    if (!Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be an array' }, { status: 400 })
    }

    // Upsert each row with tenant_id
    const upsertPromises = body.map(row => {
      return supabase
        .from('trade_type_sequence')
        .upsert({
          id: row.id,
          tenant_id: tenantId,
          trade_type: row.trade_type,
          typical_sequence_order: row.typical_sequence_order,
          typical_visit_count: row.typical_visit_count,
          notes: row.notes,
          typical_depends_on: row.typical_depends_on,
          typical_comes_before: row.typical_comes_before,
          typically_paired_with: row.typically_paired_with,
          can_run_concurrent_with: row.can_run_concurrent_with,
          cant_run_concurrent_with: row.cant_run_concurrent_with,
          typical_lag_days: row.typical_lag_days,
          lag_description: row.lag_description,
        } as any, {
          onConflict: 'tenant_id,trade_type'
        })
    })

    const results = await Promise.all(upsertPromises)
    const errors = results.filter(result => result.error !== null)

    if (errors.length > 0) {
      console.error('Errors upserting trade type sequence:', errors)
      return NextResponse.json({ error: 'Failed to save trade type sequence' }, { status: 500 })
    }

    // Return the updated rows
    const { data: updatedRows, error: fetchError } = await supabase
      .from('trade_type_sequence')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('typical_sequence_order', { ascending: true, nullsFirst: false })

    if (fetchError) {
      console.error('Error fetching updated rows:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch updated rows' }, { status: 500 })
    }

    return NextResponse.json(updatedRows || [])
  } catch (error) {
    console.error('Error in PATCH /api/settings/trade-sequence:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
