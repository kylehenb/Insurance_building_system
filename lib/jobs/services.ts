import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { normaliseLossType } from '@/lib/loss-types'
import { createInvoiceForReport } from '@/lib/invoices/report-to-invoice'
import { generateInvoiceRef } from '@/lib/invoices/ref'
import { voidInvoice } from '@/lib/invoices/void'
import { createWorkOrder, updateWorkOrder } from '@/lib/work-orders/edit'
import { recomputeAndSaveStage } from '@/lib/jobs/recomputeStage'
import { FIELD_APP_INSURER } from '@/lib/jobs/field-app'
import { SERVICE_WORK_TYPES, WORK_TYPE_LABELS, isServiceWorkType, type ServiceWorkType } from '@/lib/insurer-orders/work-order-type'
import { describeService, serviceStage, type ServiceFacts, type ServiceStatus } from './service-stage'

// Requested services (tech spec §8, "Requested services"): what the insurer
// asked for beyond the BAR — a make safe, roof report, leak detection or
// specialist report — tracked on the job until the insurer has the report and
// its invoice, whoever does the work. Lodging creates one per type, not yet
// arranged, so nothing is decided at lodge and nothing is forgotten. Later:
//   • in-house → the draft report and an invoice at the client's rates
//   • trade    → a work order for the trade; once they're done, the report
//                and an invoice at the trade's cost plus the builder's margin
// It can switch either way until the report has gone. It's done when the
// report and its invoice have been sent (lib/documents/send refreshes it).
// Used by the job page (/api/jobs/[jobId]/services), the voice connector and
// lodging. The caller checks services.manage.

type Db = SupabaseClient<Database>
export type JobServiceRow = Database['public']['Tables']['job_services']['Row']
export { describeService, serviceStage }
export type { ServiceFacts, ServiceStatus }

export class ServiceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 500) {
    super(message)
    this.name = 'ServiceError'
  }
}

const OPEN: ServiceStatus[] = ['unassigned', 'in_house', 'trade']

/** The report each service produces (reports.report_type) and its reference prefix */
export const SERVICE_REPORT_TYPES: Record<ServiceWorkType, { reportType: string; prefix: string }> = {
  make_safe: { reportType: 'make_safe', prefix: 'MS' },
  roof_report: { reportType: 'roof_report', prefix: 'RR' },
  leak_detection: { reportType: 'LDR', prefix: 'LDR' },
  specialist: { reportType: 'specialist', prefix: 'SPR' },
}

/** The invoice type for a service done by a trade (on-charged at cost plus margin) */
const TRADE_INVOICE_TYPES: Record<ServiceWorkType, string> = {
  make_safe: 'make_safe', roof_report: 'roof', leak_detection: 'leak_detection', specialist: 'custom',
}

/** The work order for a service sent to a trade */
const WORK_ORDER_TYPES: Record<ServiceWorkType, string> = {
  make_safe: 'make_safe', roof_report: 'investigation', leak_detection: 'investigation', specialist: 'investigation',
}

/** Lodging: one service per make safe / roof report / leak detection / specialist type asked for. Skips types the job already has open. */
export async function createServicesForOrder(db: Db, p: { tenantId: string; jobId: string; orderId: string | null; types: readonly string[] }): Promise<JobServiceRow[]> {
  const types = [...new Set(p.types.filter(isServiceWorkType))]
  if (!types.length) return []
  const { data: existing, error: readError } = await db.from('job_services').select('service_type, status')
    .eq('tenant_id', p.tenantId).eq('job_id', p.jobId)
  if (readError) throw new ServiceError(readError.message, 500)
  const open = new Set((existing ?? []).filter(s => OPEN.includes(s.status as ServiceStatus)).map(s => s.service_type))
  const rows = types.filter(t => !open.has(t)).map(t => ({
    tenant_id: p.tenantId, job_id: p.jobId, insurer_order_id: p.orderId, service_type: t, status: 'unassigned',
  }))
  if (!rows.length) return []
  const { data, error } = await db.from('job_services').insert(rows).select('*')
  if (error) throw new ServiceError(error.message, 500)
  return data ?? []
}

/** What a service's next step depends on: its work order, report and invoice */
async function factsFor(db: Db, tenantId: string, services: JobServiceRow[]): Promise<ServiceFacts[]> {
  const ids = (k: 'work_order_id' | 'report_id' | 'invoice_id') => [...new Set(services.map(s => s[k]).filter((v): v is string => !!v))]
  const [wos, reports, invoices] = await Promise.all([
    ids('work_order_id').length
      ? db.from('work_orders').select('id, status, gary_state, trade_id, trade_name, agreed_amount, trade_cost').eq('tenant_id', tenantId).in('id', ids('work_order_id'))
      : Promise.resolve({ data: [] as never[] }),
    ids('report_id').length
      ? db.from('reports').select('id, report_ref, status, deleted_at').eq('tenant_id', tenantId).in('id', ids('report_id'))
      : Promise.resolve({ data: [] as never[] }),
    ids('invoice_id').length
      ? db.from('invoices').select('id, invoice_ref, status, amount_inc_gst').eq('tenant_id', tenantId).in('id', ids('invoice_id'))
      : Promise.resolve({ data: [] as never[] }),
  ])
  const tradeIds = [...new Set((wos.data ?? []).map((w: { trade_id: string | null }) => w.trade_id).filter((v): v is string => !!v))]
  const { data: trades } = tradeIds.length
    ? await db.from('trades').select('id, business_name').eq('tenant_id', tenantId).in('id', tradeIds)
    : { data: [] as { id: string; business_name: string | null }[] }
  return services.map(s => {
    const wo = (wos.data ?? []).find((w: { id: string }) => w.id === s.work_order_id) as
      { id: string; status: string | null; gary_state: string | null; trade_id: string | null; trade_name: string | null } | undefined
    const report = (reports.data ?? []).find((r: { id: string }) => r.id === s.report_id) as
      { id: string; report_ref: string | null; status: string | null; deleted_at: string | null } | undefined
    const invoice = (invoices.data ?? []).find((i: { id: string }) => i.id === s.invoice_id) as
      { id: string; invoice_ref: string | null; status: string | null } | undefined
    return {
      service: s,
      workOrder: wo ? { id: wo.id, status: wo.status, garyState: wo.gary_state, tradeName: (trades ?? []).find(t => t.id === wo.trade_id)?.business_name ?? null } : null,
      report: report && !report.deleted_at ? { id: report.id, ref: report.report_ref, status: report.status } : null,
      invoice: invoice ? { id: invoice.id, ref: invoice.invoice_ref, status: invoice.status } : null,
    }
  })
}

export interface ServiceView extends ServiceFacts {
  label: string
  stage: ReturnType<typeof serviceStage>
}

/** A job's services (open first) with what each needs next */
export async function loadJobServices(db: Db, tenantId: string, jobId: string, opts: { includeClosed?: boolean } = {}): Promise<ServiceView[]> {
  let q = db.from('job_services').select('*').eq('tenant_id', tenantId).eq('job_id', jobId)
  if (!opts.includeClosed) q = q.in('status', OPEN)
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw new ServiceError(error.message, 500)
  const facts = await factsFor(db, tenantId, data ?? [])
  return facts
    .map(f => ({ ...f, label: WORK_TYPE_LABELS[f.service.service_type as ServiceWorkType] ?? f.service.service_type, stage: serviceStage(f) }))
    .sort((a, b) => Number(OPEN.includes(b.service.status as ServiceStatus)) - Number(OPEN.includes(a.service.status as ServiceStatus)))
}

/** Every open service across the office's jobs, unarranged make safes first — for the dashboard and voice */
export async function loadOpenServices(db: Db, tenantId: string): Promise<(ServiceView & { job: { id: string; job_number: string; property_address: string | null; insurer: string | null } })[]> {
  const { data, error } = await db.from('job_services').select('*').eq('tenant_id', tenantId).in('status', OPEN)
    .order('created_at', { ascending: true }).limit(200)
  if (error) throw new ServiceError(error.message, 500)
  const services = data ?? []
  if (!services.length) return []
  const jobIds = [...new Set(services.map(s => s.job_id))]
  const { data: jobs } = await db.from('jobs').select('id, job_number, property_address, insurer').eq('tenant_id', tenantId).in('id', jobIds)
  const facts = await factsFor(db, tenantId, services)
  const rank = (v: ServiceView) => (v.stage.urgent ? 0 : 1) * 10 + (v.service.status === 'unassigned' ? 0 : 1)
  return facts
    .map(f => ({ ...f, label: WORK_TYPE_LABELS[f.service.service_type as ServiceWorkType] ?? f.service.service_type, stage: serviceStage(f) }))
    .flatMap(v => {
      const job = (jobs ?? []).find(j => j.id === v.service.job_id)
      // Midcity's field-app jobs aren't IRC's (lib/jobs/field-app.ts)
      return job && job.insurer !== FIELD_APP_INSURER ? [{ ...v, job }] : []
    })
    .sort((a, b) => rank(a) - rank(b))
}

async function loadService(db: Db, tenantId: string, serviceId: string): Promise<JobServiceRow> {
  const { data, error } = await db.from('job_services').select('*').eq('tenant_id', tenantId).eq('id', serviceId).maybeSingle()
  if (error) throw new ServiceError(error.message, 500)
  if (!data) throw new ServiceError('Service not found', 404)
  return data
}

async function loadJob(db: Db, tenantId: string, jobId: string) {
  const { data, error } = await db.from('jobs')
    .select('id, job_number, property_address, insured_name, claim_number, loss_type, client_id, property_details')
    .eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
  if (error) throw new ServiceError(error.message, 500)
  if (!data) throw new ServiceError('Job not found', 404)
  return data
}

/** A new draft report of the service's type, numbered after the job's others of that type */
async function createServiceReport(db: Db, tenantId: string, job: Awaited<ReturnType<typeof loadJob>>, type: ServiceWorkType): Promise<{ id: string; ref: string }> {
  const { reportType, prefix } = SERVICE_REPORT_TYPES[type]
  const { data: existing } = await db.from('reports').select('report_ref').eq('tenant_id', tenantId).eq('job_id', job.id)
  const taken = new Set((existing ?? []).map(r => r.report_ref))
  let n = 1
  while (taken.has(`${prefix}-${job.job_number}-${n}`)) n++
  const ref = `${prefix}-${job.job_number}-${n}`
  const { data, error } = await db.from('reports').insert({
    tenant_id: tenantId, job_id: job.id, report_type: reportType, report_ref: ref, version: 1, is_locked: false, status: 'draft',
    property_address: job.property_address, insured_name: job.insured_name, claim_number: job.claim_number,
    loss_type: normaliseLossType(job.loss_type), created_at: new Date().toISOString(),
  }).select('id').single()
  if (error || !data) throw new ServiceError(`Could not create the report: ${error?.message ?? 'unknown error'}`, 500)
  return { id: data.id, ref }
}

function propertyTypeOf(details: unknown): string | null {
  const storeys = (details as { storeys?: string } | null)?.storeys
  if (storeys === '2' || storeys === 'double') return 'double_storey'
  if (storeys === '1' || storeys === 'single') return 'single_storey'
  return null
}

export interface ServiceResult {
  service: JobServiceRow
  /** What happened, in words for the office */
  message: string
  warnings: string[]
}

/**
 * Takes back what the service had set up for the other way of doing it:
 * an unsent work order is removed; a sent one is left for the office to
 * cancel with the trade. A draft report is removed and a draft invoice
 * voided; once the report has gone it can't change.
 */
async function undoArrangement(db: Db, tenantId: string, s: JobServiceRow, userId: string | null, why: string): Promise<string[]> {
  const warnings: string[] = []
  if (s.report_id) {
    const { data: report } = await db.from('reports').select('id, status, report_ref, deleted_at').eq('tenant_id', tenantId).eq('id', s.report_id).maybeSingle()
    if (report && !report.deleted_at && report.status === 'sent') {
      throw new ServiceError(`${report.report_ref ?? 'The report'} has already been sent to the insurer, so this can't change now`, 409)
    }
  }
  if (s.invoice_id) {
    const { data: invoice } = await db.from('invoices').select('id, status, invoice_ref').eq('tenant_id', tenantId).eq('id', s.invoice_id).maybeSingle()
    if (invoice && invoice.status !== 'voided') {
      if (invoice.status !== 'draft') throw new ServiceError(`Invoice ${invoice.invoice_ref ?? ''} has already been sent, so this can't change now`.replace(/\s+/g, ' '), 409)
      await voidInvoice(db, tenantId, invoice.id, { reason: why, userId })
    }
  }
  if (s.report_id) {
    await db.from('reports').update({ deleted_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', s.report_id).eq('status', 'draft')
  }
  if (s.work_order_id) {
    const { data: wo } = await db.from('work_orders').select('id, status, gary_state, trade_id').eq('tenant_id', tenantId).eq('id', s.work_order_id).maybeSingle()
    if (wo) {
      const unsent = (wo.status ?? 'pending') === 'pending' && (wo.gary_state ?? 'not_started') === 'not_started'
      if (unsent) {
        // As the Work Orders tab removes one
        await db.from('work_orders').update({ predecessor_work_order_id: null }).eq('tenant_id', tenantId).eq('predecessor_work_order_id', wo.id)
        await db.from('work_orders').update({ parent_work_order_id: null, scheduling_offset_days: null }).eq('tenant_id', tenantId).eq('parent_work_order_id', wo.id)
        await db.from('work_order_visits').delete().eq('tenant_id', tenantId).eq('work_order_id', wo.id)
        await db.from('work_orders').delete().eq('tenant_id', tenantId).eq('id', wo.id)
      } else {
        warnings.push('The work order had already gone to the trade — let them know it\'s off. It stays on the Work Orders tab.')
      }
    }
  }
  return warnings
}

async function saveService(db: Db, tenantId: string, id: string, patch: Database['public']['Tables']['job_services']['Update']): Promise<JobServiceRow> {
  const { data, error } = await db.from('job_services').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).select('*').single()
  if (error || !data) throw new ServiceError(error?.message ?? 'Could not save the service', 500)
  return data
}

/** "I'll do it": the draft report and an invoice at the client's rates */
export async function arrangeInHouse(db: Db, tenantId: string, serviceId: string, opts: { userId?: string | null } = {}): Promise<ServiceResult> {
  const s = await loadService(db, tenantId, serviceId)
  if (!OPEN.includes(s.status as ServiceStatus)) throw new ServiceError('That service is already finished or not needed', 409)
  if (s.status === 'in_house') throw new ServiceError('It\'s already being done in-house', 409)
  const type = s.service_type as ServiceWorkType
  const label = WORK_TYPE_LABELS[type]
  const warnings = await undoArrangement(db, tenantId, s, opts.userId ?? null, `${label} done in-house instead`)
  const job = await loadJob(db, tenantId, s.job_id)
  const report = await createServiceReport(db, tenantId, job, type)
  const invoice = await createInvoiceForReport(db as unknown as SupabaseClient, {
    tenantId, jobId: job.id, reportId: report.id, reportType: SERVICE_REPORT_TYPES[type].reportType,
    propertyType: propertyTypeOf(job.property_details), propertyAddress: job.property_address, claimNumber: job.claim_number, jobNumber: job.job_number,
  })
  if (!invoice) warnings.push(`No invoice could be raised for the ${label.toLowerCase()} from the client's rates — raise it on the Invoices tab.`)
  const service = await saveService(db, tenantId, s.id, {
    status: 'in_house', work_order_id: null, report_id: report.id, invoice_id: invoice?.invoiceId ?? null,
    assigned_at: new Date().toISOString(), assigned_by: opts.userId ?? null,
  })
  await recomputeAndSaveStage(job.id)
  return {
    service,
    message: `${label} on ${job.job_number} is being done in-house: draft report ${report.ref}${invoice ? ` and invoice ${invoice.invoiceRef}` : ''} created.`,
    warnings,
  }
}

/** "Send to trade": a work order for the trade (optionally assigned to a contractor) */
export async function arrangeTrade(db: Db, tenantId: string, serviceId: string, opts: { userId?: string | null; tradeId?: string | null } = {}): Promise<ServiceResult> {
  const s = await loadService(db, tenantId, serviceId)
  if (!OPEN.includes(s.status as ServiceStatus)) throw new ServiceError('That service is already finished or not needed', 409)
  if (s.status === 'trade' && s.work_order_id) throw new ServiceError('It\'s already with a trade — see its work order', 409)
  const type = s.service_type as ServiceWorkType
  const label = WORK_TYPE_LABELS[type]
  const warnings = await undoArrangement(db, tenantId, s, opts.userId ?? null, `${label} sent to a trade instead`)
  const job = await loadJob(db, tenantId, s.job_id)
  const wo = await createWorkOrder(db, tenantId, { jobId: job.id, tradeName: label, tradeId: opts.tradeId ?? null, workType: WORK_ORDER_TYPES[type] })
  const service = await saveService(db, tenantId, s.id, {
    status: 'trade', work_order_id: wo.id, report_id: null, invoice_id: null,
    assigned_at: new Date().toISOString(), assigned_by: opts.userId ?? null,
  })
  await recomputeAndSaveStage(job.id)
  return {
    service,
    message: `${label} on ${job.job_number} goes to a trade: work order created${opts.tradeId ? '' : ' — pick the contractor'} and send it from the Work Orders tab.`,
    warnings,
  }
}

/** What the trade charged for a service's work order (ex GST): their invoice, else the agreed amount or cost */
export async function tradeCost(db: Db, tenantId: string, workOrderId: string): Promise<{ amount: number; from: string } | null> {
  const { data: bills } = await db.from('invoices').select('amount_ex_gst, status, trade_invoice_number')
    .eq('tenant_id', tenantId).eq('work_order_id', workOrderId).eq('direction', 'inbound')
  const bill = (bills ?? []).filter(b => b.status !== 'voided' && b.amount_ex_gst != null)
    .reduce((sum, b) => sum + Number(b.amount_ex_gst), 0)
  if (bill > 0) return { amount: Math.round(bill * 100) / 100, from: 'the trade\'s invoice' }
  const { data: wo } = await db.from('work_orders').select('agreed_amount, trade_cost').eq('tenant_id', tenantId).eq('id', workOrderId).maybeSingle()
  const agreed = wo?.agreed_amount ?? wo?.trade_cost
  if (agreed != null && Number(agreed) > 0) return { amount: Number(agreed), from: wo?.agreed_amount != null ? 'the agreed amount' : 'the trade\'s cost' }
  return null
}

/** The invoice to the insurer for a trade's work: their cost plus the client's builder's margin, plus GST */
export function onChargeAmounts(cost: number, marginPct: number) {
  const markup = Math.round(cost * marginPct * 100) / 100
  const exGst = Math.round((cost + markup) * 100) / 100
  const gst = Math.round(exGst * 0.1 * 100) / 100
  return { markup, exGst, gst, incGst: Math.round((exGst + gst) * 100) / 100 }
}

/**
 * The trade has done it: the report (to attach the trade's own report PDF to
 * when sending) and the invoice at the trade's cost plus margin. costOverride
 * when the trade's cost isn't on the work order or a trade invoice yet.
 */
export async function prepareTradeReport(db: Db, tenantId: string, serviceId: string, opts: { userId?: string | null; costOverride?: number | null } = {}): Promise<ServiceResult> {
  const s = await loadService(db, tenantId, serviceId)
  if (s.status !== 'trade' || !s.work_order_id) throw new ServiceError('That service isn\'t with a trade', 409)
  if (s.report_id && s.invoice_id) throw new ServiceError('Its report and invoice are already made', 409)
  const type = s.service_type as ServiceWorkType
  const label = WORK_TYPE_LABELS[type]
  const job = await loadJob(db, tenantId, s.job_id)

  const known = opts.costOverride != null && opts.costOverride > 0
    ? { amount: Math.round(opts.costOverride * 100) / 100, from: 'the amount given' }
    : await tradeCost(db, tenantId, s.work_order_id)
  if (!known) throw new ServiceError('The trade\'s cost isn\'t known yet — add their invoice or the agreed amount on the work order, or give the amount', 400)
  if (opts.costOverride != null && opts.costOverride > 0) await updateWorkOrder(db, tenantId, s.work_order_id, { trade_cost: known.amount })

  const { data: client } = job.client_id
    ? await db.from('clients').select('builders_margin_pct').eq('tenant_id', tenantId).eq('id', job.client_id).maybeSingle()
    : { data: null }
  const marginPct = Number(client?.builders_margin_pct ?? 0) / 100
  const amounts = onChargeAmounts(known.amount, marginPct)

  const report = s.report_id ? { id: s.report_id, ref: '' } : await createServiceReport(db, tenantId, job, type)
  const invoiceRef = await generateInvoiceRef(db as unknown as SupabaseClient, tenantId, job.id, job.job_number)
  const { data: invoice, error } = await db.from('invoices').insert({
    tenant_id: tenantId, job_id: job.id, report_id: report.id, work_order_id: s.work_order_id, invoice_ref: invoiceRef,
    invoice_type: TRADE_INVOICE_TYPES[type], direction: 'outbound', gst_treatment: 'exclusive', status: 'draft',
    amount_ex_gst: amounts.exGst, gst: amounts.gst, amount_inc_gst: amounts.incGst, markup_pct: marginPct,
  }).select('id').single()
  if (error || !invoice) throw new ServiceError(`Could not create the invoice: ${error?.message ?? 'unknown error'}`, 500)
  const { error: lineError } = await db.from('invoice_line_items').insert({
    tenant_id: tenantId, invoice_id: invoice.id, sort_order: 0, quantity: 1, unit_price: known.amount, line_total: known.amount,
    description: `${label} — ${job.property_address ?? job.job_number}${job.claim_number ? ` (claim ${job.claim_number})` : ''}`,
  })
  if (lineError) {
    await db.from('invoices').delete().eq('tenant_id', tenantId).eq('id', invoice.id)
    throw new ServiceError(`Could not create the invoice: ${lineError.message}`, 500)
  }
  const service = await saveService(db, tenantId, s.id, { report_id: report.id, invoice_id: invoice.id })
  await recomputeAndSaveStage(job.id)
  const money = (n: number) => `$${n.toFixed(2)}`
  return {
    service,
    message: `${label} on ${job.job_number}: ${report.ref ? `report ${report.ref} and ` : ''}invoice ${invoiceRef} for ${money(amounts.incGst)} inc GST (${money(known.amount)} from ${known.from}${marginPct ? ` plus ${Math.round(marginPct * 1000) / 10}% margin` : ', no margin set for this client'}). Attach the trade's report when you send them.`,
    warnings: [],
  }
}

/** Not needed after all (the insurer cancelled it, or it's covered elsewhere) */
export async function markServiceNotNeeded(db: Db, tenantId: string, serviceId: string, opts: { userId?: string | null; reason: string }): Promise<ServiceResult> {
  const s = await loadService(db, tenantId, serviceId)
  if (!OPEN.includes(s.status as ServiceStatus)) throw new ServiceError('That service is already finished or not needed', 409)
  const label = WORK_TYPE_LABELS[s.service_type as ServiceWorkType]
  const warnings = await undoArrangement(db, tenantId, s, opts.userId ?? null, `${label} not needed: ${opts.reason}`)
  const service = await saveService(db, tenantId, s.id, {
    status: 'cancelled', closed_at: new Date().toISOString(), notes: opts.reason,
    work_order_id: null, report_id: null, invoice_id: null,
  })
  await recomputeAndSaveStage(s.job_id)
  return { service, message: `${label} marked not needed.`, warnings }
}

/** Adds a service the order didn't ask for (a make safe found on site, say) */
export async function addService(db: Db, tenantId: string, jobId: string, type: string): Promise<ServiceResult> {
  if (!isServiceWorkType(type)) throw new ServiceError(`A service is one of ${SERVICE_WORK_TYPES.join(', ')}`, 400)
  await loadJob(db, tenantId, jobId)
  const [service] = await createServicesForOrder(db, { tenantId, jobId, orderId: null, types: [type] })
  if (!service) throw new ServiceError(`The job already has an open ${WORK_TYPE_LABELS[type].toLowerCase()}`, 409)
  await recomputeAndSaveStage(jobId)
  return { service, message: `${WORK_TYPE_LABELS[type]} added, not yet arranged.`, warnings: [] }
}

/** Everything the office can do to a requested service — from the job page, approvals and voice alike */
export type ServiceAction =
  | { kind: 'in_house'; serviceId: string }
  | { kind: 'trade'; serviceId: string; tradeId?: string | null }
  | { kind: 'prepare'; serviceId: string; cost?: number | null }
  | { kind: 'not_needed'; serviceId: string; reason: string }
  | { kind: 'add'; jobId: string; type: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A ServiceAction from a request body, or a ServiceError saying what's wrong */
export function parseServiceAction(body: Record<string, unknown>, jobId: string): ServiceAction {
  const id = typeof body.serviceId === 'string' ? body.serviceId : ''
  const needId = () => { if (!UUID_RE.test(id)) throw new ServiceError('Service not found', 404) }
  switch (body.action) {
    case 'in_house': needId(); return { kind: 'in_house', serviceId: id }
    case 'trade': {
      needId()
      const tradeId = typeof body.tradeId === 'string' && UUID_RE.test(body.tradeId) ? body.tradeId : null
      return { kind: 'trade', serviceId: id, tradeId }
    }
    case 'prepare': {
      needId()
      const cost = typeof body.cost === 'number' && Number.isFinite(body.cost) && body.cost > 0 && body.cost < 1_000_000 ? body.cost : null
      return { kind: 'prepare', serviceId: id, cost }
    }
    case 'not_needed': {
      needId()
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
      if (reason.length < 3) throw new ServiceError('Say why it isn\'t needed', 400)
      return { kind: 'not_needed', serviceId: id, reason }
    }
    case 'add': {
      if (!isServiceWorkType(body.type)) throw new ServiceError(`A service is one of ${SERVICE_WORK_TYPES.join(', ')}`, 400)
      return { kind: 'add', jobId, type: body.type }
    }
    default: throw new ServiceError("action must be 'in_house', 'trade', 'prepare', 'not_needed' or 'add'", 400)
  }
}

/** The job a service action is on (and that the service is this tenant's) */
export async function serviceActionJob(db: Db, tenantId: string, action: ServiceAction): Promise<string> {
  if (action.kind === 'add') return (await loadJob(db, tenantId, action.jobId)).id
  return (await loadService(db, tenantId, action.serviceId)).job_id
}

export async function runServiceAction(db: Db, tenantId: string, userId: string | null, action: ServiceAction): Promise<ServiceResult> {
  switch (action.kind) {
    case 'in_house': return arrangeInHouse(db, tenantId, action.serviceId, { userId })
    case 'trade': return arrangeTrade(db, tenantId, action.serviceId, { userId, tradeId: action.tradeId ?? null })
    case 'prepare': return prepareTradeReport(db, tenantId, action.serviceId, { userId, costOverride: action.cost ?? null })
    case 'not_needed': return markServiceNotNeeded(db, tenantId, action.serviceId, { userId, reason: action.reason })
    case 'add': return addService(db, tenantId, action.jobId, action.type)
  }
}

/** For the approvals list: "Do the make safe on IRC1042 in-house" */
export async function describeServiceAction(db: Db, tenantId: string, action: ServiceAction): Promise<{ summary: string; jobId: string | null }> {
  const jobNumber = async (jobId: string) =>
    (await db.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()).data?.job_number ?? 'the job'
  if (action.kind === 'add') {
    const label = isServiceWorkType(action.type) ? WORK_TYPE_LABELS[action.type].toLowerCase() : action.type
    return { summary: `Add a ${label} to ${await jobNumber(action.jobId)}`, jobId: action.jobId }
  }
  const s = await loadService(db, tenantId, action.serviceId)
  const label = isServiceWorkType(s.service_type) ? WORK_TYPE_LABELS[s.service_type].toLowerCase() : s.service_type
  const what = `the ${label} on ${await jobNumber(s.job_id)}`
  const summary = action.kind === 'in_house' ? `Do ${what} in-house (draft report and invoice)`
    : action.kind === 'trade' ? `Send ${what} to a trade (new work order)`
    : action.kind === 'prepare' ? `Make the report and invoice for ${what} (trade's cost plus margin${action.cost ? `, cost $${action.cost.toFixed(2)}` : ''})`
    : `Mark ${what} not needed: ${action.reason}`
  return { summary, jobId: s.job_id }
}

/**
 * After documents are sent: a service whose report has gone with its invoice
 * (or whose invoice went before) is done. One whose report went without its
 * invoice stays open — "invoice to send". Never throws.
 */
export async function refreshJobServices(db: Db, tenantId: string, jobId: string): Promise<void> {
  try {
    const { data } = await db.from('job_services').select('*').eq('tenant_id', tenantId).eq('job_id', jobId).in('status', ['in_house', 'trade'])
    const services = (data ?? []).filter(s => s.report_id && s.invoice_id)
    if (!services.length) return
    for (const f of await factsFor(db, tenantId, services)) {
      if (serviceStage(f).key === 'done') {
        await db.from('job_services').update({ status: 'done', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('id', f.service.id)
      }
    }
  } catch (err) {
    console.error(`[services] refresh failed for job ${jobId}:`, err)
  }
}
