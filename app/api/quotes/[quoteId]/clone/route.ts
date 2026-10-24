import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { QuoteEditError, cloneQuote } from '@/lib/quotes/service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const { quoteId } = await params

  try {
    const newQuote = await cloneQuote(createServiceClient(), me.tenantId, quoteId)
    return NextResponse.json(newQuote, { status: 201 })
  } catch (err) {
    if (err instanceof QuoteEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
