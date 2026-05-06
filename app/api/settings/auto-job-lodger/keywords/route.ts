import { NextRequest, NextResponse } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/get-user'

type EmailKeywordRule = {
  id: string
  tenant_id: string
  keyword: string
  active: boolean
  created_at: string
}

type PostgrestError = {
  code: string
  message: string
  details: string | null
  hint: string | null
}

function getRawClient() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  const body = await req.json() as { keyword: string }
  const { keyword } = body

  if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
    return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
  }

  const supabase = getRawClient()

  const { data, error } = await supabase
    .from('email_keyword_rules')
    .insert({ tenant_id: tenantId, keyword: keyword.trim() })
    .select('*')
    .single()

  if (error) {
    const pgError = error as unknown as PostgrestError
    if (pgError.code === '23505') {
      return NextResponse.json({ error: 'Keyword already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: pgError.message }, { status: 500 })
  }

  return NextResponse.json({ keyword: data as EmailKeywordRule }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
  }

  const supabase = getRawClient()

  const { error } = await supabase
    .from('email_keyword_rules')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  const body = await req.json() as { id: string; active: boolean }
  const { id, active } = body

  if (!id || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'id and active are required' }, { status: 400 })
  }

  const supabase = getRawClient()

  const { data, error } = await supabase
    .from('email_keyword_rules')
    .update({ active })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ keyword: data as EmailKeywordRule })
}
