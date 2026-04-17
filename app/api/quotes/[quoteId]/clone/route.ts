import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId } = body as { tenantId: string }

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Get the original quote
  const { data: originalQuote, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (quoteError || !originalQuote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  // Get all scope items for the original quote
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ error: 'Failed to fetch scope items' }, { status: 500 })
  }

  // Calculate the new version number
  const newVersion = (originalQuote.version ?? 1) + 1

  // Create the new quote (clone)
  const { data: newQuote, error: createError } = await supabase
    .from('quotes')
    .insert({
      tenant_id: originalQuote.tenant_id,
      job_id: originalQuote.job_id,
      inspection_id: originalQuote.inspection_id,
      report_id: originalQuote.report_id,
      parent_quote_id: originalQuote.id,
      quote_ref: originalQuote.quote_ref,
      quote_type: originalQuote.quote_type,
      version: newVersion,
      is_active_version: true,
      is_locked: false,
      status: 'draft',
      approved_amount: originalQuote.approved_amount,
      approval_notes: originalQuote.approval_notes,
      raw_scope_notes: originalQuote.raw_scope_notes,
      total_amount: originalQuote.total_amount,
      markup_pct: originalQuote.markup_pct,
      gst_pct: originalQuote.gst_pct,
      notes: originalQuote.notes,
    })
    .select('*')
    .single()

  if (createError || !newQuote) {
    return NextResponse.json({ error: 'Failed to create new quote' }, { status: 500 })
  }

  // Clone all scope items to the new quote
  if (scopeItems && scopeItems.length > 0) {
    const itemsToInsert = scopeItems.map(item => ({
      tenant_id: item.tenant_id,
      quote_id: newQuote.id,
      scope_library_id: item.scope_library_id,
      room: item.room,
      room_length: item.room_length,
      room_width: item.room_width,
      room_height: item.room_height,
      trade: item.trade,
      keyword: item.keyword,
      item_description: item.item_description,
      unit: item.unit,
      qty: item.qty,
      rate_labour: item.rate_labour,
      rate_materials: item.rate_materials,
      rate_total: item.rate_total,
      line_total: item.line_total,
      split_type: item.split_type,
      approval_status: item.approval_status,
      is_custom: item.is_custom,
      library_writeback_approved: item.library_writeback_approved,
      sort_order: item.sort_order,
    }))

    const { error: insertItemsError } = await supabase
      .from('scope_items')
      .insert(itemsToInsert)

    if (insertItemsError) {
      return NextResponse.json({ error: 'Failed to clone scope items' }, { status: 500 })
    }
  }

  // Update the original quote to declined_superseded and inactive
  const { error: updateError } = await supabase
    .from('quotes')
    .update({
      status: 'declined_superseded',
      is_active_version: false,
    })
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update original quote' }, { status: 500 })
  }

  return NextResponse.json(newQuote, { status: 201 })
}
