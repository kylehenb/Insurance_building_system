import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import FieldApp from './FieldApp'
import { REPORT_OPTIONS, tradesForReport, type FieldTrade } from './report-options'

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
        insurer, loss_type, date_of_loss, claim_number, claim_description
      ),
      users!inspector_id (name)
    `)
    .eq('id', inspectionId)
    .eq('tenant_id', tenant_id as string)
    .single()

  if (error || !insp) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border border-ink/10 p-8 max-w-md">
          <h1 className="text-xl font-semibold text-ink mb-4">Inspection Not Found</h1>
          <p className="text-sm text-ink/70 mb-4">
            The inspection could not be found or you don't have access to it.
          </p>
          <div className="bg-cream rounded p-4 mb-4 text-xs font-mono text-ink">
            <div><strong>Inspection ID:</strong> {inspectionId}</div>
            <div><strong>Tenant ID:</strong> {tenant_id}</div>
            <div><strong>Error:</strong> {error?.message || 'Inspection not found'}</div>
          </div>
          <a
            href="/dashboard/inspections"
            className="inline-block px-4 py-2 bg-ink text-tan rounded-md text-sm"
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

  // Trades the inspector can ask for an external report, per report in the dropdown
  const { data: tradeRows } = await service
    .from('trades')
    .select('id, business_name, entity_name, primary_contact, primary_trade, can_do_make_safe, makesafe_priority, priority_rank')
    .eq('tenant_id', tenant_id as string)
    .eq('status', 'active')
  const allTrades = (tradeRows ?? []).map(t => ({
    id: t.id,
    name: t.business_name || t.entity_name || t.primary_contact || 'Unnamed trade',
    trade: t.primary_trade,
    makeSafe: !!t.can_do_make_safe,
    makesafePriority: t.makesafe_priority,
    priorityRank: t.priority_rank,
  }))
  const reportTrades: Record<string, FieldTrade[]> = {}
  for (const opt of REPORT_OPTIONS) if (opt.external) reportTrades[opt.external] = tradesForReport(opt, allTrades)
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
    claimDescription: job?.claim_description ?? null,
    quoteId: (insp as any).quote_id ?? null,
    quoteRef,
    reportId: (insp as any).report_id ?? null,
    reportRef,
    inspector: inspector?.name ?? userRow?.name ?? null,
    inspectorId: userData.session.user.id,
    currentUserName: userRow?.name ?? null,
    tenantId: tenant_id as string,
    personMet: insp.person_met ?? null,
    fieldDraft: (insp.field_draft as Record<string, unknown> | null) ?? null,
    safetyConfirmedAt: insp.safety_confirmed_at ?? null,
    formSubmittedAt: insp.form_submitted_at ?? null,
    reportTrades,
  }

  return <FieldApp initialData={initialData} />
}
