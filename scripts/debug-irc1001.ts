import { createServiceClient } from '../lib/supabase/server'

async function debugIRC1001() {
  const supabase = createServiceClient()

  // Get the job
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_number', 'IRC1001')
    .single()

  console.log('JOB:', job)
  console.log('JOB ERROR:', jobError)

  if (!job) {
    console.log('Job IRC1001 not found')
    return
  }

  const jobId = job.id
  const tenantId = job.tenant_id

  // Get quotes for this job
  const { data: quotes, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)

  console.log('\nQUOTES:', quotes)
  console.log('QUOTE ERROR:', quoteError)

  if (!quotes || quotes.length === 0) {
    console.log('No quotes found for this job')
    return
  }

  // Get scope items for each quote
  for (const quote of quotes) {
    const { data: scopeItems, error: scopeError } = await supabase
      .from('scope_items')
      .select('*')
      .eq('quote_id', quote.id)
      .eq('tenant_id', tenantId)

    console.log(`\nSCOPE ITEMS FOR QUOTE ${quote.quote_ref}:`, scopeItems)
    console.log('SCOPE ERROR:', scopeError)
  }

  // Get blueprint drafts
  const { data: blueprints, error: blueprintError } = await supabase
    .from('job_schedule_blueprints')
    .select('*')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)

  console.log('\nBLUEPRINTS:', blueprints)
  console.log('BLUEPRINT ERROR:', blueprintError)

  // Get work orders
  const { data: workOrders, error: woError } = await supabase
    .from('work_orders')
    .select('*')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)

  console.log('\nWORK ORDERS:', workOrders)
  console.log('WORK ORDER ERROR:', woError)
}

debugIRC1001().catch(console.error)
