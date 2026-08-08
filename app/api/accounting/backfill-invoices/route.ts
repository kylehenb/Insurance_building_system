import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { syncInvoiceToAccounting } from '@/lib/accounting/sync'

export const maxDuration = 300

const DELAY_MS = 250

interface TenantRow {
  id: string
}

interface InvoiceRow {
  id: string
  invoice_ref: string
  direction: string
  created_at: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === 'true'

  const serviceSupabase = createServiceClient()
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tenantsData, error: tenantsError } = await serviceSupabase
    .from('tenants')
    .select('id')

  if (tenantsError || !tenantsData) {
    return NextResponse.json(
      { error: `Failed to fetch tenants: ${tenantsError?.message}` },
      { status: 500 }
    )
  }

  const tenants = tenantsData as TenantRow[]
  const allResults: unknown[] = []

  for (const tenant of tenants) {
    const tenantId = tenant.id

    const { data: invoicesData, error: invoicesError } = await rawDb
      .from('invoices')
      .select('id, invoice_ref, direction, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'sent')
      .or('accounting_sync_status.is.null,accounting_sync_status.neq.synced')
      .order('created_at', { ascending: true })

    if (invoicesError || !invoicesData) {
      allResults.push({ tenantId, error: `Failed to fetch invoices: ${invoicesError?.message}` })
      continue
    }

    const invoices = invoicesData as InvoiceRow[]
    const total = invoices.length

    console.log(`[backfill] tenant=${tenantId} — ${total} invoices to sync (dry_run=${dryRun})`)

    if (dryRun) {
      allResults.push({
        tenantId,
        dryRun: true,
        total,
        invoices: invoices.map((inv, i) => ({
          index: i + 1,
          id: inv.id,
          ref: inv.invoice_ref,
          direction: inv.direction,
          created_at: inv.created_at,
        })),
      })
      continue
    }

    const results: Array<{
      index: number
      ref: string
      status: 'synced' | 'failed'
      qboId?: string
      error?: string
    }> = []

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i]
      const label = `[backfill] ${i + 1}/${total}: ${inv.invoice_ref}`

      try {
        const result = await syncInvoiceToAccounting(serviceSupabase, tenantId, inv.id)
        if (result.success) {
          console.log(`${label} → synced (qbo_id=${result.accountingRefId})`)
          results.push({ index: i + 1, ref: inv.invoice_ref, status: 'synced', qboId: result.accountingRefId })
        } else {
          console.error(`${label} → FAILED: ${result.error}`)
          results.push({ index: i + 1, ref: inv.invoice_ref, status: 'failed', error: result.error })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`${label} → FAILED (exception): ${msg}`)
        results.push({ index: i + 1, ref: inv.invoice_ref, status: 'failed', error: msg })
      }

      if (i < invoices.length - 1) {
        await sleep(DELAY_MS)
      }
    }

    const synced = results.filter((r) => r.status === 'synced').length
    const failed = results.filter((r) => r.status === 'failed').length
    console.log(`[backfill] tenant=${tenantId} complete — synced=${synced} failed=${failed}`)

    allResults.push({ tenantId, total, synced, failed, results })
  }

  return NextResponse.json({ status: dryRun ? 'dry_run' : 'success', results: allResults })
}
