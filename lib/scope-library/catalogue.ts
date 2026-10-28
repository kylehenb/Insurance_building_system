import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { buildCatalogue, type CatalogueItem, type JobInsurer, type LibraryRow, type OverrideRow } from './pricing'

// Loads the scope library a job picks from, priced for the job's insurer (see
// ./pricing.ts). Used by the scope search route (quote editor and field app),
// field submission and the quote service.

type Client = SupabaseClient<Database>

const LIBRARY_COLUMNS =
  'id, trade, keyword, item_description, unit, labour_per_unit, materials_per_unit, total_per_unit, trade_rate_total, estimated_hours, insurer_specific, approval_status'

/** The job's insurer: its clients row (the job's client, or an insurer with the job's insurer name) and its names. */
export async function loadJobInsurer(supabase: Client, tenantId: string, jobId: string | null | undefined): Promise<JobInsurer | null> {
  if (!jobId) return null
  const { data: job } = await supabase
    .from('jobs').select('insurer, client_id').eq('id', jobId).eq('tenant_id', tenantId).maybeSingle()
  if (!job) return null

  const names = [job.insurer?.trim()].filter((n): n is string => !!n)
  let client: { id: string; name: string; trading_name: string | null; client_type: string | null } | null = null
  if (job.client_id) {
    const { data } = await supabase
      .from('clients').select('id, name, trading_name, client_type').eq('id', job.client_id).eq('tenant_id', tenantId).maybeSingle()
    if (data?.client_type === 'insurer') client = data
  }
  if (!client && names[0]) {
    const { data } = await supabase
      .from('clients').select('id, name, trading_name, client_type')
      .eq('tenant_id', tenantId).eq('client_type', 'insurer').ilike('name', names[0].replace(/[\\%_]/g, m => `\\${m}`))
      .limit(1).maybeSingle()
    client = data ?? null
  }
  if (client) names.push(client.name, ...(client.trading_name ? [client.trading_name] : []))
  return { id: client?.id ?? null, names: [...new Set(names.filter(Boolean))] }
}

/** The job behind a quote */
export async function quoteJobId(supabase: Client, tenantId: string, quoteId: string): Promise<string | null> {
  const { data } = await supabase.from('quotes').select('job_id').eq('id', quoteId).eq('tenant_id', tenantId).maybeSingle()
  return data?.job_id ?? null
}

/** Every library item the job can use, at its insurer's prices (archived ones left out by buildCatalogue). Without a job: the standard items. */
export async function loadScopeCatalogue(supabase: Client, tenantId: string, insurer: JobInsurer | null): Promise<CatalogueItem[]> {
  const { data: rows, error } = await supabase
    .from('scope_library').select(LIBRARY_COLUMNS).eq('tenant_id', tenantId)
  if (error) throw error

  let overrides: OverrideRow[] = []
  if (insurer?.id) {
    const { data, error: overridesError } = await supabase
      .from('scope_library_overrides')
      .select('scope_library_id, insurer_id, labour_per_unit, materials_per_unit, total_per_unit, wording_single')
      .eq('tenant_id', tenantId).eq('insurer_id', insurer.id)
    if (overridesError) throw overridesError
    overrides = data ?? []
  }
  return buildCatalogue((rows ?? []) as LibraryRow[], overrides, insurer)
}
