import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const { tenantId, orderedIds } = (await req.json()) as {
    tenantId: string
    orderedIds: string[]
  }

  if (!tenantId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Update sort_order for each item in the new order
  const updates = orderedIds.map((id, index) =>
    supabase
      .from('scope_items')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('quote_id', quoteId)
      .eq('tenant_id', tenantId)
  )

  const results = await Promise.all(updates)
  const failed = results.filter(r => r.error)

  if (failed.length > 0) {
    return NextResponse.json({ error: 'Partial update failure' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
