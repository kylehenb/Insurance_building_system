import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { PrintDataContext } from '@/lib/documents/print-data'

/** The signed-in user's tenant-scoped client for a print page; sends anyone else to /login. */
export async function printPageContext(): Promise<PrintDataContext> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (userError || !userData) redirect('/login')

  return { supabase, tenantId: userData.tenant_id }
}
