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
  can_run_concurrent: boolean
  typical_lag_days: number
  lag_description: string | null
  updated_at: string
  created_at: string
}

// Default seed values for documentation purposes only
// This upsert can be run manually to restore IRC defaults
const defaultSeedValues: Omit<TradeTypeSequence, 'id' | 'tenant_id' | 'updated_at' | 'created_at'>[] = [
  {
    trade_type: 'electrician',
    typical_sequence_order: 10,
    typical_visit_count: 2,
    notes: 'Disconnect first visit; reconnect last visit',
    typical_depends_on: [],
    can_run_concurrent: false,
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'plumber',
    typical_sequence_order: 15,
    typical_visit_count: 2,
    notes: 'Disconnect first visit; reconnect last visit',
    typical_depends_on: [],
    can_run_concurrent: false,
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'demolition',
    typical_sequence_order: 20,
    typical_visit_count: 1,
    notes: null,
    typical_depends_on: [],
    can_run_concurrent: false,
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'roofer',
    typical_sequence_order: 25,
    typical_visit_count: 1,
    notes: 'Often independent; can run concurrent',
    typical_depends_on: [],
    can_run_concurrent: true,
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'plasterer',
    typical_sequence_order: 30,
    typical_visit_count: 2,
    notes: 'Strip visit + reinstate visit; lag between',
    typical_depends_on: ['demolition', 'electrician', 'plumber'],
    can_run_concurrent: false,
    typical_lag_days: 14,
    lag_description: 'drying time',
  },
  {
    trade_type: 'carpenter',
    typical_sequence_order: 40,
    typical_visit_count: 1,
    notes: null,
    typical_depends_on: ['plasterer'],
    can_run_concurrent: false,
    typical_lag_days: 0,
    lag_description: null,
  },
  {
    trade_type: 'tiler',
    typical_sequence_order: 50,
    typical_visit_count: 1,
    notes: null,
    typical_depends_on: ['demolition'],
    can_run_concurrent: false,
    typical_lag_days: 3,
    lag_description: 'grout cure time',
  },
  {
    trade_type: 'painter',
    typical_sequence_order: 60,
    typical_visit_count: 1,
    notes: 'Follows plasterer; check lag complete',
    typical_depends_on: ['plasterer', 'carpenter', 'tiler'],
    can_run_concurrent: false,
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
          can_run_concurrent: row.can_run_concurrent,
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
