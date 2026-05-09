import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await params
    const { tenantId } = await req.json()

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch inspection with related data
    const { data: inspection, error: inspError } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .eq('tenant_id', tenantId)
      .single()

    if (inspError || !inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    // Fetch core report and quote
    const { data: coreReport } = inspection.report_id
      ? await supabase.from('reports').select('*').eq('id', inspection.report_id).single()
      : { data: null }

    const { data: coreQuote } = inspection.quote_id
      ? await supabase.from('quotes').select('*').eq('id', inspection.quote_id).single()
      : { data: null }

    // Fetch additional reports
    const { data: additionalReports } = await supabase
      .from('reports')
      .select('*')
      .eq('inspection_id', inspectionId)
      .neq('id', inspection.report_id || '')
      .order('created_at', { ascending: true })

    // Validate that core package exists
    if (!coreReport || !coreQuote) {
      return NextResponse.json(
        { error: 'Core package (BAR report and quote) must be created before submitting' },
        { status: 400 }
      )
    }

    // Validate that core report and quote are in ready state
    if (coreReport.status !== 'complete' && coreReport.status !== 'draft') {
      return NextResponse.json(
        { error: 'BAR report must be in complete or draft status' },
        { status: 400 }
      )
    }

    if (coreQuote.status !== 'ready' && coreQuote.status !== 'draft') {
      return NextResponse.json(
        { error: 'Quote must be in ready or draft status' },
        { status: 400 }
      )
    }

    // Update core report status to 'sent' and lock it
    const { error: reportUpdateError } = await supabase
      .from('reports')
      .update({ status: 'sent', is_locked: true })
      .eq('id', coreReport.id)

    if (reportUpdateError) {
      console.error('[inspection submit] report update error:', reportUpdateError)
      return NextResponse.json({ error: 'Failed to update report status' }, { status: 500 })
    }

    // Update core quote status to 'sent' and lock it
    const { error: quoteUpdateError } = await supabase
      .from('quotes')
      .update({ status: 'sent', is_locked: true })
      .eq('id', coreQuote.id)

    if (quoteUpdateError) {
      console.error('[inspection submit] quote update error:', quoteUpdateError)
      return NextResponse.json({ error: 'Failed to update quote status' }, { status: 500 })
    }

    // Update inspection status to 'submitted'
    const { error: inspUpdateError } = await supabase
      .from('inspections')
      .update({ status: 'submitted' })
      .eq('id', inspectionId)

    if (inspUpdateError) {
      console.error('[inspection submit] inspection update error:', inspUpdateError)
      return NextResponse.json({ error: 'Failed to update inspection status' }, { status: 500 })
    }

    // Update additional reports status to 'sent' if they exist
    if (additionalReports && additionalReports.length > 0) {
      const { error: additionalReportsError } = await supabase
        .from('reports')
        .update({ status: 'sent', is_locked: true })
        .in('id', additionalReports.map((r: any) => r.id))

      if (additionalReportsError) {
        console.error('[inspection submit] additional reports update error:', additionalReportsError)
        // Don't fail the whole operation if additional reports fail
      }
    }

    // TODO: Generate and send email to insurer with compiled package
    // This would involve:
    // 1. Generating PDFs for reports and quotes
    // 2. Compiling them into a single package
    // 3. Sending via Gmail compose window with proper routing

    return NextResponse.json({
      success: true,
      message: 'Inspection package submitted successfully',
      inspectionId,
      reportId: coreReport.id,
      quoteId: coreQuote.id,
    })
  } catch (err) {
    console.error('[inspection submit] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
