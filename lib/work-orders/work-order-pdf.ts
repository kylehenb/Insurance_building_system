import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import { resolveOwnedScopeItems } from '@/lib/work-orders/scope-item-ownership'
import { buildWODisplayItems, woIsSent } from '@/app/dashboard/jobs/[jobId]/work-orders/types'
import {
  generateWorkOrderPdfHtml,
  type WorkOrderPdfData,
  type WorkOrderPdfOtherTradeItem,
  type WorkOrderPdfRoomDimensions,
  type WorkOrderPdfScopeItem,
} from '@/lib/documents/work-order-pdf-html'
import { renderHtmlToPdf } from '@/lib/pdf/render-html-to-pdf'
import { loadArialMetricFontCss } from '@/lib/pdf/fonts'

// Work Order PDF — data loading + rendering, kept behind one function boundary
// (generateWorkOrderPdf) so later automations (email to trade, save to
// job_files, Telegram) can reuse it. Nothing here writes to the database or
// storage: the PDF is generated live from current data on every call.

type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type Trade = Database['public']['Tables']['trades']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']

export interface WorkOrderPdfContext {
  /** Tenant-scoped access: either the signed-in user's client (RLS applies)
   *  or the service client for automations — tenantId is always enforced. */
  supabase: SupabaseClient<Database>
  tenantId: string
}

export class WorkOrderPdfError extends Error {
  constructor(message: string, public readonly status: 401 | 404 | 500) {
    super(message)
    this.name = 'WorkOrderPdfError'
  }
}

export interface WorkOrderPdfResult {
  pdf: Buffer
  filename: string
  isSent: boolean
}

async function contextFromSession(): Promise<WorkOrderPdfContext> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new WorkOrderPdfError('Unauthorized', 401)

  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow?.tenant_id) throw new WorkOrderPdfError('Unauthorized', 401)

  return { supabase, tenantId: userRow.tenant_id }
}

// Matches the trade label the Work Orders tab uses (useWorkOrders.ts) to match
// a work order to its scope items.
function tradeLabelFor(wo: WorkOrder, trade: Trade | null): string {
  return wo.trade_name ?? trade?.primary_trade ?? (wo.work_type === 'make_safe' ? 'Make Safe' : '')
}

let logoDataUriPromise: Promise<string | null> | null = null

function loadLogoDataUri(): Promise<string | null> {
  logoDataUriPromise ??= readFile(path.join(process.cwd(), 'public', 'logo-pdf.png'))
    .then(buf => `data:image/png;base64,${buf.toString('base64')}`)
    .catch(err => {
      console.error('Work order PDF: logo not found, rendering without it', err)
      return null
    })
  return logoDataUriPromise
}

// The footer shows the tenant's uploaded logo (Settings → Tenant), as the
// original print page does. The PDF page can't fetch URLs, so it is downloaded
// here and embedded. Falls back to the "IRC." badge if missing.
async function loadTenantLogoDataUri(storagePath: string | null): Promise<string | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!storagePath || !baseUrl) return null
  const url = `${baseUrl}/storage/v1/object/public/tenant-assets/${storagePath.split('/').map(encodeURIComponent).join('/')}`
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    const mime = type.startsWith('image/') ? type.split(';')[0] : 'image/png'
    return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch (err) {
    console.error('Work order PDF: tenant logo download failed', err)
    return null
  }
}

export async function loadWorkOrderPdfData(
  workOrderId: string,
  ctx: WorkOrderPdfContext
): Promise<WorkOrderPdfData> {
  const { supabase, tenantId } = ctx

  const { data: workOrder } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', workOrderId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!workOrder) throw new WorkOrderPdfError('Work order not found', 404)

  const [jobRes, tenantRes, tradesRes, siblingsRes, scopeRes] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', workOrder.job_id).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    supabase.from('trades').select('*').eq('tenant_id', tenantId),
    workOrder.quote_id
      ? supabase.from('work_orders').select('*').eq('quote_id', workOrder.quote_id).eq('tenant_id', tenantId)
      : Promise.resolve({ data: [] as WorkOrder[] }),
    workOrder.quote_id
      ? supabase.from('scope_items').select('*').eq('quote_id', workOrder.quote_id).eq('tenant_id', tenantId)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as ScopeItem[] }),
  ])

  const job = jobRes.data
  const tenant = tenantRes.data
  if (!job) throw new WorkOrderPdfError('Job not found', 404)
  if (!tenant) throw new WorkOrderPdfError('Tenant not found', 404)

  const tradesById = new Map((tradesRes.data ?? []).map(t => [t.id, t]))
  const tradeFor = (wo: WorkOrder) => (wo.trade_id ? tradesById.get(wo.trade_id) ?? null : null)
  const quoteScopeItems = scopeRes.data ?? []
  const scopeItemsById = new Map(quoteScopeItems.map(si => [si.id, si]))

  // A work order's current items: owned quote items (explicit assignment or
  // trade match) with its own notes overlay applied (edits, additions,
  // deletions) — the same list the Work Orders tab shows.
  function resolveItems(wo: WorkOrder) {
    const owned = resolveOwnedScopeItems({ id: wo.id, tradeLabel: tradeLabelFor(wo, tradeFor(wo)) || null }, quoteScopeItems)
    return buildWODisplayItems(owned, wo.notes)
  }

  const trade = tradeFor(workOrder)
  const tradeLabel = tradeLabelFor(workOrder, trade)
  const { woDisplayItems, lineItemsTotal } = resolveItems(workOrder)

  const scopeItems: WorkOrderPdfScopeItem[] = woDisplayItems
    .filter(item => !item.isDeleted)
    .map(item => ({
      description: item.item_description ?? '',
      qty: item.qty,
      unit: scopeItemsById.get(item.id)?.unit ?? null,
      room: item.room,
    }))

  const otherTradeItems: WorkOrderPdfOtherTradeItem[] = (siblingsRes.data ?? [])
    .filter(wo => wo.id !== workOrder.id)
    .flatMap(wo => {
      const woTrade = tradeFor(wo)
      const label = tradeLabelFor(wo, woTrade) || null
      const contractorName = woTrade?.business_name || woTrade?.primary_trade || null
      return resolveItems(wo).woDisplayItems
        .filter(item => !item.isDeleted)
        .map(item => ({
          description: item.item_description ?? '',
          qty: item.qty,
          unit: scopeItemsById.get(item.id)?.unit ?? null,
          room: item.room,
          tradeLabel: label ?? item.trade,
          contractorName,
        }))
    })

  const roomDimensions: Record<string, WorkOrderPdfRoomDimensions> = {}
  for (const si of quoteScopeItems) {
    const room = si.room?.trim() || 'General'
    if (roomDimensions[room]) continue
    if (si.room_length != null || si.room_width != null || si.room_height != null) {
      roomDimensions[room] = { length: si.room_length, width: si.room_width, height: si.room_height }
    }
  }

  // Agreed amount when set; otherwise the work order's own items at the quoted
  // (approved) price — the same fallback as the Work Orders tab Override column.
  const amount = workOrder.agreed_amount ?? lineItemsTotal
  const workOrderAmount = workOrder.agreed_amount != null || amount > 0 ? amount : null

  return {
    workOrder,
    job,
    tenant,
    trade,
    tradeLabel,
    scopeItems,
    otherTradeItems,
    roomDimensions,
    workOrderAmount,
    isSent: woIsSent(workOrder),
    logoDataUri: await loadLogoDataUri(),
    footerLogoDataUri: await loadTenantLogoDataUri(tenant.logo_storage_path),
    fontFaceCss: await loadArialMetricFontCss(),
    generatedAt: new Date(),
  }
}

function filenamePart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s,.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function workOrderPdfFilename(data: Pick<WorkOrderPdfData, 'workOrder' | 'trade' | 'tradeLabel' | 'job' | 'isSent'>): string {
  const parts = [
    filenamePart(data.workOrder.work_order_ref) || `WO-${data.workOrder.id.slice(0, 8).toUpperCase()}`,
    filenamePart(data.trade?.business_name || data.tradeLabel),
    filenamePart(data.job.property_address).slice(0, 80),
  ].filter(Boolean)
  return `${parts.join(' - ')}${data.isSent ? '' : ' - DRAFT'}.pdf`
}

export async function buildWorkOrderPdf(
  workOrderId: string,
  ctx?: WorkOrderPdfContext
): Promise<WorkOrderPdfResult> {
  const context = ctx ?? await contextFromSession()
  const data = await loadWorkOrderPdfData(workOrderId, context)
  // 10mm margins, matching the browser print of the original work order page.
  const pdf = await renderHtmlToPdf(generateWorkOrderPdfHtml(data), { margin: '10mm' })
  return { pdf, filename: workOrderPdfFilename(data), isSent: data.isSent }
}

/**
 * Reusable hook for later automations (email to trade, save to job_files,
 * Telegram). Not wired to anything yet.
 *
 * Without ctx it uses the signed-in user's session (route handlers / server
 * actions). Background jobs must pass ctx with a service client and the
 * tenantId that owns the work order.
 */
export async function generateWorkOrderPdf(
  workOrderId: string,
  ctx?: WorkOrderPdfContext
): Promise<Buffer> {
  return (await buildWorkOrderPdf(workOrderId, ctx)).pdf
}
