import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { QuoteEditError, removeScopeItem, updateScopeItem } from '@/lib/quotes/service'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string; itemId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const { quoteId, itemId } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  try {
    const data = await updateScopeItem(createServiceClient(), me.tenantId, quoteId, itemId, body)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof QuoteEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('PATCH item error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string; itemId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const { quoteId, itemId } = await params
  const tenantId = me.tenantId

  try {
    await removeScopeItem(createServiceClient(), tenantId, quoteId, itemId)
  } catch (err) {
    if (err instanceof QuoteEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
  return NextResponse.json({ success: true })
}
