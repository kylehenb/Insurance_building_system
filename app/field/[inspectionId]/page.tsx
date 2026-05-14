import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import FieldApp from './FieldApp'

interface Props {
  params: Promise<{ inspectionId: string }>
}

export default async function FieldAppPage({ params }: Props) {
  const { inspectionId } = await params

  const userData = await getUser()
  if (!userData?.session) redirect('/login')
  if (!userData.user) redirect('/auth/new-user')

  const { tenant_id } = userData

  const service = createServiceClient()
  const { data: insp, error } = await service
    .from('inspections')
    .select(`
      id, inspection_ref, status, scheduled_date,
      job_id, quote_id, report_id, inspector_id, person_met, field_draft,
      safety_confirmed_at, form_submitted_at,
      jobs!job_id (
        id, job_number, property_address, insured_name, insured_phone,
        insurer, loss_type, date_of_loss, claim_number
      ),
      users!inspector_id (name)
    `)
    .eq('id', inspectionId)
    .eq('tenant_id', tenant_id as string)
    .single()

  if (error || !insp) {
    return (
      <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border border-[#1a1a1a]/10 p-8 max-w-md">
          <h1 className="text-xl font-semibold text-[#1a1a1a] mb-4">Inspection Not Found</h1>
          <p className="text-sm text-[#1a1a1a]/70 mb-4">
            The inspection could not be found or you don't have access to it.
          </p>
          <div className="bg-[#f5f0e8] rounded p-4 mb-4 text-xs font-mono text-[#1a1a1a]">
            <div><strong>Inspection ID:</strong> {inspectionId}</div>
            <div><strong>Tenant ID:</strong> {tenant_id}</div>
            <div><strong>Error:</strong> {error?.message || 'Inspection not found'}</div>
          </div>
          <a
            href="/dashboard/inspections"
            className="inline-block px-4 py-2 bg-[#1a1a1a] text-[#c8b89a] rounded-md text-sm"
          >
            Back to Inspections
          </a>
        </div>
      </div>
    )
  }

  const { data: userRow } = await service
    .from('users')
    .select('name')
    .eq('id', userData.session.user.id)
    .single()

  const job = (insp as any).jobs
  const inspector = (insp as any).users

  let quoteRef: string | null = null
  if ((insp as any).quote_id) {
    const { data: quote } = await service
      .from('quotes')
      .select('quote_ref')
      .eq('id', (insp as any).quote_id)
      .single()
    quoteRef = (quote as any)?.quote_ref ?? null
  }

  let reportRef: string | null = null
  if ((insp as any).report_id) {
    const { data: report } = await service
      .from('reports')
      .select('report_ref')
      .eq('id', (insp as any).report_id)
      .single()
    reportRef = (report as any)?.report_ref ?? null
  }

  const initialData = {
    inspectionId: insp.id,
    inspectionRef: insp.inspection_ref ?? null,
    status: insp.status ?? 'confirmed',
    scheduledDate: insp.scheduled_date ?? null,
    scheduledTime: null,
    jobId: job?.id ?? null,
    jobNumber: job?.job_number ?? null,
    address: job?.property_address ?? null,
    insuredName: job?.insured_name ?? null,
    insurer: job?.insurer ?? null,
    lossType: job?.loss_type ?? null,
    dateOfLoss: job?.date_of_loss ?? null,
    claimNumber: job?.claim_number ?? null,
    quoteId: (insp as any).quote_id ?? null,
    quoteRef,
    reportId: (insp as any).report_id ?? null,
    reportRef,
    inspector: inspector?.name ?? userRow?.name ?? null,
    inspectorId: userData.session.user.id,
    tenantId: tenant_id as string,
    personMet: insp.person_met ?? null,
    fieldDraft: (insp.field_draft as Record<string, unknown> | null) ?? null,
    safetyConfirmedAt: insp.safety_confirmed_at ?? null,
    formSubmittedAt: insp.form_submitted_at ?? null,
  }

  return <FieldApp initialData={initialData} />
}
