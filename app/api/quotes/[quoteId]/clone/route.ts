import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId, cloneType = 'version' } = body as { tenantId: string; cloneType?: 'version' | 'new_quote' }

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

  // Calculate the new version number (only for version clones)
  const newVersion = (originalQuote.version ?? 1) + 1

  // Generate quote_ref for new_quote clones
  let quoteRef = originalQuote.quote_ref
  if (cloneType === 'new_quote') {
    // Get job number to generate new quote_ref
    const { data: job } = await supabase
      .from('jobs')
      .select('job_number')
      .eq('id', originalQuote.job_id)
      .eq('tenant_id', tenantId)
      .single()

    if (job) {
      // Count existing quotes for this job to generate sequence number
      const { count } = await supabase
        .from('quotes')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', originalQuote.job_id)
        .eq('tenant_id', tenantId)

      const seq = String((count ?? 0) + 1).padStart(3, '0')
      quoteRef = `Q-${job.job_number}-${seq}`
    }
  }

  // Create the new quote (clone)
  const { data: newQuote, error: createError } = await supabase
    .from('quotes')
    .insert({
      tenant_id: originalQuote.tenant_id,
      job_id: originalQuote.job_id,
      inspection_id: originalQuote.inspection_id,
      report_id: originalQuote.report_id,
      parent_quote_id: cloneType === 'version' ? originalQuote.id : null,
      quote_ref: quoteRef,
      quote_type: originalQuote.quote_type,
      version: cloneType === 'version' ? newVersion : 1,
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

  // Update the original quote to rejected and inactive (only for version clones)
  if (cloneType === 'version') {
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'rejected',
        is_active_version: false,
      })
      .eq('id', quoteId)
      .eq('tenant_id', tenantId)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update original quote' }, { status: 500 })
    }
  }

  return NextResponse.json(newQuote, { status: 201 })
}
