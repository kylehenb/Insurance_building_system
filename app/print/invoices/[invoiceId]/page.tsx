import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { generateInvoiceHtml } from '@/lib/documents/invoice-html'
import { InvoicePrintButton } from './InvoicePrintButton'

type Invoice = Database['public']['Tables']['invoices']['Row']
type InvoiceLineItem = Database['public']['Tables']['invoice_line_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const { invoiceId } = await params

  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Get user's tenant_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    redirect('/login')
  }

  const tenantId = userData.tenant_id

  // Fetch invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (invoiceError || !invoice) {
    return <div>Invoice not found</div>
  }

  // Fetch line items
  const { data: lineItems, error: itemsError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return <div>Error fetching line items</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', invoice.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return <div>Job not found</div>
  }

  // Fetch tenant details
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    return <div>Tenant not found</div>
  }

  const html = generateInvoiceHtml({
    invoice,
    job,
    tenant: tenant as Tenant & {
      bank_name?: string | null
      bsb?: string | null
      account_number?: string | null
      account_name?: string | null
    },
    lineItems: lineItems || [],
  })

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Print controls */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 relative">
        {/* Print button - hidden when printing */}
        <div className="no-print absolute top-4 right-4 z-10 print:hidden">
          <InvoicePrintButton />
        </div>

        {/* Render HTML */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
