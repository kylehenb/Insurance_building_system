import type { SupabaseClient } from '@supabase/supabase-js'

export async function generateInvoiceRef(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  jobNumber: string
): Promise<string> {
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('job_id', jobId)
    .eq('direction', 'outbound')

  const sequence = String((count ?? 0) + 1)
  return `INV-${jobNumber}-${sequence}`
}
