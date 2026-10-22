import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { DocumentSendType } from '@/lib/email/templates'
import { QuoteDocument } from '@/components/documents/QuoteDocument'
import { ReportDocument } from '@/components/documents/ReportDocument'
import { TccDocument } from '@/components/documents/TccDocument'
import { PhotosDocument } from '@/components/documents/PhotosDocument'
import { InvoiceDocument } from '@/components/documents/InvoiceDocument'
import { renderPrintDocumentPdf } from '@/lib/documents/render-print-document'
import {
  loadInvoicePrintData,
  loadPhotosPrintData,
  loadQuotePrintData,
  loadReportPrintData,
  loadTccPrintData,
  tccCallDetails,
  type PrintDataContext,
  type TccCallDetails,
} from '@/lib/documents/print-data'
import {
  photosPdfFilename,
  quotePdfFilename,
  reportDocumentName,
  reportPdfFilename,
  tccPdfFilename,
} from '@/lib/documents/print-document-pdfs'
import { invoicePdfFilename } from '@/lib/documents/invoice-pdf'
import { markInvoiceSent } from '@/lib/invoices/excess-invoice'
import { recomputeAndSaveStage } from '@/lib/jobs/recomputeStage'
import { indexReports } from '@/lib/reports/similar-reports'

// The documents that can be emailed from a job, and what each one needs:
// its data, file name, email template and placeholders, the PDF itself, and
// what changes once it has been sent. The PDFs are the print pages' own
// components (see lib/documents/render-print-document.ts).

type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Invoice = Database['public']['Tables']['invoices']['Row']
type Service = SupabaseClient<Database>

export const DOCUMENT_KINDS = ['quote', 'invoice', 'report', 'tcc', 'photos'] as const
export type DocumentKind = typeof DOCUMENT_KINDS[number]

/**
 * One document to attach. id is the quote/invoice/report id; for the TCC it
 * is the quote id (as the print page) plus the call details; for photos it is
 * the job id plus the chosen photo ids (none = all of the job's photos).
 */
export interface DocumentRef {
  kind: DocumentKind
  id: string
  tcc?: TccCallDetails
  photoIds?: string[]
}

export class DocumentSendError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 413 | 422 | 500 | 502) {
    super(message)
    this.name = 'DocumentSendError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value)
}

/** Validates a document reference from a request body or query string. */
export function parseDocumentRef(input: unknown): DocumentRef {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (!isDocumentKind(o.kind)) throw new DocumentSendError('Unknown document type', 400)
  if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) throw new DocumentSendError('Document not found', 404)
  const ref: DocumentRef = { kind: o.kind, id: o.id }
  if (o.kind === 'tcc') {
    const raw = (o.tcc && typeof o.tcc === 'object' ? o.tcc : {}) as Record<string, unknown>
    const call = tccCallDetails(raw)
    for (const v of Object.values(call)) {
      if (v.length > 200) throw new DocumentSendError('Call details are too long', 400)
    }
    ref.tcc = call
  }
  if (o.kind === 'photos') {
    const ids = Array.isArray(o.photoIds) ? o.photoIds : []
    if (ids.length > 500 || ids.some(id => typeof id !== 'string' || !UUID_RE.test(id))) {
      throw new DocumentSendError('Invalid photo selection', 400)
    }
    ref.photoIds = ids as string[]
  }
  return ref
}

/** Same document (and, for TCC/photos, same contents) */
export function documentRefKey(ref: DocumentRef): string {
  if (ref.kind === 'tcc') return `tcc:${ref.id}:${JSON.stringify(ref.tcc ?? {})}`
  if (ref.kind === 'photos') return `photos:${ref.id}:${(ref.photoIds ?? []).join(',')}`
  return `${ref.kind}:${ref.id}`
}

/** A document loaded and ready to render, attach and record. */
export interface PreparedDocument {
  ref: DocumentRef
  job: Job
  tenant: Tenant
  filename: string
  /** e.g. "Quote Q-IRC1234-1" — for the send dialog and the job's comms log */
  title: string
  /** The email template used when this is the main document */
  sendType: DocumentSendType
  /** Who it goes to by default */
  audience: 'insurer' | 'insured'
  /** Document placeholders for the email template */
  vars: Record<string, string | null>
  /** Things worth a second look before sending (shown in the dialog) */
  warnings: string[]
  render(): Promise<Buffer>
}

const money = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v ?? 0)

const shortDate = (d: Date) =>
  d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' })

/** Quote total inc GST, worked out exactly as the quote document shows it. */
export function quoteDocumentTotal(quote: Quote, items: ScopeItem[]): number {
  const effective = (item: ScopeItem) => {
    if (item.qty == null || (item.rate_labour == null && item.rate_materials == null)) return item.line_total ?? 0
    return item.qty * ((item.rate_labour ?? 0) + (item.rate_materials ?? 0))
  }
  const subtotal = items.reduce((sum, item) => sum + effective(item), 0)
  return subtotal * (1 + (quote.markup_pct || 0.2)) * (1 + (quote.gst_pct || 0.1))
}

/**
 * When an invoice is due, as the invoice itself states it (tenant payment
 * terms; excess invoices default to on receipt).
 */
export function invoiceDueText(
  invoice: Pick<Invoice, 'invoice_type' | 'gst_treatment' | 'issued_date' | 'created_at'>,
  tenant: Pick<Tenant, 'invoice_payment_terms' | 'excess_payment_terms'>,
): string {
  const isExcess = invoice.invoice_type === 'excess' || (invoice.invoice_type === 'repair' && invoice.gst_treatment === 'inclusive')
  const days = isExcess ? (tenant.excess_payment_terms ?? 0) : (tenant.invoice_payment_terms ?? 14)
  if (days <= 0) return 'on receipt'
  const base = new Date(invoice.issued_date || invoice.created_at || Date.now())
  return shortDate(new Date(base.getTime() + days * 24 * 60 * 60 * 1000))
}

export async function prepareDocument(ref: DocumentRef, ctx: PrintDataContext): Promise<PreparedDocument> {
  switch (ref.kind) {
    case 'quote': {
      const data = await loadQuotePrintData(ref.id, ctx)
      const { quote } = data
      const warnings: string[] = []
      if (quote.status === 'draft') warnings.push(`Quote ${quote.quote_ref ?? ''} is still a draft`.replace('  ', ' '))
      if (data.scopeItems.length === 0) warnings.push('The quote has no items')
      return {
        ref, job: data.job, tenant: data.tenant,
        filename: quotePdfFilename(data),
        title: `Quote ${quote.quote_ref || 'Draft'}`,
        sendType: 'quote',
        audience: 'insurer',
        vars: { quote_ref: quote.quote_ref || 'Draft', quote_total: money(quoteDocumentTotal(quote, data.scopeItems)) },
        warnings,
        // A copy: the document sorts its items in place
        render: () => renderPrintDocumentPdf(<QuoteDocument {...data} scopeItems={[...data.scopeItems]} />, quote.quote_ref || 'Quote'),
      }
    }
    case 'report': {
      const data = await loadReportPrintData(ref.id, ctx)
      const { report } = data
      const name = reportDocumentName(report.report_type)
      const warnings: string[] = []
      if (report.deleted_at) throw new DocumentSendError('This report has been deleted', 404)
      if (report.status === 'draft') warnings.push(`${name} ${report.report_ref ?? ''} is still a draft`.replace('  ', ' '))
      return {
        ref, job: data.job, tenant: data.tenant,
        filename: reportPdfFilename(data),
        title: `${name}${report.report_ref ? ` ${report.report_ref}` : ''}`,
        sendType: 'report',
        audience: 'insurer',
        vars: { report_name: name, report_ref: report.report_ref ?? '' },
        warnings,
        render: () => renderPrintDocumentPdf(<ReportDocument {...data} />, report.report_ref || 'Report'),
      }
    }
    case 'invoice': {
      const data = await loadInvoicePrintData(ref.id, ctx)
      const { invoice } = data
      if (invoice.direction && invoice.direction !== 'outbound') {
        throw new DocumentSendError('Only our own invoices can be sent', 422)
      }
      if (invoice.status === 'voided') throw new DocumentSendError('This invoice has been voided', 409)
      const isExcess = invoice.invoice_type === 'excess'
      const insuredFirst = data.job.insured_name?.trim().split(/\s+/)[0] || 'there'
      return {
        ref, job: data.job, tenant: data.tenant,
        filename: invoicePdfFilename(invoice, data.job.property_address),
        title: `${isExcess ? 'Excess invoice' : 'Invoice'} ${invoice.invoice_ref ?? ''}`.trim(),
        sendType: isExcess ? 'excess_invoice' : 'invoice',
        audience: isExcess ? 'insured' : 'insurer',
        vars: {
          invoice_ref: invoice.invoice_ref ?? '',
          invoice_amount: money(invoice.amount_inc_gst),
          due_date: invoiceDueText(invoice, data.tenant),
          accounts_email: data.tenant.accounts_email || data.tenant.contact_email,
          insured_first_name: insuredFirst,
        },
        warnings: [],
        render: () => renderPrintDocumentPdf(<InvoiceDocument {...data} />, invoice.invoice_ref || 'Invoice'),
      }
    }
    case 'tcc': {
      const call = ref.tcc ?? tccCallDetails({})
      const data = await loadTccPrintData(ref.id, call, ctx)
      const warnings = !call.date || !call.completedBy ? ['The call date or who completed it is missing'] : []
      return {
        ref, job: data.job, tenant: data.tenant,
        filename: tccPdfFilename(data),
        title: `Telephone Clearance Certificate TCC-${data.job.job_number}`,
        sendType: 'tcc',
        audience: 'insurer',
        vars: {},
        warnings,
        render: () => renderPrintDocumentPdf(<TccDocument {...data} />, `TCC-${data.job.job_number}`),
      }
    }
    case 'photos': {
      const photoIds = ref.photoIds ?? []
      const data = await loadPhotosPrintData(ref.id, photoIds, ctx)
      if (data.photos.length === 0) throw new DocumentSendError('There are no photos to send', 422)
      // The photo pages only carry a few job fields; the email needs the rest
      const { data: job } = await ctx.supabase.from('jobs').select('*').eq('id', ref.id).eq('tenant_id', ctx.tenantId).single()
      const { data: tenant } = await ctx.supabase.from('tenants').select('*').eq('id', ctx.tenantId).single()
      if (!job || !tenant) throw new DocumentSendError('Job not found', 404)
      return {
        ref, job, tenant,
        filename: photosPdfFilename(data),
        title: `Photos (${data.photos.length})`,
        sendType: 'photos',
        audience: 'insurer',
        vars: {},
        warnings: [],
        render: () => renderPrintDocumentPdf(<PhotosDocument {...data} />, `Photos ${data.job.job_number}`),
      }
    }
  }
}

export interface StatusChange {
  ref: DocumentRef
  /** Shown to the user, e.g. "Quote Q-1 marked sent" */
  description: string
}

/**
 * What changes once a document has gone to the insurer (WF-5: sent items are
 * set to sent and locked). Statuses only move forward: an approved quote or
 * a paid invoice is left as it is. Never throws — the email has already gone.
 */
export async function markDocumentSent(service: Service, tenantId: string, doc: PreparedDocument): Promise<StatusChange | null> {
  const { ref } = doc
  try {
    if (ref.kind === 'quote') {
      const { data } = await service
        .from('quotes').update({ status: 'sent', is_locked: true })
        .eq('id', ref.id).eq('tenant_id', tenantId).in('status', ['draft', 'ready', 'sent_to_insurer'])
        .select('id, job_id')
      if (!data?.length) return null
      await recomputeAndSaveStage(data[0].job_id)
      return { ref, description: `${doc.title} marked sent` }
    }
    if (ref.kind === 'report') {
      const { data } = await service
        .from('reports').update({ status: 'sent', is_locked: true })
        .eq('id', ref.id).eq('tenant_id', tenantId).in('status', ['draft', 'complete', 'PDF Generated'])
        .select('id, job_id')
      if (!data?.length) return null
      // Locked reports are fingerprinted for the similar-report lookup, as the lock action does
      after(() => indexReports(service, [ref.id]).catch(err =>
        console.error(`[document-send] report ${ref.id} fingerprint failed:`, err)))
      await recomputeAndSaveStage(data[0].job_id)
      return { ref, description: `${doc.title} marked sent` }
    }
    if (ref.kind === 'invoice') {
      const { data: current } = await service
        .from('invoices').select('status').eq('id', ref.id).eq('tenant_id', tenantId).maybeSingle()
      if (current?.status !== 'draft') return null
      // Marks it sent and pushes it to the accounting system, as the Send button did
      await markInvoiceSent(service, tenantId, ref.id)
      return { ref, description: `${doc.title} marked sent` }
    }
  } catch (err) {
    console.error(`[document-send] could not mark ${ref.kind} ${ref.id} sent:`, err)
  }
  return null
}
