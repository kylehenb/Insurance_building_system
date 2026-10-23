import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncInvoiceToAccounting } from '@/lib/accounting/sync'

interface SyncInvoiceBody {
  invoiceId: string
}

interface UserRow {
  tenant_id: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'invoices.manage')
  if (denied) return denied
  // Cookie-based auth
  const cookieSupabase = await createClient()
  const { data: { user }, error: userError } = await cookieSupabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceSupabase = createServiceClient()

  const { data: userRow, error: userRowError } = await serviceSupabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) {
    return NextResponse.json({ error: 'User record not found' }, { status: 404 })
  }

  const tenantId = (userRow as UserRow).tenant_id

  let body: SyncInvoiceBody
  try {
    body = (await req.json()) as SyncInvoiceBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { invoiceId } = body
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
  }

  const result = await syncInvoiceToAccounting(serviceSupabase, tenantId, invoiceId)

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? 'Sync failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    accountingRefId: result.accountingRefId,
  })
}
