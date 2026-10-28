import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { ScopeLibraryItem } from '@/lib/types/scope-library'
import type { Database } from '@/lib/supabase/database.types'
import { toScopeLibraryItem } from '@/lib/scope-library/rows'

type LibraryRow = Database['public']['Tables']['scope_library']['Row']

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'settings.edit')
  if (denied) return denied
  const session = await getUser()
  if (!session || !session.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { id } = await params

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('scope_library')
    .update({
      is_draft: false,
      draft_source_quote_id: null,
      draft_source_job_ref: null,
      approval_status: 'approved',
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const row = data as LibraryRow
  const item: ScopeLibraryItem = toScopeLibraryItem(row)

  return NextResponse.json(item)
}
