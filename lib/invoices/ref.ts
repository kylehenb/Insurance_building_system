import type { SupabaseClient } from '@supabase/supabase-js'

export async function generateInvoiceRef(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  jobNumber: string
): Promise<string> {
  const { data: existing } = await supabase
    .from('invoices')
    .select('invoice_ref')
    .eq('tenant_id', tenantId)
    .eq('job_id', jobId)

  const prefix = `INV-${jobNumber}-`
  const existingRefs = new Set((existing ?? []).map(r => r.invoice_ref))

  const maxSeq = (existing ?? []).reduce((max, row) => {
    const ref = row.invoice_ref ?? ''
    if (ref.startsWith(prefix)) {
      const n = parseInt(ref.slice(prefix.length), 10)
      if (!isNaN(n) && n > max) return n
    }
    return max
  }, 0)

  let seq = maxSeq + 1
  while (existingRefs.has(`${prefix}${seq}`)) {
    seq++
  }

  return `${prefix}${seq}`
}
