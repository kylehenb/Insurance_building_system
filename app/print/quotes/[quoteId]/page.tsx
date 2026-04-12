import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function QuotePrintPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = await params

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

  return (
    <div className="min-h-screen bg-white p-8">
      <h1>Quote Print Page</h1>
      <p>Quote ID: {quoteId}</p>
      <p>Tenant ID: {tenantId}</p>
      <p>User ID: {user.id}</p>
      <p>Authentication works. Now adding data fetching...</p>
    </div>
  )
}
