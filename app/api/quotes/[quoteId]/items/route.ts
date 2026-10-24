import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { QuoteEditError, addScopeItem } from '@/lib/quotes/service'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { quoteId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const { quoteId } = await params
  const body = await req.json()

  try {
    const data = await addScopeItem(createServiceClient(), me.tenantId, quoteId, body as Parameters<typeof addScopeItem>[3])
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof QuoteEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
