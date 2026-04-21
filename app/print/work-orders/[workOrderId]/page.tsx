import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { generateWorkOrderHtml } from '@/lib/documents/work-order-html'
import { WorkOrderPrintButton } from './WorkOrderPrintButton'

type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type WorkOrderVisit = Database['public']['Tables']['work_order_visits']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Trade = Database['public']['Tables']['trades']['Row']

export default async function WorkOrderPrintPage({
  params,
}: {
  params: Promise<{ workOrderId: string }>
}) {
  const { workOrderId } = await params

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

  // Fetch work order
  const { data: workOrder, error: workOrderError } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', workOrderId)
    .eq('tenant_id', tenantId)
    .single()

  if (workOrderError || !workOrder) {
    return <div>Work order not found</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', workOrder.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return <div>Job not found</div>
  }

  // Fetch trade details
  let trade: Trade | null = null
  if (workOrder.trade_id) {
    const { data: tradeData, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', workOrder.trade_id)
      .eq('tenant_id', tenantId)
      .single()

    if (!tradeError && tradeData) {
      trade = tradeData
    }
  }

  // Fetch work order visits
  const { data: visits, error: visitsError } = await supabase
    .from('work_order_visits')
    .select('*')
    .eq('work_order_id', workOrderId)
    .eq('tenant_id', tenantId)
    .order('visit_number', { ascending: true })

  if (visitsError) {
    return <div>Error fetching visits</div>
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

  const html = generateWorkOrderHtml({
    workOrder,
    job,
    tenant: tenant as Tenant & {
      building_licence_number?: string | null
    },
    trade,
    visits: visits || [],
  })

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Print controls */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 relative">
        {/* Print button - hidden when printing */}
        <div className="no-print absolute top-4 right-4 z-10 print:hidden">
          <WorkOrderPrintButton />
        </div>

        {/* Render HTML */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
