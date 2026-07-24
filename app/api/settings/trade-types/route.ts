import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

const DEFAULT_TRADE_TYPES = [
  'Brick Layer',
  'Brick Paver',
  'Builder',
  'Cabinet Maker',
  'Carpenter',
  'Carpet Layer',
  'Ceiling Fixer',
  'Cleaner',
  'Demolition',
  'Electrician',
  'Fencer',
  'Floorer',
  'Glazier',
  'Painter',
  'Plasterer',
  'Plumber',
  'Removalist',
  'Restorer',
  'Roof Plumber',
  'Roof Tiler',
  'Tiler',
]

export async function GET() {
  const userSession = await getUser()
  if (!userSession?.tenant_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const tenantId = userSession.tenant_id

  const { data: existing, error } = await supabase
    .from('trade_type_sequence')
    .select('id, trade_type')
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const existingNames = new Set((existing ?? []).map(r => r.trade_type.toLowerCase()))
  const missing = DEFAULT_TRADE_TYPES.filter(t => !existingNames.has(t.toLowerCase()))

  if (missing.length > 0) {
    await supabase
      .from('trade_type_sequence')
      .insert(missing.map(trade_type => ({
        tenant_id: tenantId,
        trade_type,
        typical_sequence_order: null,
        typical_visit_count: 1,
        notes: null,
        typical_depends_on: [],
        typical_comes_before: [],
        typically_paired_with: [],
        can_run_concurrent_with: [],
        cant_run_concurrent_with: [],
        typical_lag_days: 0,
        lag_description: null,
      })) as any)
  }

  const { data: all, error: fetchError } = await supabase
    .from('trade_type_sequence')
    .select('id, trade_type')
    .eq('tenant_id', tenantId)
    .order('trade_type', { ascending: true })

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  return NextResponse.json(all ?? [])
}

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trade_type } = await req.json()
  if (!trade_type?.trim()) return NextResponse.json({ error: 'trade_type is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('trade_type_sequence')
    .insert({
      tenant_id: userSession.tenant_id,
      trade_type: trade_type.trim(),
      typical_sequence_order: null,
      typical_visit_count: 1,
      notes: null,
      typical_depends_on: [],
      typical_comes_before: [],
      typically_paired_with: [],
      can_run_concurrent_with: [],
      cant_run_concurrent_with: [],
      typical_lag_days: 0,
      lag_description: null,
    } as any)

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Trade type already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { old_name, new_name } = await req.json()
  if (!old_name?.trim() || !new_name?.trim()) {
    return NextResponse.json({ error: 'old_name and new_name are required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const tenantId = userSession.tenant_id
  const oldName = old_name.trim()
  const newName = new_name.trim()

  const { error: seqError } = await supabase
    .from('trade_type_sequence')
    .update({ trade_type: newName })
    .eq('tenant_id', tenantId)
    .eq('trade_type', oldName)

  if (seqError) return NextResponse.json({ error: seqError.message }, { status: 500 })

  await supabase
    .from('scope_library')
    .update({ trade: newName })
    .eq('tenant_id', tenantId)
    .eq('trade', oldName)

  await supabase
    .from('trades')
    .update({ primary_trade: newName })
    .eq('tenant_id', tenantId)
    .eq('primary_trade', oldName)

  const { data: affectedTrades } = await supabase
    .from('trades')
    .select('id, trade_specialties')
    .eq('tenant_id', tenantId)
    .contains('trade_specialties', [oldName])

  if (affectedTrades?.length) {
    await Promise.all(affectedTrades.map(trade =>
      supabase
        .from('trades')
        .update({
          trade_specialties: (trade.trade_specialties as string[]).map(s => s === oldName ? newName : s),
        })
        .eq('id', trade.id)
    ))
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trade_type } = await req.json()
  if (!trade_type?.trim()) return NextResponse.json({ error: 'trade_type is required' }, { status: 400 })

  const supabase = createServiceClient()
  const tenantId = userSession.tenant_id
  const tradeType = trade_type.trim()

  const { count } = await supabase
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('primary_trade', tradeType)

  const { error } = await supabase
    .from('trade_type_sequence')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('trade_type', tradeType)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase
    .from('scope_library')
    .update({ trade: null })
    .eq('tenant_id', tenantId)
    .eq('trade', tradeType)

  return NextResponse.json({ ok: true, in_use_count: count ?? 0 })
}
