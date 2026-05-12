import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params
    const body = await req.json() as {
      rawEmailText: string
      rawEmailSubject: string | null
      correctOutput: Record<string, unknown>
      originalOutput: Record<string, unknown>
      fieldsCorrected: string[]
      confirmedGeminiError: boolean
      clientId: string | null
    }

    const {
      rawEmailText,
      rawEmailSubject,
      correctOutput,
      originalOutput,
      fieldsCorrected,
      confirmedGeminiError,
      clientId,
    } = body

    if (!rawEmailText || !correctOutput || !originalOutput || !fieldsCorrected) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch the order to get tenant_id
    const { data: order, error: orderError } = await supabase
      .from('insurer_orders')
      .select('tenant_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const tenantId = order.tenant_id

    // Fetch existing examples for this client, ordered oldest last for cap enforcement
    const query = supabase
      .from('parser_examples')
      .select('id, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (clientId) {
      query.eq('client_id', clientId)
    } else {
      query.is('client_id', null)
    }

    const { data: existing, error: fetchError } = await query

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to fetch existing examples' }, { status: 500 })
    }

    // Enforce 10-example cap: delete oldest if at limit
    if (existing && existing.length >= 10) {
      const oldest = existing[existing.length - 1]
      await supabase.from('parser_examples').delete().eq('id', oldest.id)
    }

    // Insert new example
    const { data: inserted, error: insertError } = await supabase
      .from('parser_examples')
      .insert({
        tenant_id: tenantId,
        client_id: clientId ?? null,
        raw_email_text: rawEmailText,
        raw_email_subject: rawEmailSubject ?? null,
        correct_output: correctOutput,
        original_output: originalOutput,
        fields_corrected: fieldsCorrected,
        confirmed_gemini_error: confirmedGeminiError,
        insurer_order_id: orderId,
      } as never)
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[parser-example] insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save example' }, { status: 500 })
    }

    const totalExamples = existing
      ? (existing.length >= 10 ? 10 : existing.length + 1)
      : 1

    return NextResponse.json({
      success: true,
      exampleId: inserted.id,
      totalExamples,
    })
  } catch (err) {
    console.error('[parser-example] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params
    const clientId = req.nextUrl.searchParams.get('clientId')

    const supabase = createServiceClient()

    // Get tenant_id from order
    const { data: order, error: orderError } = await supabase
      .from('insurer_orders')
      .select('tenant_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const tenantId = order.tenant_id

    const query = supabase
      .from('parser_examples')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (clientId) {
      query.eq('client_id', clientId)
    } else {
      query.is('client_id', null)
    }

    const { data: examples, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ examples: examples ?? [] })
  } catch (err) {
    console.error('[parser-example] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
