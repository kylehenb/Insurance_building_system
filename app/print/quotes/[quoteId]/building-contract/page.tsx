import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { generateBuildingContractHtml } from '@/lib/documents/building-contract-html'

export default async function BuildingContractPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>
  searchParams: Promise<{ quoteIds?: string }>
}) {
  const { quoteId } = await params
  const { quoteIds: quoteIdsParam } = await searchParams
  const quoteIds = quoteIdsParam ? quoteIdsParam.split(',') : [quoteId]

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

  // Fetch quotes
  const { data: quotes, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .in('id', quoteIds)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (quoteError || !quotes || quotes.length === 0) {
    return <div>Quote not found</div>
  }

  // Fetch scope items
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items')
    .select('*')
    .in('quote_id', quoteIds)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return <div>Error fetching scope items</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', quotes[0].job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return <div>Job not found</div>
  }

  // Generate HTML
  const html = generateBuildingContractHtml({
    quotes,
    job,
    scopeItems: scopeItems || [],
  })

  return (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  )
}
