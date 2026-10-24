import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { QuoteEditError, createQuote } from '@/lib/quotes/service'

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const tenantId = me.tenantId

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .eq('is_active_version', true)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const quotesWithMeta = await Promise.all(
    (quotes ?? []).map(async (quote) => {
      const { data: items } = await supabase
        .from('scope_items')
        .select('id, room, line_total')
        .eq('quote_id', quote.id)
        .eq('tenant_id', tenantId)

      const itemCount = items?.length ?? 0

      const roomSummary: Record<string, { count: number; subtotal: number }> = {}
      for (const item of items ?? []) {
        const room = item.room ?? 'Unassigned'
        if (!roomSummary[room]) roomSummary[room] = { count: 0, subtotal: 0 }
        roomSummary[room].count++
        roomSummary[room].subtotal += item.line_total ?? 0
      }

      // Calculate total from room subtotals
      const calculatedSubtotal = Object.values(roomSummary).reduce((sum, room) => sum + room.subtotal, 0)
      const calculatedMarkup = calculatedSubtotal * (quote.markup_pct ?? 0.19)
      const calculatedGst = (calculatedSubtotal + calculatedMarkup) * (quote.gst_pct ?? 0.10)
      const calculatedTotal = calculatedSubtotal + calculatedMarkup + calculatedGst

      return {
        ...quote, item_count: itemCount, room_summary: roomSummary, total_amount: calculatedTotal,
      }
    })
  )

  return NextResponse.json(quotesWithMeta)
}

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const body = await req.json()
  const { jobId, quoteType = 'additional_works' } = body as {
    jobId: string
    tenantId: string
    quoteType?: string
  }

  if (!jobId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const quote = await createQuote(createServiceClient(), me.tenantId, { jobId, quoteType })
    return NextResponse.json(quote, { status: 201 })
  } catch (err) {
    if (err instanceof QuoteEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
