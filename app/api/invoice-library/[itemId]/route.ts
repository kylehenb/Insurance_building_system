import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'

interface Params {
  params: Promise<{ itemId: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'settings.edit')
  if (denied) return denied
  const { itemId } = await params
  const body = await req.json() as {
    tenantId: string
    description?: string
    default_quantity?: number
    default_unit_price?: number
    unit?: string
    invoice_type?: string
    sort_order?: number
    is_active?: boolean
  }

  const { tenantId: _clientTenantId, ...updates } = body
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoice_line_item_library')
    .update(updates)
    .eq('id', itemId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json(data)
}
