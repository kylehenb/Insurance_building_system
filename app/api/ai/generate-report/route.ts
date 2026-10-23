import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import { ReportGenerateError, generateReportDraft } from '@/lib/reports/generate'

export const dynamic = 'force-dynamic'

// The report forms' "Generate": raw notes → report fields (lib/reports/generate.ts)
export async function POST(req: NextRequest) {
  // Signed-in users only; the tenant is the session's, never the request's
  const session = await getUser()
  if (!session?.tenant_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { rawReportDump?: string; reportType?: string; reportId?: string | null }
    if (!body.rawReportDump) return NextResponse.json({ error: 'rawReportDump is required' }, { status: 400 })
    if (!body.reportType) return NextResponse.json({ error: 'reportType is required' }, { status: 400 })

    const reportData = await generateReportDraft({
      supabase: createServiceClient(), tenantId: session.tenant_id,
      reportType: body.reportType, rawReportDump: body.rawReportDump, reportId: body.reportId,
    })
    return NextResponse.json({ success: true, reportData })
  } catch (error) {
    if (error instanceof ReportGenerateError) return NextResponse.json({ error: error.message, details: error.details }, { status: 500 })
    console.error('Error generating report:', error)
    return NextResponse.json(
      { error: 'Failed to generate report', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
