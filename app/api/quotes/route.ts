import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const tenantId = searchParams.get('tenantId')

  if (!jobId || !tenantId) {
    return NextResponse.json({ error: 'Missing jobId or tenantId' }, { status: 400 })
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

      return { ...quote, item_count: itemCount, room_summary: roomSummary }
    })
  )

  return NextResponse.json(quotesWithMeta)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { jobId, tenantId, quoteType = 'additional_works' } = body as {
    jobId: string
    tenantId: string
    quoteType?: string
  }

  if (!jobId || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('job_number')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const { count } = await supabase
    .from('quotes')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)

  const seq = String((count ?? 0) + 1).padStart(3, '0')
  const quoteRef = `Q-${job.job_number}-${seq}`

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenantId,
      job_id: jobId,
      quote_ref: quoteRef,
      quote_type: quoteType,
      status: 'draft',
      is_active_version: true,
      is_locked: false,
      markup_pct: 0.19,
      gst_pct: 0.10,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(quote, { status: 201 })
}
