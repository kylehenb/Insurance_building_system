import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  const { data: userRow } = await service
    .from('users')
    .select('tenant_id, name')
    .eq('id', user.id)
    .single()

  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: insp, error } = await service
    .from('inspections')
    .select(`
      id, inspection_ref, status, scheduled_date, scheduled_time,
      job_id, quote_id, inspector_id, person_met, field_draft,
      safety_confirmed_at, form_submitted_at,
      jobs!job_id (
        id, job_number, property_address, insured_name, insured_phone,
        insurer, loss_type, date_of_loss, claim_number, excess
      ),
      users!inspector_id (name)
    `)
    .eq('id', inspectionId)
    .eq('tenant_id', userRow.tenant_id)
    .single()

  if (error || !insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  const job = (insp as any).jobs
  const inspector = (insp as any).users

  // Get active quote number if quote_id exists
  let quoteRef: string | null = null
  if (insp.quote_id) {
    const { data: quote } = await service
      .from('quotes')
      .select('quote_ref')
      .eq('id', insp.quote_id)
      .single()
    quoteRef = (quote as any)?.quote_ref ?? null
  }

  return NextResponse.json({
    inspectionId: insp.id,
    inspectionRef: insp.inspection_ref,
    status: insp.status,
    scheduledDate: insp.scheduled_date,
    scheduledTime: insp.scheduled_time,
    jobId: job?.id ?? null,
    jobNumber: job?.job_number ?? null,
    address: job?.property_address ?? null,
    insuredName: job?.insured_name ?? null,
    insuredPhone: job?.insured_phone ?? null,
    insurer: job?.insurer ?? null,
    lossType: job?.loss_type ?? null,
    dateOfLoss: job?.date_of_loss ?? null,
    claimNumber: job?.claim_number ?? null,
    quoteId: insp.quote_id ?? null,
    quoteRef,
    inspector: inspector?.name ?? userRow.name,
    inspectorId: user.id,
    tenantId: userRow.tenant_id,
    personMet: insp.person_met,
    fieldDraft: insp.field_draft,
    safetyConfirmedAt: insp.safety_confirmed_at,
    formSubmittedAt: insp.form_submitted_at,
  })
}
