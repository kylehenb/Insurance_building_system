import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

type QuoteUpdate = Database['public']['Tables']['quotes']['Update']

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const tenantId = req.nextUrl.searchParams.get('tenantId')

  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: items } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({ ...quote, items: items ?? [] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId, ...updates } = body as Record<string, unknown>

  const allowed: (keyof QuoteUpdate)[] = [
    'markup_pct',
    'gst_pct',
    'status',
    'notes',
    'is_locked',
    'total_amount',
    'permit_block_dismissed',
  ]
  const safeUpdates: QuoteUpdate = {}
  for (const key of allowed) {
    if (key in updates) {
      ;(safeUpdates as Record<string, unknown>)[key] = updates[key]
    }
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('quotes')
    .update(safeUpdates)
    .eq('id', quoteId)
    .eq('tenant_id', tenantId as string)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const { tenantId } = (await req.json()) as { tenantId: string }

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('quotes')
    .update({ is_active_version: false })
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
