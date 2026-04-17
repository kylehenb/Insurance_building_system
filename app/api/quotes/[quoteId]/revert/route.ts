import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId, targetQuoteId } = body as { tenantId: string; targetQuoteId: string }

  if (!tenantId || !targetQuoteId) {
    return NextResponse.json({ error: 'Missing tenantId or targetQuoteId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Get the current quote (the one being reverted from)
  const { data: currentQuote, error: currentError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (currentError || !currentQuote) {
    return NextResponse.json({ error: 'Current quote not found' }, { status: 404 })
  }

  // Get the target quote (the one to revert to)
  const { data: targetQuote, error: targetError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', targetQuoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (targetError || !targetQuote) {
    return NextResponse.json({ error: 'Target quote not found' }, { status: 404 })
  }

  // Verify they have the same quote_ref (they're versions of the same quote)
  if (currentQuote.quote_ref !== targetQuote.quote_ref) {
    return NextResponse.json({ error: 'Quotes must have the same quote_ref' }, { status: 400 })
  }

  // Update the current quote to mark it as superseded
  const { error: updateCurrentError } = await supabase
    .from('quotes')
    .update({
      status: 'declined_superseded',
      is_active_version: false,
    })
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)

  if (updateCurrentError) {
    return NextResponse.json({ error: 'Failed to update current quote' }, { status: 500 })
  }

  // Update the target quote to make it active and draft (so it can be edited)
  const { error: updateTargetError } = await supabase
    .from('quotes')
    .update({
      status: 'draft',
      is_active_version: true,
      is_locked: false,
    })
    .eq('id', targetQuoteId)
    .eq('tenant_id', tenantId)

  if (updateTargetError) {
    return NextResponse.json({ error: 'Failed to update target quote' }, { status: 500 })
  }

  return NextResponse.json({ success: true, quoteId: targetQuoteId })
}
