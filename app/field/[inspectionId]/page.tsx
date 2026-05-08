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
  const { data: insp } = await service
    .from('inspections')
    .select(`
      id, inspection_ref, status, scheduled_date, scheduled_time,
      job_id, quote_id, inspector_id, person_met, field_draft,
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

  if (!insp) redirect('/dashboard/inspections')

  const { data: userRow } = await service
    .from('users')
    .select('name')
    .eq('id', userData.session.user.id)
    .single()

  const job = (insp as any).jobs
  const inspector = (insp as any).users

  let quoteRef: string | null = null
  if (insp.quote_id) {
    const { data: quote } = await service
      .from('quotes')
      .select('quote_ref')
      .eq('id', insp.quote_id)
      .single()
    quoteRef = (quote as any)?.quote_ref ?? null
  }

  const initialData = {
    inspectionId: insp.id,
    inspectionRef: insp.inspection_ref ?? null,
    status: insp.status ?? 'confirmed',
    scheduledDate: insp.scheduled_date ?? null,
    scheduledTime: insp.scheduled_time ?? null,
    jobId: job?.id ?? null,
    jobNumber: job?.job_number ?? null,
    address: job?.property_address ?? null,
    insuredName: job?.insured_name ?? null,
    insurer: job?.insurer ?? null,
    lossType: job?.loss_type ?? null,
    dateOfLoss: job?.date_of_loss ?? null,
    claimNumber: job?.claim_number ?? null,
    quoteId: insp.quote_id ?? null,
    quoteRef,
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
