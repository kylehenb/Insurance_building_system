import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const tenantId = req.nextUrl.searchParams.get('tenantId')

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Get the current quote to find its quote_ref
  const { data: currentQuote, error: quoteError } = await supabase
    .from('quotes')
    .select('quote_ref')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (quoteError || !currentQuote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  // Fetch all quotes with the same quote_ref (all versions)
  const { data: allVersions, error: versionsError } = await supabase
    .from('quotes')
    .select('*')
    .eq('quote_ref', currentQuote.quote_ref!)
    .eq('tenant_id', tenantId)
    .order('version', { ascending: true })

  if (versionsError) {
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 })
  }

  // Fetch item counts for each version
  const versionsWithCounts = await Promise.all(
    (allVersions ?? []).map(async (quote) => {
      const { count } = await supabase
        .from('scope_items')
        .select('*', { count: 'exact', head: true })
        .eq('quote_id', quote.id)
        .eq('tenant_id', tenantId)

      return {
        ...quote,
        item_count: count ?? 0,
      }
    })
  )

  return NextResponse.json(versionsWithCounts)
}
