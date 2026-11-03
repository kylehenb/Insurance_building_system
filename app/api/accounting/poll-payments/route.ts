import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getAccountingProvider } from '@/lib/accounting/client'
import { withCronRun } from '@/lib/health/cron'
import { recordSystemEvent } from '@/lib/activity/log'

const PAID_COLUMNS = 'job_id, direction, invoice_ref, trade_invoice_number, amount_inc_gst'
type PaidRow = { job_id: string | null; direction: string | null; invoice_ref: string | null; trade_invoice_number: string | null; amount_inc_gst: number | null }

const money = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Into each job's ledger: an invoice the accounts now show as paid (only the ones that just changed) */
async function recordPaid(tenantId: string, rows: unknown): Promise<void> {
  for (const r of (rows as PaidRow[] | null) ?? []) {
    if (!r.job_id) continue
    const amount = r.amount_inc_gst != null ? ` (${money(Number(r.amount_inc_gst))})` : ''
    const summary = r.direction === 'inbound'
      ? `Trade invoice${r.trade_invoice_number ? ` ${r.trade_invoice_number}` : ''}${amount} paid`
      : `${r.invoice_ref ?? 'Invoice'}${amount} paid`
    await recordSystemEvent({ tenantId, jobId: r.job_id, event: 'invoice.paid', summary, detail: 'Shown as paid in the accounts' })
  }
}

interface TenantRow {
  id: string
}

interface InvoiceRow {
  id: string
  accounting_ref_id: string | null
  accounting_bill_id: string | null
  direction: string
}

interface PollSummary {
  tenantId: string
  arPolled: number
  apPolled: number
  arMarkedPaid: number
  apMarkedPaid: number
  error?: string
}

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

// Vercel cron calls with GET
async function runGet(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPoll()
}

// Keep POST for manual/test invocation
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPoll()
}

async function runPoll(): Promise<NextResponse> {
  const supabase = createServiceClient()
  // Use raw client for queries on columns added by migration
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const summary: PollSummary[] = []

  const { data: tenantsData, error: tenantsError } = await supabase
    .from('tenants')
    .select('id')

  if (tenantsError || !tenantsData) {
    return NextResponse.json(
      { error: `Failed to fetch tenants: ${tenantsError?.message}` },
      { status: 500 }
    )
  }

  const tenants = tenantsData as TenantRow[]

  for (const tenant of tenants) {
    const tenantSummary: PollSummary = {
      tenantId: tenant.id,
      arPolled: 0,
      apPolled: 0,
      arMarkedPaid: 0,
      apMarkedPaid: 0,
    }

    try {
      const { data: invoicesData, error: invoicesError } = await rawDb
        .from('invoices')
        .select('id, accounting_ref_id, accounting_bill_id, direction')
        .eq('tenant_id', tenant.id)
        .eq('accounting_sync_status', 'synced')
        .neq('status', 'paid')
        // A voided invoice has a $0 balance in QuickBooks — that isn't a payment
        .neq('status', 'voided')

      if (invoicesError || !invoicesData) {
        tenantSummary.error = `Failed to fetch invoices: ${invoicesError?.message}`
        summary.push(tenantSummary)
        continue
      }

      const invoices = invoicesData as InvoiceRow[]

      const arInvoices = invoices.filter(
        (inv) => inv.direction === 'outbound' && inv.accounting_ref_id
      )
      const apInvoices = invoices.filter(
        (inv) => inv.direction === 'inbound' && inv.accounting_bill_id
      )

      if (arInvoices.length === 0 && apInvoices.length === 0) {
        summary.push(tenantSummary)
        continue
      }

      const provider = await getAccountingProvider(supabase, tenant.id)

      if (arInvoices.length > 0) {
        const arRefIds = arInvoices
          .map((inv) => inv.accounting_ref_id)
          .filter((id): id is string => id !== null)

        tenantSummary.arPolled = arRefIds.length

        const arResults = await provider.pollPaymentStatus(arRefIds)

        for (const result of arResults) {
          if (result.isPaid) {
            await rawDb
              .from('invoices')
              .update({
                status: 'paid',
                paid_date: result.paidDate ?? new Date().toISOString().split('T')[0],
              })
              .eq('accounting_ref_id', result.accountingRefId)
              .eq('tenant_id', tenant.id)
              .neq('status', 'paid')
              .select(PAID_COLUMNS)
              .then(r => recordPaid(tenant.id, r.data))

            tenantSummary.arMarkedPaid++
          }
        }
      }

      if (apInvoices.length > 0) {
        const apRefIds = apInvoices
          .map((inv) => inv.accounting_bill_id)
          .filter((id): id is string => id !== null)

        tenantSummary.apPolled = apRefIds.length

        const apResults = await provider.pollPaymentStatus(apRefIds)

        for (const result of apResults) {
          if (result.isPaid) {
            await rawDb
              .from('invoices')
              .update({
                status: 'paid',
                paid_date: result.paidDate ?? new Date().toISOString().split('T')[0],
              })
              .eq('accounting_bill_id', result.accountingRefId)
              .eq('tenant_id', tenant.id)
              .neq('status', 'paid')
              .select(PAID_COLUMNS)
              .then(r => recordPaid(tenant.id, r.data))

            tenantSummary.apMarkedPaid++
          }
        }
      }
    } catch (err) {
      tenantSummary.error =
        err instanceof Error ? err.message : 'Unknown error'
    }

    summary.push(tenantSummary)
  }

  return NextResponse.json({ status: 'success', summary })
}

// Each run is recorded for the health watcher (tech spec §25)
export const GET = withCronRun('/api/accounting/poll-payments', runGet)
