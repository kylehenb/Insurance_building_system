import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Data for documents built from a job's approved quotes (Scope of Works
// Authorisation, Building Contract). Read-only.

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

export interface QuoteDocumentContext {
  /** The signed-in user's client (RLS applies) or the service client — tenantId is always enforced. */
  supabase: SupabaseClient<Database>
  tenantId: string
}

export class QuoteDocumentError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 422 | 500) {
    super(message)
    this.name = 'QuoteDocumentError'
  }
}

export interface QuoteDocumentData {
  job: Job
  tenant: Tenant
  /** In creation order */
  quotes: Quote[]
  /** Items of those quotes, without items the insurer declined */
  scopeItems: ScopeItem[]
  /** Contract price incl GST, worked out as the Building Contract does */
  totalInclGst: number
}

/** Quote statuses that can go into a document for the homeowner to sign. */
export const SIGNABLE_QUOTE_STATUSES = ['approved', 'partially_approved']

/**
 * Total incl GST per quote (its own markup/GST against its own items), summed.
 * approved_amount wins when set. Same formula as building-contract-html.ts.
 */
export function quotesTotalInclGst(quotes: Quote[], scopeItems: ScopeItem[]): number {
  return quotes.reduce((sum, quote) => {
    if (quote.approved_amount != null) return sum + Number(quote.approved_amount)
    const subtotal = scopeItems
      .filter(item => item.quote_id === quote.id)
      .reduce((s, item) => s + (item.line_total || 0), 0)
    return sum + subtotal * (1 + (quote.markup_pct || 0.2)) * (1 + (quote.gst_pct || 0.1))
  }, 0)
}

export async function loadQuoteDocumentData(
  jobId: string,
  quoteIds: string[],
  ctx: QuoteDocumentContext,
  options: { requireApproved?: boolean } = {},
): Promise<QuoteDocumentData> {
  const { supabase, tenantId } = ctx
  const ids = [...new Set(quoteIds)]
  if (ids.length === 0) throw new QuoteDocumentError('Choose at least one quote', 400)

  const [jobRes, tenantRes, quotesRes, itemsRes] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', jobId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    supabase.from('quotes').select('*').in('id', ids).eq('tenant_id', tenantId).order('created_at', { ascending: true }),
    supabase.from('scope_items').select('*').in('quote_id', ids).eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
  ])

  if (!jobRes.data) throw new QuoteDocumentError('Job not found', 404)
  if (!tenantRes.data) throw new QuoteDocumentError('Tenant not found', 404)
  const quotes = quotesRes.data ?? []
  if (quotes.length !== ids.length || quotes.some(q => q.job_id !== jobId)) {
    throw new QuoteDocumentError('One or more quotes were not found on this job', 404)
  }
  if (options.requireApproved) {
    const notApproved = quotes.filter(q => !SIGNABLE_QUOTE_STATUSES.includes(q.status ?? ''))
    if (notApproved.length > 0) {
      throw new QuoteDocumentError(
        `Only approved quotes can be sent for signature (${notApproved.map(q => q.quote_ref ?? 'quote').join(', ')} is ${notApproved[0].status ?? 'not approved'})`,
        422,
      )
    }
  }

  const scopeItems = (itemsRes.data ?? []).filter(item => item.approval_status !== 'declined')
  if (scopeItems.length === 0) throw new QuoteDocumentError('The selected quotes have no scope items', 422)

  return {
    job: jobRes.data,
    tenant: tenantRes.data,
    quotes,
    scopeItems,
    totalInclGst: quotesTotalInclGst(quotes, scopeItems),
  }
}
