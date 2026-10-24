import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { QuoteEditError, updateQuote } from '@/lib/quotes/service'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { quoteId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: items } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({ ...quote, items: items ?? [] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId: _clientTenantId, ...updates } = body as Record<string, unknown>
  const tenantId = me.tenantId

  try {
    const data = await updateQuote(createServiceClient(), tenantId, quoteId, updates)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof QuoteEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'records.delete')
  if (denied) return denied
  const { quoteId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('quotes')
    .update({ is_active_version: false })
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
