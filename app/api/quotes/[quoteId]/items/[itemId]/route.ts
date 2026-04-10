import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

type ScopeItemUpdate = Database['public']['Tables']['scope_items']['Update']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string; itemId: string }> }
) {
  const { quoteId, itemId } = await params
  const body = await req.json()
  const { tenantId, ...rawUpdates } = body as Record<string, unknown>

  const supabase = createServiceClient()

  const updates: ScopeItemUpdate = rawUpdates as ScopeItemUpdate

  const needsRecalc =
    'qty' in rawUpdates || 'rate_labour' in rawUpdates || 'rate_materials' in rawUpdates

  if (needsRecalc) {
    const { data: current } = await supabase
      .from('scope_items')
      .select('qty, rate_labour, rate_materials')
      .eq('id', itemId)
      .eq('quote_id', quoteId)
      .eq('tenant_id', tenantId as string)
      .single()

    const qty =
      'qty' in rawUpdates ? (rawUpdates.qty as number | null) : (current?.qty ?? null)
    const rateLabour =
      'rate_labour' in rawUpdates
        ? (rawUpdates.rate_labour as number | null)
        : (current?.rate_labour ?? null)
    const rateMaterials =
      'rate_materials' in rawUpdates
        ? (rawUpdates.rate_materials as number | null)
        : (current?.rate_materials ?? null)

    const lineTotal =
      qty != null && (rateLabour != null || rateMaterials != null)
        ? qty * ((rateLabour ?? 0) + (rateMaterials ?? 0))
        : null

    updates.line_total = lineTotal
    updates.rate_total =
      rateLabour != null || rateMaterials != null
        ? (rateLabour ?? 0) + (rateMaterials ?? 0)
        : null
  }

  const { data, error } = await supabase
    .from('scope_items')
    .update(updates)
    .eq('id', itemId)
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId as string)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string; itemId: string }> }
) {
  const { quoteId, itemId } = await params
  const { tenantId } = (await req.json()) as { tenantId: string }

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('scope_items')
    .delete()
    .eq('id', itemId)
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
